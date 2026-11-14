import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/ui/audio-library-upload.ts'],bundle:true,platform:'node',format:'esm',write:false,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');"}});
const {uploadLibraryWav}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const bytes=Buffer.alloc(44+255*16000*2);for(let i=44;i<bytes.length;i++)bytes[i]=i%251;
const digest=createHash('md5').update(bytes).digest('hex');let sent=[],progress=[];const start=Date.now();
await uploadLibraryWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'long-clip',{
 request:async(api,payload)=>{assert.equal(api,2001);const p=JSON.parse(payload);assert.equal(p.file_md5,digest);assert.equal(p.file_size,bytes.length);assert.ok(p.create_time>=start&&p.create_time<=Date.now());assert.equal(p.current_block_size,p.block_content.length);assert.ok(p.current_block_size<=4096);assert.equal(p.current_block_index,sent.length+1);sent.push(p.block_content);},progress:p=>progress.push(p)
});
assert.deepEqual(Buffer.from(sent.join(''),'base64'),bytes);assert.equal(progress[0],0);assert.equal(progress.at(-1),100);
let count=0;await assert.rejects(uploadLibraryWav(new ArrayBuffer(10000),'reject',{request:async()=>{count++;throw Error('robot rejected');}}),/robot rejected/);assert.equal(count,1);
console.log('PASS: 4:15-equivalent WAV reconstructed exactly; checksum, millisecond timestamp, chunk numbering/size, progress and rejected-transfer abort.');
