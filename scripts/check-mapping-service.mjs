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
  const commands = [];
  const service = createMappingService({ root, leaseMs: 10000, ...options, launch() {
    launches++;
    process = new EventEmitter();process.stdin = new PassThrough();process.stdout = new PassThrough();
    process.stdin.on('data', b => commands.push(JSON.parse(b.toString()).command));
    return process;
  }});
  const server = createServer((req,res) => service.middleware(req,res,() => { res.writeHead(404);res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/mapping-api/`;
  const call = (path, client = 'test-client-12345678', headers = {}) => fetch(base+path, { method: 'POST', headers: { 'X-Pocket-Mapping': client, ...headers } });
  t.after(async () => { process?.emit('close');service.close();await new Promise(resolve => server.close(resolve));rmSync(root,{recursive:true,force:true}); });
  return { call, base, commands, emit: data => process.stdout.write(JSON.stringify(data)+'\n'), launches: () => launches };
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
