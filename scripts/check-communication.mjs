import assert from 'node:assert/strict';
import { build } from 'esbuild';
const {outputFiles} = await build({entryPoints:['src/ui/communication.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {Communication,communicationClips} = await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const oldName = 'Comm hi 1700000000000-abcdef';
function fixture(overrides={}) {
 const events=[], states=[];
 let files=[{UNIQUE_ID:'old',CUSTOM_NAME:oldName},{UNIQUE_ID:'nice',CUSTOM_NAME:'Comm nice 1700000000000-abcdef.wav'},{UNIQUE_ID:'other',CUSTOM_NAME:'Parrot 1700000000000-abc'}];
 let id=0;
 const recorder={start:async()=>events.push('start'),stop:async()=>{events.push('stop');return new ArrayBuffer(100);},destroy:()=>events.push('destroy')};
 const opts={available:()=>true,recorder:()=>recorder,offerPaw:()=>events.push('paw'),state:s=>states.push(s),
 request:async(api,payload)=>{const data=JSON.parse(payload);events.push([api,data]);if(api===1001)return {audio_list:files};if(api===1010)return{play_mode:'list_loop'};if(api===1009)files=files.filter(f=>f.UNIQUE_ID!==data.unique_id);return {};},
 upload:async(wav,name,check)=>{check();events.push('upload');files.push({UNIQUE_ID:`new${++id}`,CUSTOM_NAME:name});},...overrides};
 const c=new Communication(opts);return{c,events,states,opts,recorder,get files(){return files;}};
}
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const requests=(f,api)=>f.events.filter(e=>Array.isArray(e)&&e[0]===api);
let count=0;
async function test(name,fn){await fn();console.log('PASS',name);count++;}
await test('toggle captures once, confirms replacement before deletion, recovers across clients',async()=>{
 const f=fixture();await f.c.load();await f.c.toggleRecord('hi');assert.equal(f.c.state.phase,'recording');
 await f.c.toggleRecord('line1');assert.equal(f.events.filter(e=>e==='start').length,1);
 await f.c.toggleRecord('hi');assert.equal(f.c.state.clips.hi.UNIQUE_ID,'new1');
 assert.ok(f.events.indexOf('upload')<f.events.findIndex(e=>Array.isArray(e)&&e[0]===1009));
 assert.deepEqual(requests(f,1009).map(e=>e[1].unique_id),['old']);
 assert.equal(communicationClips(f.files).hi.UNIQUE_ID,'new1');assert.equal(f.files.find(x=>x.UNIQUE_ID==='other').CUSTOM_NAME,'Parrot 1700000000000-abc');
 await f.c.close();
});
await test('play never changes recordings; only nice requests paw; restores loop',async()=>{
 const f=fixture();await f.c.load();await f.c.play('hi');assert.ok(!f.events.includes('paw'));await f.c.play('nice');
 assert.equal(f.events.filter(e=>e==='paw').length,1);assert.equal(requests(f,1009).length,0);assert.ok(!f.events.includes('upload'));
 await f.c.close();assert.equal(requests(f,1007).at(-1)[1].play_mode,'list_loop');
});
await test('failed upload keeps old voice',async()=>{
 const f=fixture({upload:async()=>{throw Error('Upload failed');}});await f.c.load();await f.c.toggleRecord('hi');await f.c.toggleRecord('hi');
 assert.equal(f.c.state.clips.hi.UNIQUE_ID,'old');assert.equal(requests(f,1009).length,0);assert.match(f.c.state.message,/Upload failed/);await f.c.close();
});
await test('library full and empty capture never delete existing clips',async()=>{
 const f=fixture();while(f.files.length<10)f.files.push({UNIQUE_ID:`extra${f.files.length}`,CUSTOM_NAME:'Other'});
 await f.c.load();await f.c.toggleRecord('hi');assert.match(f.c.state.message,/full/);assert.ok(!f.events.includes('start'));await f.c.close();
 const g=fixture();g.recorder.stop=async()=>null;await g.c.load();await g.c.toggleRecord('hi');await g.c.toggleRecord('hi');assert.equal(requests(g,1009).length,0);assert.ok(!g.events.includes('upload'));await g.c.close();
});
await test('close during microphone startup cancels without upload',async()=>{
 const f=fixture();let release;f.recorder.start=()=>new Promise(r=>release=r);await f.c.load();const start=f.c.toggleRecord('hi');await flush();
 const closing=f.c.close();assert.ok(f.events.includes('destroy'));release();await start;await closing;assert.ok(!f.events.includes('upload'));assert.equal(f.c.state.phase,'closed');
});
await test('second press during startup stops after startup, without overlapping capture',async()=>{
 const f=fixture();let release;f.recorder.start=()=>new Promise(r=>release=r);await f.c.load();const start=f.c.toggleRecord('line1');await flush();void f.c.toggleRecord('line1');release();await start;
 assert.equal(f.c.state.phase,'idle');assert.ok(f.c.state.clips.line1);await f.c.close();
});
await test('closing suppresses a delayed greeting and disconnected controls do nothing',async()=>{
 const f=fixture();await f.c.load();const original=f.opts.request;let release;
 f.opts.request=async(api,payload)=>{if(api===1002)await new Promise(r=>release=r);return original(api,payload);};
 const play=f.c.play('nice');await flush();const closing=f.c.close();release();await play;await closing;assert.ok(!f.events.includes('paw'));
 const g=fixture({available:()=>false});await g.c.load();await g.c.play('nice');assert.ok(!g.events.includes('paw'));await g.c.close();
});
await test('55-second cap saves instead of losing the recording',async()=>{
 const original=globalThis.setTimeout;let deadline;
 globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,55000);deadline=fn;return 0;};
 try{const f=fixture();await f.c.load();await f.c.toggleRecord('line2');deadline();await flush();assert.ok(f.c.state.clips.line2);await f.c.close();}finally{globalThis.setTimeout=original;}
});
console.log(`${count} Communication checks passed; no robot connected.`);
