import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('output/communication-ui',{recursive:true});
try {
 for(const size of [{width:1440,height:900},{width:852,height:393},{width:393,height:852},{width:568,height:300}]) {
  const page=await browser.newPage({viewport:size.width<size.height ? {width:852,height:393} : size});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
  await page.evaluate(async()=>{
   const {App}=await import('/src/ui/app.ts');const {installShell}=await import('/src/mobile/shell.ts');
   document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.appendChild(root);
   window.testApp=new App(root);installShell(window.testApp);window.testApp.showControlUi();
  });
  const shortcut=page.getByRole('button',{name:'Communication',exact:true});await shortcut.click();
  await page.getByRole('dialog',{name:'Communication',exact:true}).waitFor();
  await page.setViewportSize(size);
  assert.equal(await page.getByRole('button',{name:'Record Hi',exact:true}).isDisabled(),true,'preview cannot send robot commands');
  await page.getByRole('button',{name:'Close Communication'}).click();
  // Exercise the real component with an in-memory robot library. No network or hardware requests.
  await page.evaluate(async()=>{
   const {Communication}=await import('/src/ui/communication.ts');const {openCommunicationPanel}=await import('/src/ui/components/communication-panel.ts');
   window.events=[];let files=[];let id=0;let panel;
   const c=window.communication=new Communication({available:()=>true,
    recorder:()=>({start:async()=>window.events.push('record'),stop:async()=>new ArrayBuffer(100),destroy:()=>window.events.push('destroy')}),
    request:async(api,payload)=>{const data=JSON.parse(payload);window.events.push([api,data]);if(api===1001)return {audio_list:files};if(api===1010)return{play_mode:'list_loop'};if(api===1009)files=files.filter(x=>x.UNIQUE_ID!==data.unique_id);return {};},
    upload:async(wav,name)=>{files.push({UNIQUE_ID:String(++id),CUSTOM_NAME:name});},offerPaw:()=>window.events.push('paw'),lowerPaw:()=>window.events.push('down'),state:s=>panel?.render(s)});
   panel=openCommunicationPanel(c);
  });
  await page.getByRole('button',{name:'Record Hi',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Hi',exact:true}).click();
  await page.getByRole('button',{name:'Re-record Hi',exact:true}).waitFor();
  await page.getByRole('button',{name:'Play Hi',exact:true}).click();
  await page.getByRole('button',{name:'Record Nice to meet you',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Nice to meet you',exact:true}).click();
  await page.getByRole('button',{name:'Play Nice to meet you and offer paw',exact:true}).click();
  await page.waitForFunction(()=>window.events.includes('paw'));
  await page.getByRole('button',{name:'Lower paw',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.events.includes('down')));
  await page.getByRole('button',{name:'Record Explain instructions',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Explain instructions',exact:true}).click();
  await page.getByRole('button',{name:'Play Explain instructions',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.equal(await page.evaluate(()=>window.events.filter(e=>e==='paw').length),1,'Instructions must not trigger another paw gesture');
  await page.getByRole('button',{name:'Re-record Hi',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Hi',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.equal(await page.evaluate(()=>window.events.filter(e=>Array.isArray(e)&&e[0]===1009).length),1);
  const bounds=await page.locator('.communication-panel').boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width+1&&bounds.y+bounds.height<=size.height+1);
  assert.ok(await page.locator('.communication-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  const buttons=await page.locator('.communication-panel .communication-tools').boundingBox();
  assert.ok(buttons.y>=0&&buttons.y+buttons.height<=size.height,'Lower paw and Stop audio stay visible');
  const content=await page.locator('.communication-content').boundingBox();
  assert.ok(buttons.y+buttons.height<=content.y+1,'Lower paw is above the scrolling recordings');
  for(const scroll of [0,100000]) {
   await page.locator('.communication-content').evaluate((el,y)=>el.scrollTop=y,scroll);
   const reachable=await page.locator('[data-down]').evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);});
   assert.ok(reachable,'Lower paw remains clickable at either end of the list');
  }
  await page.locator('.communication-content').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`output/communication-ui/${size.width}x${size.height}.png`});
  await page.getByRole('button',{name:'Record Voice line 1',exact:true}).click();
  await page.getByRole('button',{name:'Close Communication'}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='closed');
  assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
  console.log(`PASS Communication layout and record/play/replace/paw/cancel ${size.width}x${size.height}`);
  await page.close();
 }
}finally{await browser.close();}
