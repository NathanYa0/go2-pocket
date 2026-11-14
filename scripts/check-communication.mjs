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
 const opts={available:()=>true,wait:async()=>{},convertFile:async()=>new ArrayBuffer(100),recorder:()=>recorder,offerPaw:()=>events.push('paw'),state:s=>states.push(s),
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
await test('file uploads replace only their slot and never play, record or offer a paw',async()=>{
 const f=fixture();await f.c.load();
 for(const slot of ['hi','nice','guide']) {
  await f.c.uploadFile(slot,{size:100});
  assert.ok(f.c.state.clips[slot].UNIQUE_ID.startsWith('new'));
 }
 assert.deepEqual(requests(f,1009).map(e=>e[1].unique_id),['old','nice']);
 assert.ok(f.files.some(file=>file.UNIQUE_ID==='other'));
 assert.equal(requests(f,1002).length,0);assert.ok(!f.events.includes('paw'));assert.ok(!f.events.includes('start'));
 assert.equal(communicationClips(f.files).guide.UNIQUE_ID,f.c.state.clips.guide.UNIQUE_ID);
 await f.c.close();
});
await test('bad, empty, oversized or failed uploads preserve the previous clip',async()=>{
 for(const overrides of [
  {convertFile:async()=>{throw Error('decode failed');}},
  {convertFile:async()=>new ArrayBuffer(44)},
  {convertFile:async()=>new ArrayBuffer(10*1024*1024+1)},
  {upload:async()=>{throw Error('upload failed');}}
 ]) {
  const f=fixture(overrides);await f.c.load();await f.c.uploadFile('hi',{size:100});
  assert.equal(f.c.state.clips.hi.UNIQUE_ID,'old');assert.equal(requests(f,1009).length,0);assert.equal(f.c.state.phase,'idle');await f.c.close();
 }
 const f=fixture();await f.c.load();await f.c.uploadFile('hi',{size:0});assert.match(f.c.state.message,/empty/);assert.ok(!f.events.includes('upload'));await f.c.close();
});
await test('upload respects library capacity and cancellation during conversion',async()=>{
 const f=fixture();while(f.files.length<10)f.files.push({UNIQUE_ID:`extra${f.files.length}`,CUSTOM_NAME:'Other'});
 await f.c.load();await f.c.uploadFile('hi',{size:100});assert.match(f.c.state.message,/full/);assert.ok(!f.events.includes('upload'));await f.c.close();
 let release;
 const g=fixture({convertFile:()=>new Promise(r=>release=r)});await g.c.load();const upload=g.c.uploadFile('hi',{size:100});await flush();
 await g.c.toggleRecord('nice');assert.ok(!g.events.includes('start'));
 const closing=g.c.close();release(new ArrayBuffer(100));await upload;await closing;
 assert.ok(!g.events.includes('upload'));assert.equal(requests(g,1009).length,0);
});
await test('delayed library update eventually enables the new voice',async()=>{
 const f=fixture();await f.c.load();let pending,reads=0;const original=f.opts.request;
 f.opts.upload=async(wav,name,check,progress)=>{check();progress?.(100);pending={UNIQUE_ID:'late',CUSTOM_NAME:name};};
 f.opts.request=async(api,payload)=>{if(api===1001&&pending&&++reads===4)f.files.push(pending);return original(api,payload);};
 await f.c.uploadFile('hi',{size:100});assert.equal(f.c.state.clips.hi.UNIQUE_ID,'late');assert.equal(reads,4);
 assert.ok(f.states.some(s=>s.message.includes('100%')));await f.c.close();
});
await test('differently named upload can be explicitly selected, persists and plays by ID',async()=>{
 let choices={};const f=fixture({saveSelections:value=>{choices=value;},readSelections:()=>choices});await f.c.load();
 f.opts.upload=async()=>f.files.push({UNIQUE_ID:'generated',CUSTOM_NAME:'UserAudio_generated.wav'});
 await f.c.uploadFile('hi',{size:100});assert.match(f.c.state.message,/different name/);assert.equal(f.c.state.clips.hi.UNIQUE_ID,'old');assert.equal(requests(f,1009).length,0);
 await f.c.useSavedClip('hi','generated');assert.equal(f.c.state.clips.hi.UNIQUE_ID,'generated');await f.c.play('hi');assert.equal(requests(f,1002).at(-1)[1].unique_id,'generated');
 const reopened=new Communication(f.opts);await reopened.load();assert.equal(reopened.state.clips.hi.UNIQUE_ID,'generated');await reopened.close();await f.c.close();
});
await test('replacement does not delete an owned clip selected by another slot',async()=>{
 const f=fixture();await f.c.load();await f.c.useSavedClip('guide','old');await f.c.uploadFile('hi',{size:100});assert.equal(requests(f,1009).length,0);assert.equal(f.c.state.clips.guide.UNIQUE_ID,'old');await f.c.close();
});
await test('Music slot routes playback to dance controller and Stop/close cancel it',async()=>{
 const f=fixture();f.files.push({UNIQUE_ID:'song',CUSTOM_NAME:'Comm music 1700000000000-abcdef'});
 f.opts.dance=()=>{f.events.push('dance');return 55;};f.opts.stopDance=()=>f.events.push('dance-stop');
 await f.c.load();await f.c.play('music');assert.equal(f.c.state.phase,'music');assert.ok(!f.events.includes('dance'));
 f.c.music.playbackState({is_playing:true,current_audio_unique_id:'song'});assert.ok(f.events.includes('dance'));
 assert.equal(requests(f,1002).at(-1)[1].unique_id,'song');
 await f.c.stopPlayback();assert.equal(f.c.state.phase,'idle');assert.ok(f.events.includes('dance-stop'));
 const beforeSolo=f.events.filter(e=>e==='dance').length;
 await f.c.play('music',false);assert.equal(f.c.state.phase,'idle');assert.match(f.c.state.message,/song only/);
 f.c.music.playbackState({is_playing:true,current_audio_unique_id:'song'});
 assert.equal(f.events.filter(e=>e==='dance').length,beforeSolo,'Song-only playback never starts a dance');
 await f.c.play('music');f.c.music.playbackState({is_playing:true,current_audio_unique_id:'song'});
 await f.c.close();const dances=f.events.filter(e=>e==='dance').length;
 f.c.music.playbackState({is_playing:true,current_audio_unique_id:'song'});assert.equal(f.events.filter(e=>e==='dance').length,dances);
 assert.equal(f.events.filter(e=>e==='dance-stop').length,2);assert.equal(f.c.state.phase,'closed');
});
await test('Other recordings never automatically play the follow-up',async()=>{
 for(const slot of ['line2','hi','after1']) {
  const f=fixture();f.files.push({UNIQUE_ID:'followup',CUSTOM_NAME:'Comm after1 1700000000000-abcdef'},
   {UNIQUE_ID:'legacy-thanks',CUSTOM_NAME:'Comm thanks 1700000000000-abcdef'});
  await f.c.load();await f.c.toggleRecord(slot);await f.c.toggleRecord(slot);
  assert.ok(f.c.state.clips[slot]);assert.equal(f.c.state.phase,'idle');assert.equal(requests(f,1002).length,0);
  if(slot!=='after1')assert.ok(f.files.some(x=>x.UNIQUE_ID==='followup'));assert.ok(f.files.some(x=>x.UNIQUE_ID==='legacy-thanks'));
  await f.c.close();
 }
});
await test('VL1 Stop & save starts the follow-up before upload without waiting for its end',async()=>{
 const f=fixture();f.files.push({UNIQUE_ID:'followup',CUSTOM_NAME:'Comm after1 1700000000000-abcdef'});
 await f.c.load();await f.c.toggleRecord('line1');assert.equal(requests(f,1002).length,0);
 const upload=f.opts.upload;let release;
 f.opts.upload=async(...args)=>{args[3]?.(25);await new Promise(r=>release=r);return upload(...args);};
 const saving=f.c.toggleRecord('line1');await flush();
 assert.deepEqual(requests(f,1002).map(e=>e[1].unique_id),['followup']);
 assert.ok(f.events.indexOf('stop')<f.events.findIndex(e=>Array.isArray(e)&&e[0]===1002),'Stop mic before playing');
 assert.equal(f.c.state.phase,'saving');assert.equal(f.c.state.uploadPercent,25);assert.equal(f.c.state.audioBusy,false);
 const pauses=requests(f,1003).length;
 release();await saving;
 assert.equal(f.c.state.phase,'idle','Does not wait for playback-end telemetry');assert.ok(f.c.state.clips.line1);
 assert.equal(requests(f,1002).length,1);assert.equal(requests(f,1003).length,pauses,'Upload completion does not stop the message');
 await f.c.close();
});
await test('Failed automatic playback still saves VL1',async()=>{
 const f=fixture();f.files.push({UNIQUE_ID:'followup',CUSTOM_NAME:'Comm after1 1700000000000-abcdef'});
 await f.c.load();await f.c.toggleRecord('line1');const base=f.opts.request;
 f.opts.request=async(api,payload)=>{if(api===1002)throw Error('Playback rejected');return base(api,payload);};
 await f.c.toggleRecord('line1');assert.ok(f.c.state.clips.line1);assert.equal(f.c.state.phase,'idle');await f.c.close();
});
await test('Play and Stop work during an upload without cancelling or restarting it',async()=>{
 const f=fixture();await f.c.load();await f.c.toggleRecord('line1');
 const upload=f.opts.upload;let release;
 f.opts.upload=async(...args)=>{args[3]?.(25);await new Promise(r=>release=r);return upload(...args);};
 const saving=f.c.toggleRecord('line1');await flush();
 assert.equal(f.c.state.phase,'saving');assert.equal(requests(f,1002).length,0);
 await f.c.play('hi');assert.equal(requests(f,1002).at(-1)[1].unique_id,'old');
 assert.equal(f.c.state.phase,'saving');assert.equal(f.c.state.uploadPercent,25);
 await f.c.stopPlayback();assert.equal(f.c.state.phase,'saving');assert.equal(f.c.state.uploadPercent,25);
 await f.c.play('nice');assert.equal(f.events.filter(x=>x==='paw').length,1);
 release();await saving;assert.ok(f.c.state.clips.line1);assert.equal(f.c.state.phase,'idle');
 assert.equal(f.events.filter(x=>x==='upload').length,1);await f.c.close();
});
await test('Audio errors during upload do not discard the new recording',async()=>{
 const f=fixture();await f.c.load();await f.c.toggleRecord('line1');
 const upload=f.opts.upload;let release;
 f.opts.upload=async(...args)=>{await new Promise(r=>release=r);return upload(...args);};
 const saving=f.c.toggleRecord('line1');await flush();const base=f.opts.request;
 f.opts.request=async(api,payload)=>{if(api===1002)throw Error('Playback rejected');return base(api,payload);};
 await f.c.play('hi');assert.equal(f.c.state.phase,'saving');assert.match(f.c.state.message,/Playback rejected/);
 release();await saving;assert.ok(f.c.state.clips.line1);await f.c.close();
});
await test('Close waits for manual playback in flight and suppresses a late paw',async()=>{
 const f=fixture();await f.c.load();await f.c.toggleRecord('line1');
 const upload=f.opts.upload;let releaseUpload,releasePlay;
 f.opts.upload=async(...args)=>{await new Promise(r=>releaseUpload=r);return upload(...args);};
 const saving=f.c.toggleRecord('line1');await flush();const base=f.opts.request;
 f.opts.request=async(api,payload)=>{const result=await base(api,payload);if(api===1002)await new Promise(r=>releasePlay=r);return result;};
 const playing=f.c.play('nice');await flush();const closing=f.c.close();releasePlay();releaseUpload();
 await Promise.all([saving,playing,closing]);assert.equal(f.c.state.phase,'closed');assert.ok(!f.events.includes('paw'));
 assert.equal(requests(f,1003).at(-1)[0],1003);
});
console.log(`${count} Communication checks passed; no robot connected.`);
