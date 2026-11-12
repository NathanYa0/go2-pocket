import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:852,height:393}});
 await page.goto('http://127.0.0.1:5186/?preview=1&desktop=1');
 await page.evaluate(async()=>{
  const {App}=await import('/src/ui/app.ts');const {installShell}=await import('/src/mobile/shell.ts');
  document.body.replaceChildren();const root=document.createElement('div');root.id='app';document.body.appendChild(root);
  window.testApp=new App(root);installShell(window.testApp);window.testApp.showControlUi();
 });
 await page.waitForSelector('.joystick-box');
 assert.equal(await page.locator('.joystick-box').count(),2);
 assert.equal(await page.locator('.control-overlay').evaluate(el=>getComputedStyle(el).transform),'none');
 // Actions must stay visible without tapping the background.
 await page.waitForTimeout(4200);
 await page.getByRole('button',{name:'Trick or Treat',exact:true}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'Actions',exact:true}).click();
 await page.getByText('Back Flip',{exact:true}).waitFor({state:'visible'});
 await page.locator('.action-popup').getByText('Roll Over',{exact:true}).waitFor({state:'visible'});
 await page.getByText('Sit Down',{exact:true}).waitFor({state:'visible'});
 await page.evaluate(()=>window.testApp.actionBar.togglePopup());
 await page.getByRole('button',{name:'Open mapping',exact:true}).click();
 await page.waitForSelector('.mapping-page');
 console.log('PASS: original unscaled Drive, both joysticks, Trick or Treat, full Actions menu and added Map button. Preview only; no robot commands.');
}finally{await browser.close();}
