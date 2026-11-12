// Requires npm run dev on port 5186. Renders fixtures only; never connects to a robot.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const [width,height] of [[1440,1000],[1024,768],[393,852],[320,740]]){
  const page=await browser.newPage({viewport:{width,height}});
  await page.goto('http://127.0.0.1:5186/?desktop=1');
  await page.locator('.pocket-home').waitFor();
  await page.evaluate(async()=>{
   const {MappingPage}=await import('/src/ui/components/mapping-page.ts');
   localStorage.setItem('go2_slam_maps',JSON.stringify([
    {id:'sP969bpGI9EuqtLv_NRkWQ',name:'Map 11/6/2026 11:39 AM',date:'2026-11-06T19:39:00Z'},
    {id:'very_long_id_that_must_not_overflow_the_map_card_1234567890',name:'Backup before mapping the living room and hallway with a very long map name',date:'2026-11-06T19:36:00Z'},
    {id:'third-map',name:'Room map',date:'2026-11-06T19:00:00Z'}]));
   const root=document.getElementById('app'); root.replaceChildren();root.className='app-root mapping-screen';
   window.layoutTest=new MappingPage(root,()=>{},()=>{},()=>{},()=>{},undefined,undefined,'layout-robot',()=>{});
  });
  await page.getByRole('button',{name:'Open mapping directions',exact:true}).click();
  await page.locator('.mapping-map-row').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const result=await page.evaluate(()=>{
   const errors=[];
   for(const row of document.querySelectorAll('.mapping-map-row')) {
    const box=row.getBoundingClientRect(),info=row.querySelector('.mapping-map-info').getBoundingClientRect();
    const buttons=[...row.querySelectorAll('button')].map(b=>({name:b.textContent,r:b.getBoundingClientRect()}));
    for(const {name,r} of buttons){
     if(r.left<box.left-1||r.right>box.right+1||r.top<info.bottom-1||r.bottom>box.bottom+1)errors.push(`out of card/over text: ${name}`);
     if(r.height<43)errors.push(`small target: ${name}`);
    }
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){
     const a=buttons[i].r,b=buttons[j].r;
     if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)errors.push('overlapping buttons');
    }
    if(row.scrollWidth>row.clientWidth+1)errors.push('horizontal overflow');
   }
   return {errors,cards:document.querySelectorAll('.mapping-map-row').length};
  });
  assert.deepEqual(result.errors,[],`${width}px: ${result.errors}`);
  await page.screenshot({path:`output/point-lio/map-layout-${width}.png`});
  console.log(`PASS ${width} x ${height}: ${result.cards} map cards, no overlapping controls/text, no horizontal overflow, touch targets fit.`);
  await page.close();
 }
}finally{await browser.close();}
