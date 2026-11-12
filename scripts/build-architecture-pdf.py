"""Generate the component overview; no robot connection or commands."""
from pathlib import Path
from math import atan2, cos, sin
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import simpleSplit
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/go2-pocket-architecture.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 842, 595
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('Go2 Pocket | Component architecture')
NAVY='#172E41'; TEAL='#087E83'; GRAY='#526777'; PALE='#EEF5F7'; LINE='#A6BCC7'; AMBER='#8C5A11'
def text(x,y,t,size=10,color=NAVY,font='Helvetica'):
 c.setFillColor(HexColor(color)); c.setFont(font,size); c.drawString(x,y,t)
def header(n,title,sub):
 text(36,557,'GO2 POCKET / CODE MAP',10,TEAL,'Helvetica-Bold')
 text(36,524,title,25,font='Helvetica-Bold')
 text(36,503,sub,10,GRAY)
 c.setStrokeColor(HexColor(LINE));c.line(36,30,W-36,30)
 text(36,16,'Repository inspection / 07 Nov 2026 / conceptual components, not a complete import graph',8,GRAY)
 text(W-60,16,str(n),8,GRAY)
def box(x,y,w,h,title,lines,tone=TEAL):
 c.setFillColor(HexColor(PALE));c.setStrokeColor(HexColor(tone));c.setLineWidth(.8)
 c.roundRect(x,y,w,h,7,fill=1,stroke=1)
 text(x+12,y+h-21,title,12,tone,'Helvetica-Bold')
 yy=y+h-39
 for line in lines:
  text(x+12,yy,line,9);yy-=13
 return x,y,w,h
def arrow(x1,y1,x2,y2,label=None):
 c.setStrokeColor(HexColor(GRAY));c.setFillColor(HexColor(GRAY));c.setLineWidth(1)
 c.line(x1,y1,x2,y2);a=atan2(y2-y1,x2-x1);p=c.beginPath();p.moveTo(x2,y2)
 p.lineTo(x2-6*cos(a-.45),y2-6*sin(a-.45));p.lineTo(x2-6*cos(a+.45),y2-6*sin(a+.45));p.close();c.drawPath(p,fill=1,stroke=0)
 if label:text((x1+x2)/2+5,(y1+y2)/2+5,label,8,GRAY)
def para(x,y,t,width,size=10,color=GRAY):
 for line in simpleSplit(t,'Helvetica',size,width): text(x,y,line,size,color);y-=size*1.4
 return y
header(1,'How the app is put together','Most code runs on the computer or phone. Robot services run on Go2 itself.')
box(36,397,235,80,'1  Screens + platform',['Home / Drive / Maps / Settings','main.ts, mobile/, UI components','Browser or Capacitor iOS / Android'])
box(304,397,234,80,'2  App coordinator',['ui/app.ts','Connects screens, state and features','Routes commands and incoming data'])
arrow(271,437,304,437)
box(571,397,235,80,'3  Features',['Drive, actions, Parrot audio','Mapping, localization, anchor return','Experimental mapping explorer'])
arrow(538,437,571,437)
box(571,254,235,94,'Local data + visualization',['storage/map-pcd-store.ts','Map bundles + anchor A in IndexedDB','ui/scene/: Three.js display','workers/: cloud decoding, not SLAM'])
arrow(688,397,688,348)
box(304,254,234,94,'4  Protocol + connection',['protocol/: topics, requests, validation','connection/: WebRTC setup + streams','crypto/: authentication primitives','Commands out / telemetry + media in'])
c.line(571,410,555,410);c.line(555,410,555,372)
arrow(555,372,421,372);arrow(421,372,421,348)
text(580,368,'feature requests via coordinator',8,GRAY)
box(36,254,235,94,'Supporting access paths',['api/: cloud account + remote access','mobile/: native Bluetooth + Wi-Fi setup','proxy-plugin.ts: desktop dev HTTP proxy','These support setup / connection'])
arrow(271,302,304,302)
box(304,111,234,94,'5  Go2 robot',['Motion controller + camera + microphone','Processed LiDAR + pose / IMU telemetry','Onboard mapping, localization, navigation','Robot stores one active map slot'])
arrow(415,254,415,205);arrow(431,205,431,254)
text(445,225,'WebRTC',9,TEAL,'Helvetica-Bold')
para(36,184,'Read arrows as component relationships. Data and commands return through the app coordinator; this drawing compresses those routes.',235,10)
box(571,111,235,94,'Separate experimental tool',['integrations/point-lio/native/','C++ Point-LIO estimator on Mac','Runs independently of the app','Live raw LiDAR input still unresolved'],AMBER)
text(36,66,'Key boundary',10,TEAL,'Helvetica-Bold')
text(120,66,'The browser displays and controls maps; onboard Go2 services perform the current live SLAM.',11)
c.showPage()
header(2,'Mapping: the part we are building','Step 1 exploration collects a map; localization and returning to A are separate stages.')
box(36,367,236,105,'Robot + sensor stream',['Go2 onboard mapping service','rt/uslam/frontend/cloud_world_ds','rt/uslam/frontend/odom','Sport state: IMU, speed, height, battery'])
box(303,367,236,105,'Mapping page + decoding',['components/mapping-page.ts','Starts/stops mapping; captures anchor A','workers/slam-worker.ts + WASM','Current XYZ scan + accepted live pose'])
box(570,367,236,105,'Two consumers',['scene/slam-scene.ts -> 3D display','mapping-explorer.ts -> trial controller','exploration-floor.ts -> floor estimate','exploration-grid.ts -> body/sweep checks'])
arrow(272,418,303,418);arrow(539,418,570,418)
box(570,216,236,99,'Movement path',['exploration-motion.ts bounds requests','Move 1008 / StopMove 1003','Protocol -> WebRTC -> Go2','Sensor feedback checked each tick'])
arrow(688,367,688,315)
box(303,216,236,99,'Map + anchor storage',['storage/map-pcd-store.ts','Save PCD / PGM / TXT + anchor A','IndexedDB cache; ZIP import / export','Robot map can be backed up / restored'])
arrow(421,367,421,315)
box(36,216,236,99,'Later: localize + return',['map-anchor.ts + mapping page','Load saved map; start localization','Verify robot position before navigation','Send anchor goal to onboard service'])
arrow(303,265,272,265)
text(36,180,'Where the implementation stands',13,TEAL,'Helvetica-Bold')
y=para(36,158,'Implemented: map storage, anchor persistence, visualization, Parrot audio, movement guards and the experimental Step 1 controller. Tests and build pass for the latest startup-sequence changes.',770,10)
y=para(36,y-9,'Unresolved: real autonomous walking. The last trial sent 35 Move requests; the user saw only a forward jolt with no feet stepping. The pose estimate is not proof of physical travel. The trial stopped on stale LiDAR data.',770,10,NAVY)
para(36,y-9,'Resume point: diagnose motion-command execution and control readiness. Do not infer that mapping, localization or autonomous return is physically validated merely because requests were sent. See docs/session-handoff.md and docs/exploration-mapping.md.',770,10)
c.save()
print(OUT)
