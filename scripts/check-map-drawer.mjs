import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:852,height:393}});
 await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
 await page.evaluate(async()=>{
  const {App}=await import('/src/ui/app.ts');const {installShell}=await import('/src/mobile/shell.ts');
  document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.appendChild(root);
  window.mapTest=new App(root);installShell(window.mapTest);window.mapTest.mobileNavigate('mapping');
 });
 await page.waitForSelector('.mapping-canvas');await page.waitForTimeout(300);
 mkdirSync('output/map-drawer',{recursive:true});
 for(const [w,h]of [[1440,900],[852,393],[667,375]]){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(300);
  const viewport=await page.locator('.mapping-viewport').boundingBox();
  assert.ok(viewport.width>=w-2,'map fills width');
  assert.ok(viewport.height>=h-95,'map fills space below compact header');
  const drawer=page.locator('.mapping-sidebar-right');
  assert.equal(await drawer.evaluate(el=>el.inert),true);
  await page.screenshot({path:`output/map-drawer/${w}-closed.png`});
  await page.getByRole('button',{name:'Open mapping directions',exact:true}).click();
  assert.equal(await drawer.evaluate(el=>el.inert),false);
  await page.getByRole('button',{name:'New Map + Anchor A',exact:true}).waitFor({state:'visible'});
  await page.waitForTimeout(250);
  const r=await drawer.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=w+1&&r.y+r.height<=h+1);
  await page.waitForTimeout(250);await page.screenshot({path:`output/map-drawer/${w}-open.png`});
  await drawer.getByRole('button',{name:'New Map + Anchor A',exact:true}).focus();await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Open mapping directions'}).getAttribute('aria-expanded'),'false');
 }
 // Display-only live voxels must never enter an active mapping/localization map.
 const routing=await page.evaluate(()=>{
  const m=window.mapTest.mappingPage;let count=0;
  m.slamScene.updateLiveLidar=()=>count++;
  m.setLiveLidar({displayOnly:true});const idle=count;
  m.setState('mapping');m.setLiveLidar({displayOnly:true});
  return {idle,after:count};
 });
 assert.equal(routing.idle,1);assert.equal(routing.after,1);
 console.log('PASS: full-width map, closed/open drawer, bounded scrolling panel, Escape, and idle-only live LiDAR routing. Preview only; no robot connected.');
}finally{await browser.close();}
