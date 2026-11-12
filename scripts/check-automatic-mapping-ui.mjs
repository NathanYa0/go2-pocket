import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({channel:'chrome',headless:true});
mkdirSync('output/mapping-ui', {recursive:true});
try {
 for (const [width,height] of [[1440,900],[852,393],[393,852]]) {
  const page = await browser.newPage({viewport:{width,height}});
  const commands = [];let state = 'idle';
  await page.route('**/mapping-api/**', async route => {
   const path = new URL(route.request().url()).pathname.split('/').pop();
   if(route.request().method()==='POST') {
    commands.push(path);
    if(path==='start') state='mapping';if(path==='explore')state='exploring';if(path==='pause')state='mapping';if(path==='stop')state='stopped';
   }
   const status = {state,running:['mapping','exploring'].includes(state),installed:true,message:state};
   const data = path==='cloud' ? {points:[[0,0,0],[1,1,0],[2,0,1]],frame:'map',capturedAt:1} : path==='maps' ? [] : status;
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
  await page.getByRole('button',{name:'Stop & Save',exact:true}).click();
  assert.deepEqual(commands.filter(c=>c!=='heartbeat'),['start','explore','pause','stop']);
  const bounds=await page.locator('.auto-map-buttons button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  assert.ok(bounds.every(r=>r.x>=0&&r.x+r.w<=width&&r.w>40));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`output/mapping-ui/${width}x${height}.png`});
  await page.getByRole('button',{name:'Controls ‹',exact:true}).click();
  assert.equal(await page.locator('aside').isVisible(),false);
  await page.close();
 }
 console.log('PASS: app mapping entry, supervised start, explore/pause/stop, drawer and three responsive sizes. Mock service only; no robot commands.');
} finally { await browser.close(); }
