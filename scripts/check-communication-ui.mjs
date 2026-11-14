import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const wav = Buffer.alloc(44+32000);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(32000,40);
for(let i=0;i<16000;i++)wav.writeInt16LE(Math.round(5000*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
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
   const {Communication}=await import('/src/ui/communication.ts');const {convertFileToWav}=await import('/src/ui/audio-recorder.ts');const {openCommunicationPanel}=await import('/src/ui/components/communication-panel.ts');
   window.events=[];let files=[{UNIQUE_ID:'prior-upload',CUSTOM_NAME:'UserAudio_previous.wav'}];let id=0;let panel;
   const c=window.communication=new Communication({available:()=>true,convertFile:convertFileToWav,
    recorder:()=>({start:async()=>window.events.push('record'),stop:async()=>new ArrayBuffer(100),destroy:()=>window.events.push('destroy')}),
    request:async(api,payload)=>{const data=JSON.parse(payload);window.events.push([api,data]);if(api===1001)return {audio_list:files};if(api===1010)return{play_mode:'list_loop'};if(api===1009)files=files.filter(x=>x.UNIQUE_ID!==data.unique_id);return {};},
    upload:async(wav,name)=>{files.push({UNIQUE_ID:String(++id),CUSTOM_NAME:name});},offerPaw:()=>window.events.push('paw'),dance:()=>{window.events.push('dance');return 55;},stopDance:()=>window.events.push('dance-stop'),state:s=>panel?.render(s)});
   panel=openCommunicationPanel(c);
   // Register the real panel with App so shell lifecycle events exercise the
   // same close path as a connected session, not just an isolated component.
   window.testApp.closeCommunicationPanel=panel.close;
  });
  await page.getByRole('button',{name:'Record Hi',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Hi',exact:true}).click();
  await page.getByRole('button',{name:'Re-record Hi',exact:true}).waitFor();
  await page.getByRole('button',{name:'Play Hi',exact:true}).click();
  await page.getByRole('button',{name:'Record Nice to meet you',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Nice to meet you',exact:true}).click();
  await page.getByRole('button',{name:'Play Nice to meet you and offer paw',exact:true}).click();
  await page.waitForFunction(()=>window.events.includes('paw'));
  assert.equal(await page.locator('[data-down]').count(),0);
  await page.getByRole('button',{name:'Stop audio',exact:true}).click();
  await page.getByRole('button',{name:'Record Explain instructions',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Explain instructions',exact:true}).click();
  await page.getByRole('button',{name:'Play Explain instructions',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.equal(await page.evaluate(()=>window.events.filter(e=>e==='paw').length),1,'Instructions must not trigger another paw gesture');
  await page.getByRole('button',{name:'Re-record Hi',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Hi',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.equal(await page.evaluate(()=>window.events.filter(e=>Array.isArray(e)&&e[0]===1009).length),1);
  assert.equal(await page.getByText('Recording reply prompts',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Upload audio for/}).count(),5);
  const beforeUpload=await page.evaluate(()=>({plays:window.events.filter(e=>Array.isArray(e)&&e[0]===1002).length,paws:window.events.filter(e=>e==='paw').length}));
  for(const label of ['Hi','Nice to meet you','Explain instructions','Music','After Voice line 1','Hi']) {
   const chooser=page.waitForEvent('filechooser');
   await page.getByRole('button',{name:`Upload audio for ${label}`,exact:true}).click();
   const suspended=await page.evaluate(()=>{
    const app=window.testApp;const previous=app.dataHandler;const commands=[];
    app.dataHandler={publish:(topic,data)=>commands.push(data)};
    app.activeSourceId='gamepad:test';app.joystickState={lx:1,ly:1,rx:1,ry:1};
    window.dispatchEvent(new Event('blur'));
    const result={commands,state:app.joystickState,source:app.activeSourceId};app.dataHandler=previous;return result;
   });
   assert.deepEqual(suspended,{commands:[{lx:0,ly:0,rx:0,ry:0,keys:0}],state:{lx:0,ly:0,rx:0,ry:0},source:null},'Picker blur still stops all drive input');
   await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
   });
   assert.equal(await page.getByRole('dialog',{name:'Communication',exact:true}).count(),1,'Native file-picker blur must not close Communication');
   await (await chooser).setFiles({name:'greeting.wav',mimeType:'audio/wav',buffer:wav});
   await page.waitForFunction(()=>window.communication.state.phase==='idle');
   assert.match(await page.locator('.communication-panel [role=status]').innerText(),/Voice saved on Go2/);
  }
  const afterUpload=await page.evaluate(()=>({plays:window.events.filter(e=>Array.isArray(e)&&e[0]===1002).length,paws:window.events.filter(e=>e==='paw').length}));
  assert.deepEqual(afterUpload,beforeUpload,'Uploads must not play audio or move Go2');
  // Hold a real controller upload open while using the playback buttons.
  await page.evaluate(()=>{
   const opts=window.communication.options;window.originalUpload=opts.upload;
   opts.upload=async(...args)=>{args[3]?.(25);await new Promise(r=>window.finishUpload=r);return window.originalUpload(...args);};
  });
  await page.getByRole('button',{name:'Record Voice line 1',exact:true}).click();
  await page.getByRole('button',{name:'Stop and save Voice line 1',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.uploadPercent===25);
  assert.equal(await page.getByRole('button',{name:'Play After Voice line 1',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Stop audio',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Play After Voice line 1',exact:true}).click();
  await page.waitForFunction(()=>!window.communication.state.audioBusy);
  assert.equal(await page.evaluate(()=>window.communication.state.phase),'saving');
  assert.equal(await page.getByRole('progressbar',{name:'Audio upload progress'}).getAttribute('value'),'25');
  await page.getByRole('button',{name:'Stop audio',exact:true}).click();
  await page.waitForFunction(()=>!window.communication.state.audioBusy);
  await page.evaluate(()=>{window.finishUpload();window.communication.options.upload=window.originalUpload;});
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  await page.getByRole('button',{name:'Play Music',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='music');
  await page.evaluate(()=>window.communication.music.playbackState({is_playing:true,current_audio_unique_id:window.communication.state.clips.music.UNIQUE_ID}));
  assert.equal(await page.evaluate(()=>window.events.filter(e=>e==='dance').length),1);
  assert.equal(await page.getByRole('button',{name:'Upload audio for Hi',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Stop music',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.equal(await page.evaluate(()=>window.events.filter(e=>e==='dance-stop').length),1);
  await page.getByRole('button',{name:'Play song only',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.match(await page.locator('.communication-panel [role=status]').innerText(),/song only/);
  assert.equal(await page.evaluate(()=>window.events.filter(e=>e==='dance').length),1,'Song-only button must not issue a dance command');
  await page.getByRole('button',{name:'Play song only',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`output/communication-ui/music-${size.width}x${size.height}.png`});
  const afterMusic=await page.evaluate(()=>({plays:window.events.filter(e=>Array.isArray(e)&&e[0]===1002).length,paws:window.events.filter(e=>e==='paw').length}));
  const savedId=await page.evaluate(()=>window.communication.state.clips.hi.UNIQUE_ID);
  await page.getByLabel('Audio file for Hi',{exact:true}).setInputFiles({name:'broken.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('not audio')});
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  assert.match(await page.locator('.communication-panel [role=status]').innerText(),/Could not read/);
  assert.equal(await page.evaluate(()=>window.communication.state.clips.hi.UNIQUE_ID),savedId);
  await page.getByLabel('Audio file for Hi',{exact:true}).setInputFiles([]);
  assert.equal(await page.evaluate(()=>window.communication.state.clips.hi.UNIQUE_ID),savedId,'Cancelling the picker keeps the clip');
  await page.getByRole('button',{name:'Refresh saved audio',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.phase==='idle');
  const hiRecovery=page.locator('.communication-slot').filter({has:page.getByRole('heading',{name:'Hi',exact:true})}).locator('details');
  await hiRecovery.locator('summary').click();
  await page.getByLabel('Saved audio for Hi',{exact:true}).selectOption('prior-upload');
  await page.getByRole('button',{name:'Use selected clip for Hi',exact:true}).click();
  await page.waitForFunction(()=>window.communication.state.clips.hi.UNIQUE_ID==='prior-upload');
  assert.equal(await page.getByRole('button',{name:'Play Hi',exact:true}).isEnabled(),true);
  assert.deepEqual(await page.evaluate(()=>({plays:window.events.filter(e=>Array.isArray(e)&&e[0]===1002).length,paws:window.events.filter(e=>e==='paw').length})),afterMusic,'Selecting existing audio never plays or moves Go2');
  const bounds=await page.locator('.communication-panel').boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width+1&&bounds.y+bounds.height<=size.height+1);
  assert.ok(await page.locator('.communication-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  const buttons=await page.locator('.communication-panel .communication-tools').boundingBox();
  assert.ok(buttons.y>=0&&buttons.y+buttons.height<=size.height,'Stop audio stays visible');
  const content=await page.locator('.communication-content').boundingBox();
  assert.ok(buttons.y+buttons.height<=content.y+1,'Stop audio is above the scrolling recordings');
  for(const scroll of [0,100000]) {
   await page.locator('.communication-content').evaluate((el,y)=>el.scrollTop=y,scroll);
   const reachable=await page.locator('[data-stop]').evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);});
   assert.ok(reachable,'Stop audio remains clickable at either end of the list');
  }
  await page.locator('.communication-content').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`output/communication-ui/${size.width}x${size.height}.png`});
  const cancelledChooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload audio for Hi',exact:true}).click();
  await (await cancelledChooser).setFiles([]);
  await page.getByLabel('Audio file for Hi',{exact:true}).dispatchEvent('cancel',{bubbles:true});
  assert.equal(await page.getByRole('dialog',{name:'Communication',exact:true}).count(),1,'Cancelling a file choice must not cancel the containing dialog');
  await page.getByRole('button',{name:'Re-record Voice line 1',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(()=>window.communication.state.phase==='closed');
  assert.equal(await page.getByRole('dialog').count(),0,'Normal focus loss still closes Communication and cancels recording');assert.deepEqual(errors,[]);
  console.log(`PASS Communication layout, record/play, picker blur/visibility, neutral drive, picker cancel and recording suspension ${size.width}x${size.height}`);
  await page.close();
 }
}finally{await browser.close();}
