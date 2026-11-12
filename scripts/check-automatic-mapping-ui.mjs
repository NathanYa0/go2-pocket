import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({channel:'chrome',headless:true});
mkdirSync('output/mapping-ui', {recursive:true});
try {
 for (const [width,height] of [[1440,900],[852,393],[393,852]]) {
  const page = await browser.newPage({viewport:{width,height}});
  const commands = [];const payloads=[];let state = 'idle';
  await page.route('**/mapping-api/**', async route => {
   const path = new URL(route.request().url()).pathname.split('/').pop();
   if(route.request().method()==='POST') {
    commands.push(path);payloads.push(route.request().postDataJSON());
    if(path==='start') state='mapping';if(path==='explore')state='exploring';if(path==='pause')state='mapping';if(path==='stop')state='stopped';
   }
   const status = {state,runId:'test-run',running:['mapping','exploring'].includes(state),installed:true,message:state,pose:{position:[0,0,0.3],yaw:0,frame:'world',receivedAt:Date.now()}};
   const data = path==='cloud' ? {points:[[0,0,0],[1,1,0],[2,0,1]],frame:'world',capturedAt:Date.now()} : path==='maps' ? [] : status;
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
  await page.locator('.pocket-home').waitFor();
  await page.evaluate(async()=>{
   const {App}=await import('/src/ui/app.ts');
   document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.appendChild(root);
   window.testApp=new App(root);window.testApp.mobileNavigate('auto-mapping');
  });
  await page.getByRole('heading',{name:'Automatic mapping',exact:true}).waitFor();
  await page.waitForTimeout(200);
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button',{name:'Start new map',exact:true}).isDisabled(),true, 'Preview must never start the robot');
  await page.evaluate(async()=>{
   window.testApp.automaticMappingPage.destroy();
   const {AutomaticMappingPage}=await import('/src/ui/components/automatic-mapping-page.ts');
   // Direct component uses mocked HTTP routes; no real service can receive motion.
   window.testPage=new AutomaticMappingPage(document.querySelector('#app'),()=>{});
  });
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('button',{name:'Start new map',exact:true}).isDisabled(),true);
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Start new map',exact:true}).click();
  await page.getByRole('button',{name:'Explore',exact:true}).click();
  await page.getByRole('button',{name:'Pause movement',exact:true}).click();
  const hold=page.getByRole('button',{name:'Hold forward',exact:true});await hold.scrollIntoViewIfNeeded();
  const h=await hold.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
  await page.waitForTimeout(150);
  assert.ok(commands.includes('manual'));assert.ok(commands.includes('manual-stop'));
  const before=commands.filter(c=>c==='manual').length;await page.waitForTimeout(200);assert.equal(commands.filter(c=>c==='manual').length,before);
  await page.getByRole('button',{name:'Top view',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-place-flag]').disabled);
  const flag=page.locator('[data-place-flag]');await flag.scrollIntoViewIfNeeded();
  const f=await flag.boundingBox(),c=await page.locator('canvas').boundingBox();
  await page.mouse.move(f.x+f.width/2,f.y+f.height/2);await page.mouse.down();await page.mouse.move(c.x+c.width/2,c.y+c.height/2,{steps:6});await page.mouse.up();
  await page.getByRole('button',{name:'Go to flag',exact:true}).click();
  assert.ok(commands.includes('goal'));
  const goal=payloads[commands.lastIndexOf('goal')];assert.equal(goal.frame,'world');assert.equal(goal.runId,'test-run');assert.ok(Number.isFinite(goal.x)&&Number.isFinite(goal.y));
  await page.getByRole('button',{name:'Stop & Save',exact:true}).click();
  assert.deepEqual(commands.filter(c=>!['heartbeat','manual','manual-stop','goal'].includes(c)),['start','explore','pause','stop']);
  const bounds=await page.locator('.auto-map-buttons button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  assert.ok(bounds.every(r=>r.x>=0&&r.x+r.w<=width&&r.w>40));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`output/mapping-ui/${width}x${height}.png`});
  await page.getByRole('button',{name:'Controls ‹',exact:true}).click();
  assert.equal(await page.locator('aside').isVisible(),false);
  await page.close();
 }
 console.log('PASS: app mapping entry, supervised start, held/released manual drive, dragged flag coordinates, explore/pause/stop, drawer and three responsive sizes. Mock service only; no robot commands.');
} finally { await browser.close(); }
