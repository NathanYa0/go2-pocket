import assert from 'node:assert/strict';
import{chromium}from'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5186/?desktop=1');
 const result=await page.evaluate(async()=>{
  const {connectLocal}=await import('/src/connection/local-connector.ts');
  const nativeFetch=window.fetch.bind(window);let scans=0,probes=[];let resolved;
  window.fetch=async(input,init)=>{
   const url=String(input);
   if(url.startsWith('/scan?')){scans++;return Response.json({robots:[{ip:'192.0.2.20',sn:'GO2TEST000000001'}]});}
   if(url.startsWith('/robot-api')){
    const host=init.headers['X-Robot-Host'];probes.push(host);
    if(host.startsWith('192.168.1.193:'))return new Response('offline',{status:502});
    // First con_notify is reachability; second is the auth exchange.
    if(probes.filter(x=>x==='192.0.2.20:9991').length===1)return new Response('reachable');
    return new Response('Authentication refused',{status:403});
   }
   return nativeFetch(input,init);
  };
  let error;
  try{await connectLocal('192.168.1.193','STA-L',{onStateChange(){},onMessage(){},onValidated(){},onVideoTrack(){},onAudioTrack(){}},undefined,{sn:'GO2TEST000000001',onResolved:r=>resolved=r});}
  catch(e){error=e.message;}
  return{scans,probes,resolved,error};
 });
 assert.equal(result.scans,1);assert.equal(result.resolved.ip,'192.0.2.20');assert.equal(result.resolved.sn,'GO2TEST000000001');
 assert.match(result.error,/403/,'authentication rejection is surfaced, not retried as discovery');
 console.log('PASS: actual local connector resolves a changed IP before SDP/authentication; auth failure does not trigger discovery retries. All robot endpoints mocked.');
}finally{await browser.close();}
