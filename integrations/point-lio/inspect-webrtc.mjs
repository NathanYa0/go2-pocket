import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { chromium } from 'playwright';
const env = parseEnv(readFileSync('.env', 'utf8'));
if(process.argv.includes('--activate')) {
  const backupDir=process.argv[process.argv.indexOf('--activate')+1];
  for(const name of ['map.pcd','map.pgm','map.txt']) {
    if(!backupDir||readFileSync(`${backupDir}/${name}`).length===0) throw Error('Nonempty map backup required');
  }
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5186/', { waitUntil: 'networkidle' });
  const report = await page.evaluate(async ({ip,sn,key,backup,activate}) => {
    const {connectLocal} = await import('/src/connection/local-connector.ts');
    const {DataChannelHandler} = await import('/src/protocol/data-channel.ts');
    localStorage.setItem('unitree_aes_keys_v1',JSON.stringify({[sn]:key}));
    const topics=['rt/lf/sportmodestate','rt/sportmodestate','rt/utlidar/cloud','rt/utlidar/cloud_deskewed','rt/utlidar/imu','rt/utlidar/transformed_imu','rt/utlidar/transformed_raw_imu','rt/utlidar/robot_pose','rt/lf/lowstate','rt/lowstate','rt/utlidar/voxel_map_compressed','rt/utlidar/lidar_state','rt/uslam/server_log'];
    topics.push('rt/utlidar/voxel_map','rt/uslam/frontend/cloud_world_ds',
      'rt/uslam/frontend/odom','rt/uslam/cloud_map','rt/uslam/localization/odom',
      'rt/uslam/localization/cloud_world','rt/uslam/navigation/global_path',
      'rt/mapping/grid_map','rt/lio_sam_ros2/mapping/odometry','rt/pctoimage_local',
      'rt/qt_notice','rt/uwbstate','rt/multiplestate','rt/servicestate','rt/selftest');
    const samples={}, lastSamples={}, counts={}, timing={}, rpc=[], serverLogs=[];
    let dc, rtc, valid;
    const pendingMessages=[];
    const ready=new Promise(resolve=>valid=resolve);
    const snapshot = (value,depth=0) => {
      if(value instanceof ArrayBuffer) return {binaryBytes:value.byteLength};
      if(ArrayBuffer.isView(value)) return {view:value.constructor.name,length:value.length};
      if(depth>6) return '[nested]';
      if(Array.isArray(value)) return value.length>30?{arrayLength:value.length,first:value.slice(0,2).map(v=>snapshot(v,depth+1))}:value.map(v=>snapshot(v,depth+1));
      if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,snapshot(v,depth+1)]));
      return typeof value==='string'&&value.length>5000?value.slice(0,5000):value;
    };
    const callbacks={onStateChange(){},onVideoTrack(){},onAudioTrack(){},onValidated(){valid();},onMessage(msg){if(dc) dc.handleMessage(msg);else pendingMessages.push(msg);}};
    rtc=await connectLocal(ip,'STA-L',callbacks,()=>{}, {sn});
    dc=new DataChannelHandler(rtc,callbacks);
    dc.onTopicData=msg=>{
      counts[msg.topic]=(counts[msg.topic]||0)+1;
      if(!samples[msg.topic]) samples[msg.topic]=snapshot(msg.data);
      lastSamples[msg.topic]=snapshot(msg.data);
      const now=performance.now();
      const t=timing[msg.topic]??={firstMs:now,lastMs:now};
      t.lastMs=now;
      if(msg.topic==='rt/api/bashrunner/response') rpc.push(snapshot(msg.data));
      if(msg.topic==='rt/uslam/server_log') serverLogs.push(snapshot(msg.data));
    };
    try {
      for(const msg of pendingMessages) dc.handleMessage(msg);
      await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Validation timed out')),30000))]);
      dc.publishTyped('',{req_type:'disable_traffic_saving',instruction:'on'},'rtc_inner_req');
      for(const topic of topics) dc.subscribe(topic);
      for(const cmd of ['mapping/get_status','localization/get_status','navigation/get_status','frontend/get_status','control/get_status','patrol/get_status','autocharge/get_status','common/get_map_id','mapping/get_cloud_map']) dc.publish('rt/uslam/client_command',cmd);
      await new Promise(resolve=>setTimeout(resolve,10000));
      const activation=[];
      if(activate) {
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const command=async(cmd,ms=1500)=>{
          const start=serverLogs.length;
          dc.publish('rt/uslam/client_command',cmd);
          await wait(ms);
          const logs=serverLogs.slice(start);
          activation.push({command:cmd,logs});
          return logs;
        };
        let testStarted=false;
        try {
          // Existing statuses must be idle before a bounded activation test.
          for(const service of ['mapping','localization','navigation','patrol','autocharge']) {
            if(!serverLogs.includes(`${service}/get_status/status/0`)) throw Error(`${service} is not confirmed idle`);
          }
          testStarted=true;
          const started=await command('mapping/start',8000);
          if(!started.includes('mapping/start/success')) throw Error('Mapping start was not acknowledged');
          await command('mapping/get_status');
          await command('mapping/stop',8000);
          await command('mapping/get_status');
          const loc=await command('localization/start',8000);
          await command('localization/get_status');
          const localized=serverLogs.some(v=>typeof v==='string'&&v.includes('[Localization] initialization succeed!'));
          if(localized) {
            await command('navigation/start',3000);
            await command('navigation/get_status');
          } else {
            activation.push({navigationSkipped:'Localization has not reported successful initialization; no goal was sent.'});
          }
        } catch(error) {activation.push({error:String(error)});}
        finally {
          if(testStarted) {
          // End the diagnostic session with services stopped, without any goals.
          await command('navigation/stop');
          await command('localization/stop');
          await command('mapping/stop');
          for(const service of ['mapping','localization','navigation']) await command(`${service}/get_status`);
          }
        }
      }
      const files={};
      if(backup) {
        for(const name of ['map.pcd','map.pgm','map.txt']) {
          files[name]=await new Promise(resolve=>dc.requestFile(name,resolve));
          if(name==='map.pcd'&&!files[name]) break;
        }
      }
      return {activation,files,observedAt:new Date().toISOString(),topics,counts,timing,samples,lastSamples,rpc,serverLogs};
    } finally {dc.destroy();rtc.close();}
  }, {ip:env.IP_ADDRESS.trim(),sn:env.DOGID.trim(),key:env.UNITREE_AES_KEY.trim(),backup:process.argv.includes('--backup'),activate:process.argv.includes('--activate')});
  if(report.files&&Object.keys(report.files).length) {
    const dir=`output/point-lio/inspection/map-backup-${Date.now()}`;
    mkdirSync(dir,{recursive:true,mode:0o700});
    for(const [name,b64] of Object.entries(report.files)) {
      if(b64) writeFileSync(`${dir}/${name}`,Buffer.from(b64,'base64'),{mode:0o600});
    }
    report.backup={directory:dir,files:Object.fromEntries(Object.entries(report.files).map(([name,b64])=>[name,b64?Buffer.from(b64,'base64').length:0]))};
    console.log(JSON.stringify({backup:report.backup}));
  }
  delete report.files;
  writeFileSync('output/point-lio/inspection/sensor-report.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({activation:report.activation,counts:report.counts,rpcResponses:report.rpc.length,report:'output/point-lio/inspection/sensor-report.json'}));
} finally {await browser.close();}
