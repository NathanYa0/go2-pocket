import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/check-communication-mp3.mjs /path/to/test.mp3');
const mp3=(await readFile(file)).toString('base64');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5186/?preview=1');
 const result=await page.evaluate(async(mp3)=>{
  const {Communication}=await import('/src/ui/communication.ts');
  const {convertFileToWav}=await import('/src/ui/audio-recorder.ts');
  const {uploadLibraryWav}=await import('/src/ui/audio-library-upload.ts');
  const {openCommunicationPanel}=await import('/src/ui/components/communication-panel.ts');
  const data=Uint8Array.from(atob(mp3),c=>c.charCodeAt(0));
  let library=[],panel,pending,reads=0,chunks=0,bytes=0,checksum='',created=0,progress=0;
  const c=new Communication({available:()=>true,convertFile:convertFileToWav,wait:async()=>{},
   request:async(api)=>{
    if(api===1001){if(pending&&++reads===4)library.push(pending);return{audio_list:[...library]};}
    if(api===1002)throw Error('Test must not play robot audio');return{};
   },
   upload:(wav,name,check,report)=>uploadLibraryWav(wav,name,{check,progress:p=>{progress=p;report?.(p);},request:async(api,payload)=>{
    const p=JSON.parse(payload);chunks++;bytes=p.file_size;checksum=p.file_md5;created=p.create_time;
    if(p.current_block_index===p.total_block_number)pending={UNIQUE_ID:'confirmed-long-clip',CUSTOM_NAME:p.file_name};return{};
   }}),
   recorder:()=>{throw Error('No recording expected');},offerPaw:()=>{throw Error('No movement expected');},state:s=>panel?.render(s)
  });panel=openCommunicationPanel(c);await c.load();
  await c.uploadFile('hi',new File([data],'test.mp3',{type:'audio/mpeg'}));
  const result={bytes,chunks,checksum,created,progress,reads,phase:c.state.phase,id:c.state.clips.hi?.UNIQUE_ID,
   playEnabled:!document.querySelector('[aria-label="Play Hi"]').disabled,message:c.state.message};
  panel.close();await c.close();return result;
 },mp3);
 assert.equal(result.id,'confirmed-long-clip');assert.equal(result.phase,'idle');assert.ok(result.playEnabled);
 assert.ok(result.bytes>8_000_000&&result.bytes<8_300_000);assert.match(result.checksum,/^[0-9a-f]{32}$/);assert.ok(result.created>1e12);assert.equal(result.progress,100);assert.equal(result.reads,4);
 console.log('PASS: actual 4:15 MP3 decoded, WAV converted, checksummed/chunked, delayed library confirmed, and Play enabled.',result);
}finally{await browser.close();}
