// Requires npm run dev. All robot data and movement transport are simulated.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:5186/?desktop=1');
 await page.locator('.pocket-home').waitFor();
 await page.evaluate(async()=>{
  const {MappingPage}=await import('/src/ui/components/mapping-page.ts');
  const {RTC_TOPIC}=await import('/src/protocol/topics.ts');
  const {getBundle}=await import('/src/storage/map-pcd-store.ts');
  localStorage.clear();
  const root=document.getElementById('app');root.replaceChildren();root.className='app-root mapping-screen';
  const state={mapping:0,localization:0,navigation:0,mapId:'old-map',fileDelay:0};
  const calls=[],moves=[];let velocity=[0,0],x=0,y=0,yaw=0;
  const points=[];for(let px=-2.5;px<=2.501;px+=.1)for(let py=-2.5;py<=2.501;py+=.1)points.push(px,py,0);
  const floor=new Float32Array(points);
  const pcd='# .PCD v0.7\nVERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH 1\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 1\nDATA ascii\n0 0 0 255\n';
  const files={'map.pcd':pcd,'map.pgm':'P2\n1 1\n255\n0\n','map.txt':'1 1\n0.1\n0 0\n0\n'};
  let app;
  const log=text=>app.handleTopicMessage(RTC_TOPIC.USLAM_SERVER_LOG,text);
  app=new MappingPage(root,()=>{},(topic,cmd)=>{
   calls.push(cmd);setTimeout(()=>{
    if(cmd.endsWith('/get_status'))log(`${cmd}/status/${state[cmd.split('/')[0]]??0}`);
    else if(cmd==='common/get_map_id')log(`common/get_map_id/map_id/${state.mapId}`);
    else if(cmd==='mapping/start'){state.mapping=1;x=0;y=0;yaw=0;log('mapping/start/success');}
    else if(cmd==='mapping/stop'){state.mapping=0;log('mapping/stop/success');}
    else if(cmd.startsWith('common/set_map_id/')){state.mapId=cmd.split('/').at(-1);log('common/set_map_id/success');}
   },0);
  },()=>{},()=>{},(name,cb)=>setTimeout(()=>cb(btoa(files[name])),state.fileDelay),async()=>{},'test-pro',()=>{},
  (v,w)=>{velocity=[v,w];moves.push([v,w]);return true;});
  const timer=setInterval(()=>{
   const now=performance.now();
   yaw+=velocity[1]*.05;x+=Math.cos(yaw)*velocity[0]*.05;y+=Math.sin(yaw)*velocity[0]*.05;
   app.setBattery(80);app.setExplorationMotion({bodyHeight:.32,speed:velocity[0],roll:0,pitch:0});
   if(!state.mapping)return;
   const stamp={sec:Math.floor(now/1000)+1000,nanosec:Math.round((now%1000)*1e6)};
   app.handleTopicMessage(RTC_TOPIC.USLAM_ODOM,{header:{frame_id:'odom',stamp},child_frame_id:'base_link',pose:{pose:{position:{x,y,z:.32},orientation:{x:0,y:0,z:Math.sin(yaw/2),w:Math.cos(yaw/2)}}}});
   // Inject decoded worker output, retaining the same provenance envelope as the real worker.
   app.slamWorker.onmessage({data:{type:'newMap',sessionId:app.pendingNewMapId,capturedAt:now,frame:'odom',data:{output:floor,directOutput:floor}}});
  },50);
  window.exploreTest={app,calls,moves,state,timer,getBundle};
 });
 await page.waitForTimeout(700);
 await page.getByRole('button',{name:'Open mapping directions',exact:true}).click();
 await page.getByLabel('Starting floor is flat with no steps or holes; nearby objects stay blocked (this trial only)',{exact:true}).check();
 await page.getByRole('button',{name:'Explore & Map (experimental)',exact:true}).click();
 await page.waitForFunction(()=>window.exploreTest.app.explorer.active);
 assert.equal(await page.getByLabel('Starting floor is flat with no steps or holes; nearby objects stay blocked (this trial only)',{exact:true}).isChecked(),false,'confirmation is consumed for one trial only');
 assert.equal(await page.evaluate(()=>window.exploreTest.app.exploreAreaConfirmed),true);
 assert.equal(await page.evaluate(()=>window.exploreTest.moves.some(([v,w])=>v!==0||w!==0)),false,'stationary scan');
 await page.waitForFunction(()=>window.exploreTest.moves.some(([v,w])=>v!==0||w!==0),{},{timeout:12000});
 mkdirSync('output/point-lio',{recursive:true});
 await page.locator('.mapping-explore-controls').scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/point-lio/exploration-desktop.png'});
 await page.getByRole('button',{name:'Stop Explore & Save',exact:true}).click();
 await page.waitForFunction(()=>{
  const {app}=window.exploreTest;
  return !app.explorer.active && !app.exploreFinishing && app.currentMapId
    && JSON.parse(localStorage.getItem('go2_slam_maps')||'[]').some(m=>m.id===app.currentMapId&&m.name.startsWith('Explore - partial map'));
 });
 await page.waitForFunction(()=>!window.exploreTest.app.mapTransfer);
 assert.equal(await page.evaluate(async()=>!!(await window.exploreTest.getBundle(window.exploreTest.app.currentMapId))?.anchor),true);
 assert.equal(await page.locator('.mapping-modal').count(),0,'automatic save does not require a naming prompt');
 const savedMaps=await page.evaluate(()=>JSON.parse(localStorage.getItem('go2_slam_maps')));
 assert.ok(savedMaps.some(m=>m.name.startsWith('Explore - partial map')),JSON.stringify(await page.evaluate(()=>({maps:JSON.parse(localStorage.getItem('go2_slam_maps')),name:window.exploreTest.app.exploreAutoSaveName,log:document.querySelector('.mapping-log').innerText,calls:window.exploreTest.calls}))));
 assert.equal(await page.evaluate(()=>window.exploreTest.calls.some(c=>/^(localization|navigation|patrol)\/(start|set_goal_pose|go)/.test(c))),false,'Step 1 only');
 assert.deepEqual(await page.evaluate(()=>window.exploreTest.moves.at(-1)),[0,0]);
 // Cancellation while the backup is pending must not issue mapping/start later.
 await page.evaluate(()=>{window.exploreTest.calls.length=0;window.exploreTest.state.fileDelay=150;});
 await page.getByRole('button',{name:'Explore & Map (experimental)',exact:true}).click();
 await page.getByRole('button',{name:'Stop Explore & Save',exact:true}).click();
 await page.waitForTimeout(1000);
 assert.equal(await page.evaluate(()=>window.exploreTest.calls.includes('mapping/start')),false,'late backup completion cannot start a cancelled exploration');
 await page.setViewportSize({width:393,height:852});
 await page.locator('.mapping-explore-controls').scrollIntoViewIfNeeded();
 const bounds=await page.locator('.mapping-explore-controls').evaluate(el=>{
  const outer=el.getBoundingClientRect();return [...el.querySelectorAll('button')].every(b=>{
   const r=b.getBoundingClientRect();return r.left>=outer.left-1&&r.right<=outer.right+1&&r.height>=44;
  });
 });
 assert.equal(bounds,true,'phone controls fit and retain touch targets');
 await page.screenshot({path:'output/point-lio/exploration-phone.png'});
 await page.evaluate(()=>{clearInterval(window.exploreTest.timer);window.exploreTest.app.destroy();});
 console.log('PASS: Explore UI scan/move/stop, partial map + A autosave, Step-1-only commands, cancelled startup and desktop/phone controls. Simulated hardware only.');
} finally {await browser.close();}
