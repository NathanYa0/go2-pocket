import assert from 'node:assert/strict';
import {build}from'esbuild';import{chromium}from'playwright';import{mkdirSync}from'node:fs';
const{outputFiles}=await build({entryPoints:['src/ui/drive-speed.ts'],bundle:true,platform:'node',format:'esm',write:false});
const{scaleDriveInput}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
assert.deepEqual(scaleDriveInput({lx:1,ly:-1,rx:.5,ry:0,keys:512},50),{lx:.5,ly:-.5,rx:.25,ry:0,keys:512});
assert.deepEqual(scaleDriveInput({lx:0,ly:0,rx:0,ry:0},10),{lx:0,ly:0,rx:0,ry:0});
assert.equal(scaleDriveInput({lx:3,ly:0,rx:0,ry:0},200).lx,1);
assert.equal(scaleDriveInput({lx:1,ly:0,rx:0,ry:0},NaN).lx,0);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:852,height:393}});
 await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
 await page.evaluate(async()=>{
  const {App}=await import('/src/ui/app.ts');
  localStorage.removeItem('unitree_ui.driveSpeedPercent');
  document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.append(root);
  const app=new App(root);app.showControlUi();app.settingsDrawer.open();
  window.speedTest={app,sent:[]};app.dataHandler={publish:(topic,data)=>window.speedTest.sent.push({topic,data})};
 });
 const slider=page.getByRole('slider',{name:'Drive speed',exact:true});
 assert.equal(await slider.inputValue(),'100');
 await slider.fill('25');
 assert.equal(await page.evaluate(()=>localStorage.getItem('unitree_ui.driveSpeedPercent')),'25');
 await page.evaluate(()=>{window.speedTest.sent=[];window.speedTest.app.joystickState={lx:1,ly:-1,rx:1,ry:0};});
 await page.waitForTimeout(110);
 let latest=await page.evaluate(()=>window.speedTest.sent.at(-1).data);
 assert.deepEqual(latest,{lx:.25,ly:-.25,rx:.25,ry:0},'actual touch publishing path uses the slider');
 await page.evaluate(()=>{
  const a=window.speedTest.app;a.joystickState={lx:0,ly:0,rx:0,ry:0};a.activeSourceId='gamepad:test';
  a.gamepadManager={currentState:{lx:1,ly:.5,rx:-1,ry:0,keys:512}};
 });
 await page.waitForTimeout(110);latest=await page.evaluate(()=>window.speedTest.sent.at(-1).data);
 assert.deepEqual(latest,{lx:.25,ly:.125,rx:-.25,ry:0,keys:512},'gamepad axis scaling preserves button bits');
 await page.evaluate(async()=>{
  const {nativeBle}=await import('/src/mobile/native-ble.ts');
  const old=nativeBle.subscribe.bind(nativeBle);
  nativeBle.subscribe=(topic,cb)=>topic==='remote_state'?(window.speedTest.bt=cb,()=>{}):old(topic,cb);
  window.speedTest.app.setActiveInputSource('bt:test');
  window.speedTest.bt({lx:-1,ly:1,rx:1,ry:0,buttons:{}});
 });
 latest=await page.evaluate(()=>window.speedTest.sent.at(-1).data);
 assert.deepEqual(latest,{lx:-.25,ly:.25,rx:.25,ry:0,keys:0},'BT relay uses the same speed multiplier');
 await page.evaluate(()=>{
  const a=window.speedTest.app;a.activeSourceId=null;a.joystickState={lx:0,ly:0,rx:0,ry:0};
  a.joystickReleaseTicks=1;
 });
 await page.waitForTimeout(60);latest=await page.evaluate(()=>window.speedTest.sent.at(-1).data);
 assert.deepEqual(latest,{lx:0,ly:0,rx:0,ry:0},'release stays zero');
 mkdirSync('output/drive-speed',{recursive:true});await page.screenshot({path:'output/drive-speed/controls.png'});
 // A fresh App instance must restore the saved setting.
 assert.equal(await page.evaluate(async()=>{const{App}=await import('/src/ui/app.ts');const root=document.createElement('div');return new App(root).settingsState.driveSpeedPercent;}),25);
 console.log('PASS: speed slider, persistence, touch/gamepad/BT wire scaling, preserved keys, zero release and invalid/bounded inputs. Preview only; no robot connected.');
}finally{await browser.close();}
