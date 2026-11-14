import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/ui/music-dance.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {MusicDance}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
let now=0,sequence=0;const timers=new Map();
const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
globalThis.setInterval=fn=>{timers.set(++sequence,fn);return sequence;};
globalThis.clearInterval=id=>timers.delete(id);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const tick=ms=>{now+=ms;for(const fn of [...timers.values()])fn();};
function fixture(overrides={}) {
 const calls=[],states=[];
 const options={now:()=>now,available:()=>true,play:async id=>calls.push(['play',id]),pause:async()=>calls.push(['pause']),dance:()=>{calls.push(['dance']);return calls.length;},stopDance:()=>calls.push(['stop']),state:(busy,message)=>states.push({busy,message}),...overrides};
 return {c:new MusicDance(options),calls,states,options};
}
const playing=f=>f.c.playbackState({is_playing:true,current_audio_unique_id:'song'});
const dances=f=>f.calls.filter(c=>c[0]==='dance').length;
const frame=(f,progress,movement=0)=>{tick(100);playing(f);f.c.jointState(Array.from({length:12},()=>({dq:movement})));f.c.danceProgress(progress);};
try {
 let f=fixture();await f.c.start('song');assert.equal(dances(f),0,'Wait for actual song playback');
 playing(f);assert.equal(dances(f),1);
 for(let i=0;i<20;i++)frame(f,0);assert.equal(dances(f),1,'Initial idle does not trigger a new routine');
 frame(f,0.5,0.8);
 for(let i=0;i<20;i++)frame(f,0,0.8);assert.equal(dances(f),1,'Progress zero while joints move is not completion');
 for(let i=0;i<16;i++)frame(f,0);assert.equal(dances(f),2,'Repeat after observed routine settles');
 assert.equal(f.calls.filter(c=>c[0]==='play').length,1,'Song never restarts between dances');
 f.c.playbackState({is_playing:false,current_audio_unique_id:'song'});tick(750);await flush();
 assert.equal(f.calls.filter(c=>c[0]==='stop').length,1);assert.equal(f.calls.at(-1)[0],'pause');
 tick(10000);playing(f);assert.equal(dances(f),2,'No late repeats after song end');

 // Pro firmware often supplies q without dq; moving angles cannot count as idle.
 f=fixture();await f.c.start('song');playing(f);f.c.danceProgress(1);
 for(let i=0;i<20;i++){tick(100);playing(f);f.c.jointState(Array.from({length:12},()=>({q:(i%2)*0.1})));f.c.danceProgress(0);}
 assert.equal(dances(f),1);
 for(let i=0;i<18;i++){tick(100);playing(f);f.c.jointState(Array.from({length:12},()=>({q:0})));f.c.danceProgress(0);}
 assert.equal(dances(f),2);await f.c.stop();

 // Stop while PLAY awaits its reply: pause afterwards, never start dancing.
 let release;f=fixture({play:()=>new Promise(r=>release=r)});const start=f.c.start('song');
 const stop=f.c.stop();playing(f);release();await start;await stop;
 assert.equal(dances(f),0);assert.equal(f.calls.at(-1)[0],'pause');
 f=fixture();await f.c.start('song');playing(f);const id=f.calls.length;
 f.c.danceResponse(id+1,123);assert.equal(f.states.at(-1).busy,true);
 f.c.danceResponse(id,123);await flush();assert.match(f.states.at(-1).message,/refused/);
 assert.ok(!f.calls.some(c=>c[0]==='pause'),'Dance rejection must not pause the song');await f.c.stop();
 f=fixture();await f.c.start('song');tick(10250);await flush();assert.equal(dances(f),0);assert.match(f.states.at(-1).message,/did not confirm/);
 f=fixture();await f.c.start('song');playing(f);tick(5250);await flush();assert.match(f.states.at(-1).message,/updates stopped/);
 assert.ok(!f.calls.some(c=>c[0]==='pause'),'Missing updates must not cut off song playback');await f.c.stop();
 f=fixture();await f.c.start('song');playing(f);f.c.playbackState({is_playing:true,current_audio_unique_id:'other'});await flush();assert.match(f.states.at(-1).message,/interrupted/);
 f=fixture();await f.c.start('song');playing(f);f.options.available=()=>false;tick(250);await flush();assert.match(f.states.at(-1).message,/Connection lost/);
 // Full-length song with many completed routines and brief false status pulses.
 f=fixture();await f.c.start('song');playing(f);
 const longStart=now;
 while(now-longStart<256000){
  for(let i=0;i<30;i++)frame(f,0.5,0.8);
  f.c.playbackState({is_playing:false,current_audio_unique_id:'song'});
  tick(250);playing(f);
  for(let i=0;i<16;i++)frame(f,0);
 }
 assert.ok(dances(f)>40,'Long song keeps repeating routines');
 assert.equal(f.calls.filter(c=>c[0]==='play').length,1);
 assert.ok(!f.calls.some(c=>c[0]==='pause'),'No PAUSE during long song or transient stopped statuses');
 f.c.playbackState({is_playing:false,current_audio_unique_id:'song'});tick(750);await flush();
 assert.equal(f.calls.filter(c=>c[0]==='pause').length,1);
 // Live failure: the robot dances but its sport progress never becomes positive.
 for(const schema of ['dq','q-only','no-progress-field']){
  f=fixture();await f.c.start('song');playing(f);
  for(let i=0;i<220;i++){
   tick(100);playing(f);
   f.c.jointState(Array.from({length:12},()=>schema==='dq'?{dq:0.8}:{q:(i%2)*0.1}));
   f.c.danceProgress(schema==='no-progress-field'?undefined:0);
  }
  assert.equal(dances(f),1);assert.ok(!f.calls.some(c=>c[0]==='stop'),'Observed joint motion must survive the 15-second activity watchdog');
  const quiet=()=>{
   tick(100);playing(f);
   f.c.jointState(Array.from({length:12},()=>schema==='dq'?{dq:0}:{q:0}));
   f.c.danceProgress(schema==='no-progress-field'?undefined:0);
  };
  for(let i=0;i<20;i++)quiet();assert.equal(dances(f),1,'Two-second stage pause is not a finished routine');
  for(let i=0;i<14;i++)quiet();assert.equal(dances(f),2,'Quiet after real movement repeats even with progress stuck at zero');
  assert.match(f.states.at(-1).message,/dance 2/);
  assert.equal(f.calls.filter(c=>c[0]==='play').length,1);assert.ok(!f.calls.some(c=>c[0]==='pause'));
  await f.c.stop();
 }
 f=fixture();await f.c.start('song');playing(f);
 frame(f,0,0.8);for(let i=0;i<45;i++)frame(f,0,0);
 assert.equal(dances(f),1,'One jolt followed by standing is not a completed dance');await f.c.stop();
 f=fixture();await f.c.start('song');playing(f);
 for(let i=0;i<165;i++)frame(f,0,0);
 assert.match(f.states.at(-1).message,/did not report dance activity/);assert.equal(dances(f),1);await f.c.stop();
 assert.equal(timers.size,0);
 console.log('PASS Music repeats through a 4:16 song and zero/missing-progress firmware using sustained joint motion; stage pauses/one jolt/idle do not repeat; audio remains independent; EOF/Stop/disconnect and delayed replies handled. No robot used.');
}finally{globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;}
