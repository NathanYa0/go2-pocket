// No robot connection: real rendering with synthetic geometry and mocked feeds.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
 await page.evaluate(async()=>{
  const {App}=await import('/src/ui/app.ts');const {installShell}=await import('/src/mobile/shell.ts');
  const {localLidarPose}=await import('/src/ui/components/mapping-live-view.ts');
  document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.appendChild(root);
  const app=new App(root);installShell(app);app.mobileNavigate('mapping');
  const m=app.mappingPage;
  window.liveTest={app,m,localLidarPose,received:0,explorerClouds:0};
 });
 await page.locator('.mapping-canvas').waitFor();
 assert.equal(await page.locator('.mapping-live-view').isVisible(),false,'idle screen already has live LiDAR and needs no duplicate');
 await page.evaluate(()=>window.liveTest.m.setState('mapping'));
 await page.waitForFunction(()=>window.liveTest.m.nearbyView?.scene?.robotModel?.model);
 const poses=await page.evaluate(()=>{
  const {localLidarPose:parse,m}=window.liveTest;
  const p={position:{x:10,y:3,z:.3},orientation:{x:0,y:0,z:0,w:1}};
  const valid=parse({header:{frame_id:'odom'},pose:p});
  const nested=parse({header:{frame_id:'odom'},pose:{pose:p}});
  m.slamScene.updateRobotPose({x:1,y:2,z:.3},.2);
  window.liveTest.app.handleRobotOdom({header:{frame_id:'odom'},pose:p});
  return {valid,nested,rejected:parse({header:{frame_id:'map'},pose:p}),zero:parse({pose:{...p,orientation:{x:0,y:0,z:0,w:0}}}),mapX:m.slamScene.targetPos.x};
 });
 assert.equal(poses.valid.position.x,10);assert.equal(poses.nested.position.x,10);
 assert.equal(poses.rejected,null);assert.equal(poses.zero,null);assert.equal(poses.mapX,1,'local pose never overwrites map pose');
 await page.evaluate(()=>{
  const t=window.liveTest,m=t.m,v=m.nearbyView;
  v.scene.voxelMap.processCompressed=()=>t.received++;
  m.explorer.cloud=()=>t.explorerClouds++;
  window.liveTest.app.handleLidarData({data:new Uint8Array([1]).buffer,resolution:.05,origin:[0,0,0],frame_id:'odom'});
  const points=[];
  for(let x=-2;x<=2;x+=.12)for(let y=-2;y<=2;y+=.12)points.push(x,y,0);
  for(let y=-2;y<=2;y+=.12)for(let z=0;z<1.5;z+=.12)points.push(2,y,z);
  m.pendingNewMapId='test';
  m.slamWorker.onmessage({data:{type:'newMap',sessionId:'test',frame:'odom',capturedAt:performance.now(),data:{output:new Float32Array(points),directOutput:new Float32Array(points.slice(0,300))}}});
  // Populate live view with deterministic small coloured cubes via the real voxel renderer.
  const positions=[],uvs=[],indices=[];
  for(let x=0;x<60;x+=3)for(let y=0;y<60;y+=3) {
   const i=positions.length/3;
   positions.push(x,y,0,x+2,y,0,x+2,y+2,0,x,y+2,0);uvs.push(20,20,20,20,20,20,20,20);
   indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  v.scene.voxelMap.applyGeometry({resolution:.05,origin:[8.5,1.5,-.3],geometryData:{face_count:positions.length/12,point_count:positions.length/3,positions:new Uint8Array(positions),uvs:new Uint8Array(uvs),indices:new Uint32Array(indices)}});
 });
 assert.deepEqual(await page.evaluate(()=>({received:window.liveTest.received,clouds:window.liveTest.explorerClouds})),{received:1,clouds:1},'only SLAM current scan reaches exploration; local feed reaches display');
 mkdirSync('output/mapping-live-view',{recursive:true});
 for(const [w,h] of [[1440,900],[852,393],[667,375]]) {
  await page.setViewportSize({width:w,height:h});await page.evaluate(()=>{
   const v=window.liveTest.m.nearbyView;v.setData({mock:true},performance.now());
   v.setPose({header:{frame_id:'odom'},pose:{position:{x:10,y:3,z:.3},orientation:{x:0,y:0,z:0,w:1}}},performance.now());v.scene.resetView();
  });await page.waitForTimeout(600);
  const box=await page.locator('.mapping-live-view').boundingBox();
  assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=w&&box.y+box.height<=h,'live pane fits window');
  const button=await page.getByRole('button',{name:'Hide nearby LiDAR',exact:true}).boundingBox();assert.ok(button.width>=44&&button.height>=44);
  await page.screenshot({path:`output/mapping-live-view/${w}.png`});
 }
 await page.getByRole('button',{name:'Hide nearby LiDAR',exact:true}).click();
 assert.equal(await page.locator('.mapping-live-body').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.liveTest.m.nearbyView.scene.animationId),0,'collapsed view stops rendering');
 const before=await page.evaluate(()=>window.liveTest.received);
 await page.evaluate(()=>window.liveTest.m.setLiveLidar({mock:true}));
 assert.equal(await page.evaluate(()=>window.liveTest.received),before,'collapsed pane does not process new geometry');
 await page.getByRole('button',{name:'Show nearby LiDAR',exact:true}).click();
 assert.equal(await page.locator('.mapping-live-body').isVisible(),true);
 assert.ok(await page.evaluate(()=>window.liveTest.m.nearbyView.scene.animationId));
 await page.getByRole('button',{name:'Open mapping directions',exact:true}).click();
 assert.equal(await page.locator('.mapping-live-view').isVisible(),false,'drawer covers pause/hide live pane');
 assert.equal(await page.evaluate(()=>window.liveTest.m.nearbyView.scene.animationId),0);
 await page.getByRole('button',{name:'Close mapping directions',exact:true}).click();
 assert.equal(await page.locator('.mapping-live-view').isVisible(),true);
 await page.evaluate(()=>window.liveTest.m.nearbyView.setData({mock:true},performance.now()-2501));
 await page.waitForFunction(()=>document.querySelector('.mapping-live-status').textContent.includes('not updating'));
 assert.equal(await page.locator('.mapping-live-view').evaluate(el=>el.classList.contains('is-stale')),true);
 await page.evaluate(()=>{window.liveTest.m.mapLoaded=true;window.liveTest.m.setState('idle');});
 assert.equal(await page.locator('.mapping-live-view').isVisible(),true,'saved room map retains nearby live view');
 await page.evaluate(()=>{window.liveTest.m.mapLoaded=false;window.liveTest.m.setState('idle');});
 assert.equal(await page.locator('.mapping-live-view').isVisible(),false,'idle full live display does not duplicate the pane');
 await page.evaluate(()=>window.liveTest.m.destroy());
 assert.equal(await page.locator('.mapping-live-view').count(),0);
 console.log('PASS: live/map coordinate isolation, Drive renderer, independent data feeds, responsive panes, stale display, collapse/drawer rendering pause and cleanup. No robot connected.');
} finally {await browser.close();}
