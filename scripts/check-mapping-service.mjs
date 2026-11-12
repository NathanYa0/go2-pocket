import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createMappingService } from './mapping-service.mjs';

async function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pocket-mapping-'));
  let process, launches = 0;
  const commands = [];const packets = [];
  const service = createMappingService({ root, leaseMs: 10000, ...options, launch() {
    launches++;
    process = new EventEmitter();process.stdin = new PassThrough();process.stdout = new PassThrough();
    process.stdin.on('data', b => {const packet=JSON.parse(b.toString());commands.push(packet.command);packets.push(packet);});
    return process;
  }});
  const server = createServer((req,res) => service.middleware(req,res,() => { res.writeHead(404);res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/mapping-api/`;
  const call = (path, client = 'test-client-12345678', headers = {}) => fetch(base+path, { method: 'POST', headers: { 'X-Pocket-Mapping': client, ...headers } });
  t.after(async () => { process?.emit('close');service.close();await new Promise(resolve => server.close(resolve));rmSync(root,{recursive:true,force:true}); });
  const motion = (path,payload) => fetch(base+path, {method:'POST',headers:{'X-Pocket-Mapping':'test-client-12345678','Content-Type':'application/json'},body:JSON.stringify(payload)});
  return { call, motion, base, commands, packets, emit: data => process.stdout.write(JSON.stringify(data)+'\n'), launches: () => launches };
}

test('only one owner can command movement; other local tabs can stop', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('start')).status,200);
  assert.equal((await f.call('start')).status,409);
  f.emit({state:'mapping'});
  assert.equal((await f.call('explore','another-client-12345678')).status,409);
  assert.equal((await f.call('explore')).status,200);
  assert.equal((await f.call('stop','another-client-12345678')).status,200);
  assert.deepEqual(f.commands,['explore','stop']);assert.equal(f.launches(),1);
  f.emit({state:'exploring'});
  assert.equal((await (await fetch(f.base+'status')).json()).state,'stopping');
});
test('cross-origin, missing-session and arbitrary commands cannot launch the robot', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('start','test-client-12345678',{Origin:'https://other.example'})).status,403);
  assert.equal((await f.call('start','')).status,403);
  assert.equal((await f.call('shell')).status,404);
  assert.equal(f.launches(),0);
});
test('loss of app heartbeat requests a stop, not more exploration', async t => {
  const f = await fixture(t,{leaseMs:40});
  await f.call('start');f.emit({state:'mapping'});
  await delay(130);assert.deepEqual(f.commands,['stop']);
});
test('stop works while starting; premature explore is rejected', async t => {
  const f = await fixture(t);await f.call('start');
  assert.equal((await f.call('explore')).status,409);
  await f.call('stop');assert.deepEqual(f.commands,['stop']);
});
test('map API never returns paths, log output or env data', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base+'preview/..%2F.env')).status,404);
  assert.deepEqual(await (await fetch(f.base+'maps')).json(),[]);
  const status = await (await fetch(f.base+'status')).json();
  assert.deepEqual(Object.keys(status).sort(),['installed','message','running','state']);
});

test('released manual gesture and excessive speeds cannot move; valid hold has short expiry', async t => {
 const f=await fixture(t);const s=await(await f.call('start')).json();f.emit({state:'mapping'});
 const payload={runId:s.runId,gesture:'gesture-123456789',sequence:1,forward:0.4,yawRate:0};
 assert.equal((await f.motion('manual',{...payload,forward:2})).status,409);
 assert.equal((await f.motion('manual',payload)).status,200);
 const packet=f.packets.at(-1);assert.ok(packet.validUntil-Date.now()<=350);assert.equal(packet.forward,0.4);
 await f.motion('manual-stop',payload);
 assert.equal((await f.motion('manual',{...payload,sequence:2})).status,409);
 assert.deepEqual(f.commands,['manual','manual-stop']);
});
test('goal requires current session, live world cloud and finite coordinates', async t=>{
 const f=await fixture(t);const s=await(await f.call('start')).json();f.emit({state:'mapping'});
 const goal={runId:s.runId,frame:'world',x:2,y:-1};
 assert.equal((await f.motion('goal',goal)).status,409);
 f.emit({cloud:{frame:'world',capturedAt:Date.now(),points:[[0,0,0]]}});
 assert.equal((await f.motion('goal',{...goal,runId:'old'})).status,409);
 assert.equal((await f.motion('goal',{...goal,frame:'map'})).status,409);
 assert.equal((await f.motion('goal',{...goal,x:1000})).status,409);
 assert.equal((await f.motion('goal',goal)).status,200);
 assert.deepEqual(f.commands,['goal']);
});
