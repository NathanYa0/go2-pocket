// Requires npm run dev on 127.0.0.1:5186. Uses mocked robot transport only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:5186/');
 await page.evaluate(async()=>{
  const {MappingPage}=await import('/src/ui/components/mapping-page.ts');
  const {RTC_TOPIC}=await import('/src/protocol/topics.ts');
  const {getBundle}=await import('/src/storage/map-pcd-store.ts');
  localStorage.clear();
  const root=document.createElement('div'); document.body.replaceChildren(root);
  let mapId='existing-map'; const state={mapping:0,localization:0,navigation:0};
  const calls=[],drive=[],timers=[];
  const localizationPosition={x:1,y:2};
  const files={'map.pcd':'# .PCD v0.7\nVERSION 0.7\nFIELDS x y z intensity\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH 1\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 1\nDATA ascii\n0 0 0 255\n','map.pgm':'P2\n1 1\n255\n0\n','map.txt':'1 1\n0.1\n0 0\n0\n'};
  let app;
  const log=text=>app.handleTopicMessage(RTC_TOPIC.USLAM_SERVER_LOG,text);
  const pose=()=>({header:{frame_id:'odom'},pose:{pose:{position:{x:state.localization?localizationPosition.x:1,y:state.localization?localizationPosition.y:2,z:.3},orientation:{x:0,y:0,z:Math.sin(.15),w:Math.cos(.15)}}}});
  app=new MappingPage(root,()=>{},(topic,cmd)=>{
   calls.push(cmd);
   setTimeout(()=>{
    if(cmd.endsWith('/get_status')) {const service=cmd.split('/')[0];log(`${cmd}/status/${state[service]??0}`);}
    else if(cmd==='common/get_map_id')log(`common/get_map_id/map_id/${mapId}`);
    else if(cmd.startsWith('common/set_map_id/')){mapId=cmd.split('/').at(-1);log('common/set_map_id/success');}
    else if(cmd==='mapping/start'){state.mapping=1;log('mapping/start/success');app.handleTopicMessage(RTC_TOPIC.USLAM_ODOM,pose());}
    else if(cmd==='mapping/stop'){state.mapping=0;log('mapping/stop/success');}
    else if(cmd==='localization/start'){state.localization=1;log('[Localization] initialization succeed!');app.handleTopicMessage(RTC_TOPIC.USLAM_LOC_ODOM,pose());}
    else if(cmd==='localization/stop'){state.localization=0;log('localization/stop/success');}
    else if(cmd==='navigation/start'){state.navigation=1;log('navigation/start/success');}
    else if(cmd==='navigation/stop'){state.navigation=0;log('navigation/stop/success');}
   },0);
  },()=>{},()=>{},(name,callback)=>setTimeout(()=>callback(btoa(files[name])),0),async()=>{},'test-robot',s=>drive.push(s));
  timers.push(setInterval(()=>{if(state.mapping)app.handleTopicMessage(RTC_TOPIC.USLAM_ODOM,pose());if(state.localization)app.handleTopicMessage(RTC_TOPIC.USLAM_LOC_ODOM,pose());},100));
  window.test={app,calls,drive,state,getBundle,timers,localizationPosition,pose,log,RTC_TOPIC};
 });
 await page.waitForTimeout(800);
 await page.getByRole('button',{name:'Open mapping directions',exact:true}).click();
 await page.getByRole('button',{name:'New Map + Anchor A',exact:true}).click();
 await page.waitForFunction(()=>window.test.app.mappingStartPose!==null);
 assert.equal(await page.evaluate(()=>window.test.app.mappingStartPose.x),1);
 await page.getByRole('button',{name:'Forward',exact:true}).hover();
 await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up();
 assert.ok(await page.evaluate(()=>window.test.drive.some(s=>s.ly===.15)));
 assert.equal(await page.evaluate(()=>window.test.drive.at(-1).ly),0);
 await page.getByRole('button',{name:'Stop & Save',exact:true}).click();
 await page.locator('.mapping-modal input').fill('Room test');
 await page.locator('.mapping-modal-ok').click();
 await page.waitForFunction(async()=>{const {app,getBundle}=window.test;return !!(await getBundle(app.currentMapId))?.anchor;});
 assert.deepEqual(await page.evaluate(()=>{const a=window.test.app.anchorController.anchor();return [a.x,a.y,Math.round(a.yaw*10)/10];}),[1,2,.3]);
 await page.evaluate(()=>Object.assign(window.test.localizationPosition,{x:8,y:9}));
 await page.getByRole('button',{name:'Start Localization',exact:true}).click();
 await page.waitForFunction(()=>window.test.app.localized && window.test.app.anchorPose);
 assert.equal(await page.getByRole('button',{name:'Return to Anchor',exact:true}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.test.app.slamScene.tracePositions.length),3,'localization starts a new trail rather than drawing the jump');
 assert.equal(await page.evaluate(()=>window.test.app.slamScene.tracePositions[0]),8);
 await page.evaluate(()=>window.test.app.handleTopicMessage(window.test.RTC_TOPIC.USLAM_ODOM,{pose:{pose:{position:{x:99,y:99,z:.3},orientation:{x:0,y:0,z:0,w:1}}}}));
 assert.equal(await page.evaluate(()=>window.test.app.slamScene.targetPos.x),8,'late frontend data cannot replace the localized marker');
 const rejected=await page.evaluate(async()=>{try{await window.test.app.anchorController.returnToAnchor();return false;}catch{return true;}});
 assert.equal(rejected,true,'unconfirmed localization cannot issue a return');
 assert.equal(await page.evaluate(()=>window.test.calls.some(c=>c==='navigation/start')),false);
 // Simulate correcting the estimate and visually checking it before navigation.
 await page.evaluate(()=>{Object.assign(window.test.localizationPosition,{x:1,y:2});window.test.log('[Localization] initialization succeed!');});
 await page.waitForFunction(()=>window.test.app.anchorPose?.x===1);
 await page.getByRole('button',{name:'Position on map is correct',exact:true}).click();
 await page.getByRole('button',{name:'Return to Anchor',exact:true}).click();
 await page.waitForFunction(()=>window.test.calls.some(c=>c.startsWith('navigation/set_goal_pose/')));
 assert.ok(await page.evaluate(()=>window.test.calls.includes('navigation/set_goal_pose/1.000/2.000/0.300')));
 await page.getByRole('button',{name:'Stop Return',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.test.calls.at(-1)),'navigation/stop');
 // Loading metadata without actual files must not relabel the robot's map.
 await page.evaluate(async()=>{window.test.calls.length=0;await window.test.app.loadMap('missing-files');});
 assert.equal(await page.evaluate(()=>window.test.calls.some(c=>c==='common/set_map_id/missing-files')),false);
 assert.equal(await page.evaluate(()=>window.test.app.mapLoaded),false);
 await page.evaluate(()=>{window.test.app.destroy();window.test.timers.forEach(clearInterval);});
 console.log('PASS: Chrome UI backup, capture A, manual-drive release, map/anchor save, localization, return goal, stop, and missing-map refusal. Source-switch trace reset, late-source rejection and unconfirmed-pose blocking passed. All robot transport mocked.');
} finally {await browser.close();}
