import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compile = async file => {
  const { outputFiles } = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
};
const { MappingExplorer, MappingStartStability, EXPLORE_LIDAR_TIMEOUT_MS } = await compile('src/ui/mapping-explorer.ts');
const { ExplorationGrid, OBSTACLE_MIN_RETURNS, OBSTACLE_MIN_HEIGHT_METRES, DROP_MIN_DEPTH_METRES } = await compile('src/ui/exploration-grid.ts');
function floor(radius = 1.5) {
  const points = [];
  for (let x = -radius; x <= radius + 0.001; x += 0.1) for (let y = -radius; y <= radius + 0.001; y += 0.1) points.push(x, y, 0);
  return new Float32Array(points);
}
const room = floor();
const explorationRoom = floor(2.5);
const cluster = (x,y,z) => new Float32Array([x,y,z,x,y,z+.05,x,y,z+.1,x,y,z+.15,x,y,z+.2]);
const confirmObstacle = (grid,points,at) => { grid.observe(points,at); grid.observe(points,at+2000); };
function fixture() {
  const f = { now: 0, moves: [], results: [], status: [] };
  f.context = { mapping: true, session: 'session-a', pose: { x: 0, y: 0, z: 0.32, yaw: 0, at: 0, session: 'session-a' },
    telemetry: { at: 0, battery: 80, batteryAt: 0, bodyHeight: 0.32, speed: 0, roll: 0, pitch: 0 } };
  f.accept = true;
  f.controller = new MappingExplorer({ context: () => f.context, now: () => f.now,
    move: (x, yaw) => { f.moves.push([x, yaw]); return f.accept; },
    status: text => f.status.push(text), finish: result => f.results.push(result) });
  f.refresh = (ms, points = explorationRoom) => {
    f.now += ms; f.context.pose.at = f.now; f.context.telemetry.at = f.now; f.context.telemetry.batteryAt = f.now;
    f.controller.cloud(points, f.now, f.context.session);
  };
  return f;
}
const moving = f => f.moves.filter(([x, yaw]) => x !== 0 || yaw !== 0);

const grid = new ExplorationGrid({ x: 0, y: 0 }, 0);
assert.equal(grid.clear(0, 0, 0), false, 'unknown cells are not free');
grid.observe(room, 0);
assert.equal(grid.clear(0, 0, 0), true);
assert.equal(grid.clear(1.3, 0, 0), false, 'body clearance extends beyond the target point');
assert.equal(grid.clear(0, 0, 1501), false, 'old floor observations cannot authorize movement');
assert.equal(grid.clear(0, 0, 1501, false), true, 'old floor may only support the connectivity check');
assert.ok(grid.next({ x: 0, y: 0 }, 0), 'a frontier can be reached in a short checked step');
confirmObstacle(grid,cluster(0.3,0,.2),1);
assert.equal(grid.clear(0, 0, 1), false, 'obstacle inside the body envelope blocks motion');
grid.observe(room, 2);
assert.equal(grid.clear(0, 0, 2), false, 'new floor points cannot erase an obstacle');
const drop = new ExplorationGrid({ x: 0, y: 0 }, 0);
drop.observe(room, 0); drop.observe(new Float32Array([0.3, 0, -0.2]), 1);
assert.equal(drop.dropStatus({x:0,y:0,yaw:0},{x:0,y:0,yaw:0}),'pending');
drop.observe(new Float32Array([0.3, 0, -0.2]),2001);
assert.equal(drop.clear(0, 0, 1), false, 'lower returns are treated as a possible drop');
assert.equal(drop.observe(new Float32Array(300003), 2), 0, 'oversized input is rejected, not partially inserted');
assert.equal(drop.observe(new Float32Array([NaN, 0, 0]), 2), 0);

const f = fixture(); f.controller.start(); f.refresh(4999); f.controller.tick();
assert.equal(moving(f).length, 0, 'the initial scan issues no motion');
f.refresh(2); f.controller.tick();
assert.ok(moving(f).length > 0, 'observed floor permits a bounded exploration command');
assert.ok(f.moves.every(([x, yaw]) => x >= 0 && x <= 0.4 && Math.abs(yaw) <= 0.6));
f.controller.stop('User stopped.', true);
assert.deepEqual(f.moves.at(-1), [0, 0]); assert.equal(f.results.at(-1).save, true);
const count = f.moves.length; f.controller.tick(); assert.equal(f.moves.length, count, 'stopped controllers cannot resume');

for (const [name, mutate] of [
  ['pose freshness', f => { f.context.pose.at = f.now - 751; }],
  ['telemetry freshness', f => { f.context.telemetry.at = f.now - 751; }],
  ['battery freshness', f => { f.context.telemetry.batteryAt = f.now - 2001; }],
  ['battery reserve', f => { f.context.telemetry.battery = 10; }],
  ['measured overspeed', f => { f.context.telemetry.speed = 1.01; }],
  ['tilt', f => { f.context.telemetry.roll = 0.3; }],
  ['invalid body height', f => { f.context.telemetry.bodyHeight = NaN; }],
  ['session change', f => { f.context.session = 'another-map'; }],
  ['mapping stopped', f => { f.context.mapping = false; }],
  ['pose jump', f => { f.context.pose.x = 1; }],
]) {
  const x = fixture(); x.controller.start(); x.refresh(5001); mutate(x); x.controller.tick();
  assert.equal(x.controller.active, false, name);
  assert.equal(moving(x).length, 0, `${name} must prevent a motion command`);
  assert.deepEqual(x.moves.at(-1), [0, 0], `${name} ends with stop`);
}
const missing = fixture(); missing.controller.start(); missing.refresh(5001, new Float32Array([1, 1, 1])); missing.controller.tick();
assert.equal(moving(missing).length, 0, 'wall data alone cannot establish floor');
assert.equal(missing.results.at(-1).save, true, 'insufficient observed floor ends with a partial map');
const staleCloud = fixture(); staleCloud.controller.start(); staleCloud.refresh(5001, new Float32Array()); staleCloud.controller.tick();
assert.match(staleCloud.results.at(-1).reason, /LiDAR/);
const wrongCloud = fixture(); wrongCloud.controller.start(); wrongCloud.now = 5001;
wrongCloud.context.pose.at = wrongCloud.now; wrongCloud.context.telemetry.at = wrongCloud.now; wrongCloud.context.telemetry.batteryAt = wrongCloud.now;
wrongCloud.controller.cloud(room, wrongCloud.now, 'other-session'); wrongCloud.controller.tick();
assert.equal(moving(wrongCloud).length, 0);
const budget = fixture(); budget.controller.start(); budget.refresh(600001); budget.controller.tick();
assert.equal(budget.results.at(-1).save, true); assert.match(budget.results.at(-1).reason, /budget/);
const obstacle = fixture(); obstacle.controller.start(); obstacle.refresh(5001); obstacle.controller.tick();
obstacle.refresh(50, cluster(0.2, 0, 0.3)); obstacle.controller.tick();
assert.equal(obstacle.controller.active,true); assert.deepEqual(obstacle.moves.at(-1),[0,0]);
obstacle.refresh(2000,cluster(.2,0,.3)); obstacle.controller.tick();
assert.equal(obstacle.controller.active, false); assert.deepEqual(obstacle.moves.at(-1), [0, 0]);
const rejected = fixture(); rejected.accept = false; rejected.controller.start();
assert.equal(rejected.controller.active, false); assert.equal(rejected.results.at(-1).save, false);
const initial = fixture(); initial.context.telemetry.battery = 10;
assert.throws(() => initial.controller.start(), /Battery/); assert.equal(initial.moves.length, 0);

// Closed-loop unicycle simulation: commands alter pose, which is fed back.
const sim = fixture(); sim.controller.start();
for (let i = 0; i < 300 && sim.controller.active; i++) {
  const [v, w] = sim.moves.at(-1) ?? [0, 0];
  sim.context.pose.yaw += w * 0.05;
  sim.context.pose.x += Math.cos(sim.context.pose.yaw) * v * 0.05;
  sim.context.pose.y += Math.sin(sim.context.pose.yaw) * v * 0.05;
  sim.context.telemetry.speed = v;
  sim.refresh(50); sim.controller.tick();
}
assert.ok(Math.hypot(sim.context.pose.x, sim.context.pose.y) > 0.1, 'simulated robot actually explores');
sim.controller.stop('End simulation.');
assert.equal(sim.controller.active, false);
console.log('PASS: unknown-floor blocking, clearance, drops, sticky obstacles, freshness, source/session isolation, pose jumps, tilt, speed/battery/time limits, stop transport and closed-loop exploration. No hardware used.');

const { explorationMotion } = await compile('src/ui/exploration-motion.ts');
const requests = []; let connected = true, estop = false;
const actuator = explorationMotion({ ready: () => connected, emergencyStopped: () => estop,
  request: (...args) => requests.push(args) });
assert.equal(actuator(0.4, -0.6), true);
assert.deepEqual(requests.at(-1), [1008, '{"x":0.4,"y":0,"z":-0.6}', undefined]);
for (const [v,w] of [[0.4001,0],[-0.01,0],[0,0.601],[NaN,0],[0,Infinity]]) assert.equal(actuator(v,w),false);
assert.equal(requests.length,1,'invalid planner output cannot reach the sport API');
estop = true; assert.equal(actuator(0.4,0),false); assert.equal(actuator(0,0),true);
assert.deepEqual(requests.at(-1),[1003,'{}',true],'emergency stop still permits a high-priority StopMove');
connected = false; assert.equal(actuator(0,0),false); assert.equal(actuator(0.4,0),false);
console.log('PASS: actuator speed bounds, invalid values, disconnection, emergency stop, Move JSON and priority StopMove wire contract.');

const stable = new MappingStartStability(), readiness = fixture();
for (let i=0;i<40;i++) { readiness.refresh(50); assert.equal(stable.ready(readiness.context,readiness.now),false); }
readiness.refresh(50);assert.equal(stable.ready(readiness.context,readiness.now),true,'two seconds of stable posture arms the scan');
readiness.context.telemetry.speed=.21;readiness.refresh(50);assert.equal(stable.ready(readiness.context,readiness.now),false,'stand-up transient resets readiness');
readiness.context.telemetry.speed=0;
for(let i=0;i<40;i++){readiness.refresh(50);assert.equal(stable.ready(readiness.context,readiness.now),false);}
readiness.refresh(50);assert.equal(stable.ready(readiness.context,readiness.now),true);
readiness.context.pose.z+=.03;readiness.refresh(50);assert.equal(stable.ready(readiness.context,readiness.now),false,'changing body height restarts settling');
console.log('PASS: stand-up settling waits for continuous stable data and resets on speed/height changes.');

const spike = fixture();spike.controller.start();spike.refresh(1000);spike.context.telemetry.speed=.254;spike.controller.tick();
assert.equal(spike.controller.active,true,'stationary scan tolerates the recorded velocity spike when position is stable');
spike.context.pose.x=.06;spike.refresh(50);spike.controller.tick();assert.equal(spike.controller.active,false,'actual scan displacement still stops exploration');
console.log('PASS: recorded stationary velocity noise is cross-checked against pose; scan displacement remains blocked.');

const { estimateFloor, floorHeight } = await compile('src/ui/exploration-floor.ts');
const shiftedFloor = new Float32Array(room.map((value,index)=>index%3===2?value-0.09:value));
const plane = estimateFloor(shiftedFloor,{x:0,y:0,z:.32});
assert.ok(plane);assert.ok(Math.abs(floorHeight(plane,0,0)+.09)<1e-5,'scan establishes the floor instead of assuming body height semantics');
assert.equal(estimateFloor(new Float32Array([0,0,0,1,0,0]),{x:0,y:0,z:.32}),null,'insufficient spatial support cannot establish a floor');
const startGrid = new ExplorationGrid({x:0,y:0},plane);
assert.equal(startGrid.clear(0,0,0),false);
startGrid.verifyStartingArea(0);assert.equal(startGrid.clear(0,0,0),true);
assert.equal(startGrid.clear(1.2,0,0),false,'operator confirmation cannot clear space outside the named starting area');
confirmObstacle(startGrid,cluster(.2,0,.2),1);assert.equal(startGrid.clear(0,0,1),false,'sensor obstacles override the verified starting floor');
startGrid.verifyStartingArea(2);assert.equal(startGrid.clear(0,0,2),false,'repeat confirmation never erases an obstacle');
const expiry = new ExplorationGrid({x:0,y:0},0);expiry.verifyStartingArea(0);assert.equal(expiry.clear(0,0,600001),false,'verified area expires with the trial budget');
console.log('PASS: scan-based floor reference, insufficient support rejection, explicitly verified start area bounds, expiry and obstacle precedence.');

// A nearby side/rear object must not require a full turn circle before walking.
const directional = new ExplorationGrid({ x: 0, y: 0 }, 0);
directional.observe(floor(2), 0);
confirmObstacle(directional,cluster(-.2,-.4,.2),1);
const startPose = { x: 0, y: 0, yaw: 0 };
assert.equal(directional.clear(0, 0, 1), false, 'legacy turning circle hits the side object');
assert.equal(directional.footprintClear(startPose, 1), true, 'straight body footprint fits beside the object');
assert.equal(directional.nextMotion(startPose, 1)?.kind, 'forward', 'clear forward motion remains available');
assert.equal(directional.sweepClear(startPose, { ...startPose, yaw: Math.PI }, 1), false, 'turn sweep still hits nearby object');
const aheadPose = { x: 0.4, y: 0, yaw: 0 };
assert.equal(directional.sweepClear(startPose, aheadPose, 1), true);
assert.equal(directional.sweepClear(aheadPose, { ...aheadPose, yaw: Math.PI }, 1), true, 'turn becomes possible after moving clear');
confirmObstacle(directional,cluster(.6,0,.2),2);
assert.equal(directional.sweepClear(startPose, aheadPose, 2), false, 'obstacle ahead blocks the complete swept corridor');
const unknownSweep = new ExplorationGrid({ x: 0, y: 0 }, 0);
assert.equal(unknownSweep.sweepClear(startPose, aheadPose, 0), false);
console.log('PASS: forward clearance beside an obstacle, blocked turn sweep, turn after moving clear, head-on obstacle and unknown terrain.');

for (const battery of [11, 35]) {
  const f = fixture(); f.context.telemetry.battery = battery;
  f.controller.start(); f.refresh(5001); f.controller.tick();
  assert.ok(moving(f).length > 0, `mapping allowed above reserve at ${battery}%`);
  f.context.telemetry.battery = 10; f.controller.tick();
  assert.equal(f.controller.active, false);
  assert.equal(f.results.at(-1).save, true);
  assert.deepEqual(f.moves.at(-1), [0, 0]);
}
console.log('PASS: mapping above 10% reserve; stop/save at exactly 10%.');

const postScanSpike = fixture(); postScanSpike.controller.start();
postScanSpike.refresh(5001); postScanSpike.context.telemetry.speed = 1.001;
postScanSpike.controller.tick();
assert.equal(postScanSpike.controller.active, false);
assert.equal(moving(postScanSpike).length, 0, 'raw overspeed blocks the first walking command');

const preStopped = fixture(); preStopped.controller.start(true);
assert.equal(preStopped.moves.length, 0, 'do not send a second StopMove after caller has stopped and settled');
preStopped.refresh(5001); preStopped.controller.tick();
assert.ok(moving(preStopped).length > 0);
preStopped.controller.stop();
assert.deepEqual(preStopped.moves.at(-1), [0,0]);

const patient = fixture(); patient.controller.start(); patient.refresh(5001); patient.controller.tick();
patient.refresh(8001); patient.controller.tick();
assert.equal(patient.controller.active,true,'eight seconds without progress no longer aborts exploration');
patient.refresh(17001); patient.controller.tick();
assert.equal(patient.controller.active,false);
assert.match(patient.results.at(-1).reason,/25 seconds/);
assert.deepEqual(patient.moves.at(-1),[0,0]);
console.log('PASS: 8-second no-progress cutoff removed; 25-second target timeout retained.');

// The requested walking speed must survive the planner, not just actuator bounds.
const brisk = fixture(); brisk.controller.start(); brisk.refresh(5001); brisk.controller.tick();
assert.equal(brisk.moves.at(-1)[0], .4);
brisk.context.pose.x = .24; brisk.context.telemetry.speed = .39;
brisk.refresh(50); brisk.controller.tick();
assert.deepEqual(brisk.moves.at(-1), [0,0], 'brake early using measured speed');
brisk.refresh(601); brisk.controller.tick();
assert.deepEqual(brisk.moves.at(-1), [0,0], 'do not restart while still decelerating');
brisk.context.telemetry.speed = 0; brisk.refresh(50); brisk.controller.tick();
assert.equal(brisk.controller.active, true);
const braking = fixture(); braking.controller.start(); braking.refresh(5001); braking.controller.tick();
// Beyond the 50 cm target, but inside the speed-dependent stopping corridor.
braking.refresh(50, cluster(1, 0, .2)); braking.controller.tick();
assert.equal(braking.controller.active, true);
assert.match(braking.status.at(-1), /checked turn without the 2-second/);
assert.deepEqual(braking.moves.at(-1), [0,0]);
const corridor = new ExplorationGrid({x:0,y:0},0); corridor.observe(floor(2),0);
confirmObstacle(corridor,cluster(1,0,.2),1);
assert.equal(corridor.nextMotion(startPose,1)?.kind,'forward', 'old short target fits');
assert.notEqual(corridor.nextMotion(startPose,1,.73)?.kind,'forward', 'choose another direction when braking space is blocked');
console.log('PASS: 0.4 m/s forward request, anticipatory braking, stationary restart and stopping-corridor obstacle checks.');

assert.equal(EXPLORE_LIDAR_TIMEOUT_MS, 300_000);
const lidarGap = fixture(); lidarGap.controller.start(); lidarGap.refresh(5001); lidarGap.controller.tick();
for (const gap of [751, 1500, 5000]) {
  lidarGap.refresh(gap, new Float32Array()); lidarGap.controller.tick();
  assert.equal(lidarGap.controller.active, true, 'LiDAR gap does not end the run');
  assert.equal(lidarGap.moves.at(-1)[0], .4, 'LiDAR gap does not pause forward movement');
}
lidarGap.refresh(50); lidarGap.controller.tick();
assert.equal(lidarGap.controller.active, true, 'fresh scans are accepted again');
console.log('PASS: five-minute LiDAR timeout; shorter cloud gaps neither pause nor end movement; fresh pose and motion still required.');

assert.equal(OBSTACLE_MIN_RETURNS, 5);
const sparse = new ExplorationGrid({x:0,y:0},0); sparse.observe(room,0);
sparse.observe(new Float32Array([.3,0,.2]),1);
assert.equal(sparse.clear(0,0,1),true,'one isolated obstacle return does not block supported floor');
sparse.observe(new Float32Array([.3,0,.2,.3,0,.2,.30001,0,.20001]),2);
assert.equal(sparse.clear(0,0,2),true,'duplicates and sub-voxel jitter are one return');
for(let i=3;i<10;i++) sparse.observe(new Float32Array([.3,0,.2]),i);
assert.equal(sparse.clear(0,0,9),true,'one return repeated across scans does not accumulate');
sparse.observe(new Float32Array([.3,0,.2,.3,0,.25]),10);
assert.equal(sparse.clear(0,0,10),true,'two distinct returns are still below threshold');
sparse.observe(new Float32Array([.3,0,.2,.3,0,.25,.3,0,.3,.3,0,.35]),10.5);
assert.equal(sparse.clear(0,0,10.5),true,'four distinct returns remain below threshold');
sparse.observe(cluster(.3,0,.2),11);
assert.equal(sparse.clear(0,0,11),true,'five points start recheck, not permanent blocking');
assert.equal(sparse.obstacleStatus({x:0,y:0,yaw:0},{x:0,y:0,yaw:0}),'pending');
sparse.observe(cluster(.3,0,.2),2011);
assert.equal(sparse.clear(0,0,2011),false,'five points still present after recheck block');
sparse.observe(room,2012);
assert.equal(sparse.clear(0,0,2012),false,'confirmed obstacle remains sticky');
const noFloor = new ExplorationGrid({x:0,y:0},0);
noFloor.observe(new Float32Array([.3,0,.2]),0);
assert.equal(noFloor.clear(0,0,0),false,'unconfirmed obstacles never manufacture free floor');
console.log('PASS: five distinct returns per cell per scan; single noise, duplicates and cross-scan accumulation rejected; drops use a two-second recheck.');

const { EXPLORE_MEASURED_SPEED_LIMIT, EXPLORE_STOP_CORRIDOR, EXPLORE_FORWARD_SPEED } = await compile('src/ui/exploration-motion.ts');
assert.equal(EXPLORE_MEASURED_SPEED_LIMIT,1);
assert.equal(EXPLORE_FORWARD_SPEED,.4);
assert.ok(Math.abs(EXPLORE_STOP_CORRIDOR-.73)<1e-9);
const faster = fixture(); faster.controller.start(); faster.refresh(5001); faster.controller.tick();
faster.context.telemetry.speed=.52; faster.refresh(50); faster.controller.tick();
assert.equal(faster.controller.active,true,'previous 0.52 m/s sample no longer aborts');
assert.equal(faster.moves.at(-1)[0],.4,'requested speed remains unchanged');
faster.context.telemetry.speed=1; faster.refresh(50); faster.controller.tick();
assert.equal(faster.controller.active,true,'exactly 1 m/s is permitted');
faster.context.telemetry.speed=1.001; faster.refresh(50); faster.controller.tick();
assert.equal(faster.controller.active,false,'above 1 m/s stops');
assert.deepEqual(faster.moves.at(-1),[0,0]);
console.log('PASS: doubled measured-speed cutoff, unchanged 0.4 m/s request, unchanged stopping corridor and cutoff boundary.');

assert.equal(DROP_MIN_DEPTH_METRES,.1524);
const shallow = new ExplorationGrid({x:0,y:0},0); shallow.observe(room,0);
for(const depth of [.084,.10,.1523]) {
  shallow.observe(new Float32Array([.3,0,-depth]),1);
  assert.equal(shallow.clear(0,0,1),true,`depth ${depth} is below the half-foot threshold`);
}
shallow.observe(new Float32Array([.3,0,-.1525]),2);
assert.equal(shallow.dropStatus({x:0,y:0,yaw:0},{x:0,y:0,yaw:0}),'pending');
shallow.observe(new Float32Array([.3,0,-.1525]),2002);
assert.equal(shallow.clear(0,0,2),false,'a return beyond half a foot blocks after the recheck');
console.log('PASS: half-foot drop threshold; recorded 8.4 cm return and smaller drops do not block supported floor.');

// Drop candidates stop actuation immediately, but only a fresh recheck at least
// two seconds later can make them permanent or authorize resuming.
const dropPoint = new Float32Array([.3,0,-.2]);
const retryDrop = fixture(); retryDrop.controller.start(); retryDrop.refresh(5001); retryDrop.controller.tick();
retryDrop.refresh(50,dropPoint); retryDrop.controller.tick();
assert.equal(retryDrop.controller.active,true);
assert.deepEqual(retryDrop.moves.at(-1),[0,0],'pause immediately on suspected drop');
assert.match(retryDrop.status.at(-1),/2 seconds/);
retryDrop.refresh(1999); retryDrop.controller.tick();
assert.deepEqual(retryDrop.moves.at(-1),[0,0],'early floor scan cannot clear before two seconds');
retryDrop.refresh(1); retryDrop.controller.tick();
assert.equal(retryDrop.controller.active,true);
assert.match(retryDrop.status.at(-1),/Recheck finished/);
retryDrop.refresh(601); retryDrop.controller.tick();
assert.equal(retryDrop.moves.at(-1)[0],.4,'cleared drop permits a fresh planned step');

const confirmedDrop = fixture(); confirmedDrop.controller.start(); confirmedDrop.refresh(5001); confirmedDrop.controller.tick();
confirmedDrop.refresh(50,dropPoint); confirmedDrop.controller.tick();
confirmedDrop.refresh(2000,dropPoint); confirmedDrop.controller.tick();
assert.equal(confirmedDrop.controller.active,false);
assert.match(confirmedDrop.results.at(-1).reason,/Drop still present.*2-second/);
assert.equal(confirmedDrop.results.at(-1).save,true);
assert.deepEqual(confirmedDrop.moves.at(-1),[0,0]);

const unseenDrop = fixture(); unseenDrop.controller.start(); unseenDrop.refresh(5001); unseenDrop.controller.tick();
unseenDrop.refresh(50,dropPoint); unseenDrop.controller.tick();
unseenDrop.refresh(6000,new Float32Array()); unseenDrop.controller.tick();
assert.equal(unseenDrop.controller.active,true);
assert.deepEqual(unseenDrop.moves.at(-1),[0,0],'no fresh cloud must not clear a suspected drop');
unseenDrop.refresh(50,new Float32Array([1,1,0])); unseenDrop.controller.tick();
assert.deepEqual(unseenDrop.moves.at(-1),[0,0],'a scan elsewhere cannot clear the suspect cell');

// A pending drop in a rotational sweep must stay paused after the goal resets.
const turnDrop = fixture(); turnDrop.controller.start(); turnDrop.refresh(5001);
turnDrop.controller.goal={x:0,y:0,yaw:Math.PI/2,kind:'turn'};turnDrop.controller.goalAt=turnDrop.now;
turnDrop.controller.tick();
assert.equal(turnDrop.moves.at(-1)[1],.6,'turn cap is now 0.6 rad/s');
turnDrop.refresh(50,new Float32Array([0,.35,-.2]));turnDrop.controller.tick();
assert.deepEqual(turnDrop.moves.at(-1),[0,0]);
turnDrop.refresh(50,new Float32Array());turnDrop.controller.tick();
assert.deepEqual(turnDrop.moves.at(-1),[0,0],'remember the pending turn sweep while waiting');

const turnSpeed = fixture(); turnSpeed.controller.start(); turnSpeed.refresh(5001);
turnSpeed.controller.goal={x:0,y:0,yaw:1,kind:'turn'};turnSpeed.controller.goalAt=turnSpeed.now;
turnSpeed.controller.tick();assert.equal(turnSpeed.moves.at(-1)[1],.6);
for(const yaw of [.2,.4,.6,.8]) {turnSpeed.context.pose.yaw=yaw;turnSpeed.refresh(50);turnSpeed.controller.tick();}
assert.equal(turnSpeed.moves.at(-1)[1],.4,'near-target in-place turns retain minimum effective input');
console.log('PASS: two-second drop pause, fresh confirmation/clearance, no blind resume, retained turn sweep and faster turning with target slowdown.');

const flatCluster = (x,y,z) => new Float32Array([
  x-.04,y-.04,z, x,y-.04,z, x+.04,y-.04,z, x-.04,y+.04,z, x+.04,y+.04,z,
]);
assert.equal(OBSTACLE_MIN_HEIGHT_METRES,.127);
const lowRise = new ExplorationGrid({x:0,y:0},0);lowRise.observe(room,0);
lowRise.observe(flatCluster(.3,0,.126),1);
assert.equal(lowRise.obstacleStatus(startPose,startPose),null,'five returns below five inches are not obstacles');
assert.equal(lowRise.clear(0,0,1),true);
lowRise.observe(flatCluster(.3,0,.128),2);
assert.equal(lowRise.obstacleStatus(startPose,startPose),'pending','five returns above five inches start recheck');
lowRise.observe(room,2001);
assert.equal(lowRise.obstacleStatus(startPose,startPose),'pending','less than two seconds cannot clear');
lowRise.observe(room,2002);
assert.equal(lowRise.obstacleStatus(startPose,startPose),null,'fresh floor clears after two seconds');

const wall = cluster(.9,0,.2);
const reroute = fixture();reroute.controller.start();reroute.refresh(5001);reroute.controller.tick();
reroute.refresh(50,wall);reroute.controller.tick();
assert.equal(reroute.controller.active,true);
assert.deepEqual(reroute.moves.at(-1),[0,0],'brief brake before the checked turn');
assert.match(reroute.status.at(-1),/checked turn without the 2-second/);
assert.equal(reroute.controller.goal.kind,'turn');
reroute.refresh(601);reroute.controller.tick();
assert.equal(reroute.moves.at(-1)[0],0);assert.ok(Math.abs(reroute.moves.at(-1)[1])>0,'turn can start before two seconds');
const targetYaw = reroute.controller.goal.yaw;
for(let i=1;i<=5;i++) {reroute.context.pose.yaw=targetYaw*i/5;reroute.refresh(50);reroute.controller.tick();}
reroute.refresh(601);reroute.controller.tick();
assert.equal(reroute.moves.at(-1)[0],.4,'continue exploring after turning away from suspected wall');

const disappearing = fixture();disappearing.controller.start();disappearing.refresh(5001);disappearing.controller.tick();
disappearing.refresh(50,cluster(.3,0,.2));disappearing.controller.tick();
disappearing.refresh(6000,new Float32Array());disappearing.controller.tick();
assert.deepEqual(disappearing.moves.at(-1),[0,0],'missing scans never clear obstacle suspicion');
disappearing.refresh(50,new Float32Array([2,2,0]));disappearing.controller.tick();
assert.deepEqual(disappearing.moves.at(-1),[0,0],'a scan elsewhere cannot clear the cell');
disappearing.refresh(50);disappearing.controller.tick();
disappearing.refresh(601);disappearing.controller.tick();
assert.equal(disappearing.moves.at(-1)[0],.4,'fresh clearance resumes the original direction');

const boxed = fixture();boxed.controller.start();boxed.refresh(5001);boxed.controller.tick();
const fence = new Float32Array([0,Math.PI/4,-Math.PI/4,Math.PI/2,-Math.PI/2,3*Math.PI/4,-3*Math.PI/4,Math.PI].flatMap(a=>Array.from(cluster(.9*Math.cos(a),.9*Math.sin(a),.2))));
boxed.refresh(50,fence);boxed.controller.tick();boxed.refresh(2000,fence);boxed.controller.tick();
boxed.refresh(601);boxed.controller.tick();boxed.refresh(3001);boxed.controller.tick();
assert.equal(boxed.controller.active,false,'stop if all checked directions are blocked');
assert.match(boxed.results.at(-1).reason,/No checked forward step or turn/);
console.log('PASS: five-inch obstacle height, two-second fresh recheck, wall reroute into unvisited direction, cleared resume and no-route stop.');

const earlyWall = fixture(); earlyWall.controller.start();
earlyWall.refresh(4000,new Float32Array([...explorationRoom,...cluster(.3,0,.2)]));earlyWall.controller.tick();
earlyWall.refresh(1001);earlyWall.controller.tick();
assert.deepEqual(earlyWall.moves.at(-1),[0,0]);
earlyWall.refresh(1000,cluster(.3,0,.2));earlyWall.controller.tick();
assert.equal(earlyWall.controller.grid.obstacleStatus(startPose,{x:.73,y:0,yaw:0}),'pending',
  'an earlier sighting cannot shorten the two-second movement pause');
earlyWall.refresh(1000,cluster(.3,0,.2));earlyWall.controller.tick();
assert.equal(earlyWall.controller.grid.obstacleStatus(startPose,{x:.73,y:0,yaw:0}),'confirmed');
assert.equal(earlyWall.controller.active,false);
console.log('PASS: obstacle recheck waits a full two seconds from the movement pause.');

const partialFloor = new Float32Array(Array.from(explorationRoom).filter((_,i,a)=>a[i-i%3]<=1.201));
const unknownAhead = fixture();unknownAhead.controller.start();unknownAhead.refresh(5001,partialFloor);unknownAhead.controller.tick();
assert.equal(unknownAhead.moves.at(-1)[0],.4);
unknownAhead.context.pose.x=.2;unknownAhead.refresh(50,new Float32Array());unknownAhead.controller.tick();
assert.equal(unknownAhead.controller.active,true,'new unknown forward floor triggers replanning, not run termination');
assert.deepEqual(unknownAhead.moves.at(-1),[0,0]);assert.match(unknownAhead.status.at(-1),/Forward corridor changed/);
unknownAhead.refresh(601,new Float32Array());unknownAhead.controller.tick();
assert.equal(unknownAhead.controller.goal.kind,'turn','use a checked side corridor when forward floor is unknown');
console.log('PASS: newly unknown floor ahead pauses actuation and replans toward checked side space.');

for (const sign of [-1,1]) {
  const turning = fixture();turning.controller.start();turning.refresh(5001);
  const goalYaw=sign*Math.PI/4;
  turning.controller.goal={x:0,y:0,yaw:goalYaw,kind:'turn'};turning.controller.goalAt=turning.now;
  turning.controller.tick();
  for(let i=0;i<500 && turning.controller.active && turning.controller.goal;i++) {
    const [v,w]=turning.moves.at(-1);
    assert.equal(v,0);assert.ok(Math.abs(w)>=.4&&Math.abs(w)<=.6);
    // Emulate the observed dead range: commands below .25 do not rotate.
    turning.context.pose.yaw += (Math.abs(w)<.25?0:w)*.05;
    turning.refresh(50);turning.controller.tick();
  }
  assert.equal(turning.controller.active,true);
  assert.equal(turning.controller.goal,null,'turn reaches its heading without timing out in deadband simulation');
  assert.ok(Math.abs(goalYaw-turning.context.pose.yaw)<.08);
  assert.deepEqual(turning.moves.at(-1),[0,0],'heading tolerance still stops instead of enforcing minimum');
}
const steering = fixture();steering.controller.start();steering.refresh(5001);steering.controller.tick();
steering.context.pose.yaw=.02;steering.refresh(50);steering.controller.tick();
assert.equal(steering.moves.at(-1)[0],.4);
assert.ok(Math.abs(steering.moves.at(-1)[1]+.02)<1e-9,'small forward steering corrections are not raised to minimum');
console.log('PASS: 0.4 rad/s minimum in-place turns in both directions, heading stop, deadband simulation and unchanged forward steering.');

const driftingTurn = fixture();driftingTurn.controller.start();driftingTurn.refresh(5001);
driftingTurn.controller.goal={x:0,y:0,yaw:1,kind:'turn'};driftingTurn.controller.goalAt=driftingTurn.now;
const turnStarted=driftingTurn.controller.goalAt;
driftingTurn.controller.tick();
for(let i=1;i<=5;i++) {
  driftingTurn.context.pose.x=.04*i;driftingTurn.refresh(50);driftingTurn.controller.tick();
  assert.equal(driftingTurn.controller.active,true,'accumulated 20 cm translation does not end turn');
  assert.equal(driftingTurn.controller.goal.yaw,1,'retain heading target');
  assert.equal(driftingTurn.controller.goal.x,driftingTurn.context.pose.x,'check remaining sweep around updated position');
  assert.equal(driftingTurn.controller.goalAt,turnStarted,'translation does not reset goal timeout');
  assert.equal(driftingTurn.moves.at(-1)[0],0,'do not request translational motion to correct drift');
  assert.ok(driftingTurn.moves.at(-1)[1]>=.4);
}
for(const yaw of [.2,.4,.6,.8,.94]) {driftingTurn.context.pose.yaw=yaw;driftingTurn.refresh(50);driftingTurn.controller.tick();}
assert.equal(driftingTurn.controller.active,true);assert.equal(driftingTurn.controller.goal,null);
assert.deepEqual(driftingTurn.moves.at(-1),[0,0],'target heading still ends turn');

const driftObstacle = fixture();driftObstacle.controller.start();driftObstacle.refresh(5001);
driftObstacle.controller.goal={x:0,y:0,yaw:1,kind:'turn'};driftObstacle.controller.goalAt=driftObstacle.now;
driftObstacle.controller.tick();driftObstacle.context.pose.x=.15;
driftObstacle.refresh(50,cluster(.45,0,.2));driftObstacle.controller.tick();
assert.equal(driftObstacle.controller.active,true);assert.deepEqual(driftObstacle.moves.at(-1),[0,0]);
assert.match(driftObstacle.status.at(-1),/Possible obstacle/,'current-position obstacle checks still pause movement');
console.log('PASS: turn translation stop removed; updated pivot, unchanged heading/time budget and current-position obstacle checks.');

const { ExplorationFrontier } = await compile('src/ui/exploration-frontier.ts');
const { EXPLORE_TRAVEL_METRES, EXPLORE_DURATION_MS } = await compile('src/ui/exploration-limits.ts');
assert.equal(EXPLORE_TRAVEL_METRES,30);assert.equal(EXPLORE_DURATION_MS,600000);
const longer = fixture();longer.controller.start();longer.refresh(5001);
longer.controller.travelled=5.1;longer.controller.tick();assert.equal(longer.controller.active,true,'old five-metre limit no longer stops');
longer.controller.travelled=30;longer.refresh(50);longer.controller.tick();
assert.equal(longer.controller.active,false);assert.equal(longer.results.at(-1).save,true);

function visitedNear(grid) {
  for(let x=-1;x<=1.001;x+=.2)for(let y=-1;y<=1.001;y+=.2)for(let h=0;h<8;h++)grid.motionVisited({x,y,yaw:h*Math.PI/4});
}
function solveSearch(grid,p,target) {
  const search=new ExplorationFrontier(grid,p,.73,target);
  let result={state:'working'};
  for(let i=0;i<2000 && result.state==='working';i++)result=search.step(10000,8);
  assert.notEqual(result.state,'working','bounded map search terminates');return result;
}
const mapped = new ExplorationGrid({x:0,y:0},0);mapped.observe(floor(3),10000);visitedNear(mapped);
assert.equal(mapped.nextMotion(startPose,10000,.73),null,'local choices already visited');
const frontierResult=solveSearch(mapped,startPose);
assert.equal(frontierResult.state,'found');
assert.ok(Math.hypot(frontierResult.target.x,frontierResult.target.y)>1,'target lies beyond locally exhausted views');
assert.equal(mapped.positionVisited(frontierResult.target),false,'prefer a physically unvisited place, not just another heading');
assert.ok(mapped.checkedSweep(startPose,frontierResult.motion,10000));
assert.equal(mapped.viewVisited(frontierResult.motion),true,'route may cross already visited space to reach new area');
const blind = new ExplorationGrid({x:0,y:0},0);blind.observe(floor(.6),10000);
assert.equal(solveSearch(blind,startPose).state,'none','blank map is not free space');

const lPoints=[];
for(let x=-2;x<=2.701;x+=.1)for(let y=-.7;y<=3.001;y+=.1) {
  if(y<=.701 || x>=1.299)lPoints.push(x,y,0);
}
const lMap = new ExplorationGrid({x:0,y:0},0);lMap.observe(new Float32Array(lPoints),10000);
const lRoute=solveSearch(lMap,startPose,{x:2,y:2,yaw:Math.PI/2});
assert.equal(lRoute.state,'found','known L-shaped passage routes around a corner');
assert.equal(lRoute.motion.kind,'forward');assert.ok(lMap.checkedSweep(startPose,lRoute.motion,10000));

const fallback = fixture();fallback.controller.start();fallback.refresh(5001);visitedNear(fallback.controller.grid);
for(let i=0;i<1000 && !fallback.controller.goal && fallback.controller.active;i++) {
  fallback.controller.tick();fallback.refresh(50,new Float32Array());
}
assert.equal(fallback.controller.active,true);
assert.ok(fallback.controller.goal,'controller uses global map route after local options are exhausted');
assert.ok(fallback.status.some(s=>s.includes('Searching the map')));
assert.ok(fallback.controller.frontierTarget);
console.log('PASS: 30 m/10 min budget, immediate checked obstacle turn, global frontier routes through visited space and L passage, unknown-floor blocking and controller fallback.');

for(let i=0;i<1600 && fallback.controller.active && Math.hypot(fallback.context.pose.x,fallback.context.pose.y)<1.1;i++) {
  const [v,w]=fallback.moves.at(-1)??[0,0];
  fallback.context.pose.yaw+=w*.05;
  fallback.context.pose.x+=Math.cos(fallback.context.pose.yaw)*v*.05;
  fallback.context.pose.y+=Math.sin(fallback.context.pose.yaw)*v*.05;
  fallback.context.telemetry.speed=v;fallback.refresh(50,new Float32Array());fallback.controller.tick();
}
assert.equal(fallback.controller.active,true);
assert.ok(Math.hypot(fallback.context.pose.x,fallback.context.pose.y)>1,'global-route actions actually cross visited space in closed loop');

const aroundCorner=fixture();aroundCorner.controller.start();aroundCorner.refresh(5001,new Float32Array(lPoints));
aroundCorner.controller.frontierTarget={x:2,y:2,yaw:Math.PI/2};
aroundCorner.controller.tick();
for(let i=0;i<2400 && aroundCorner.controller.active && Math.hypot(aroundCorner.context.pose.x-2,aroundCorner.context.pose.y-2)>.4;i++) {
  const [v,w]=aroundCorner.moves.at(-1)??[0,0];
  aroundCorner.context.pose.yaw+=w*.05;
  aroundCorner.context.pose.x+=Math.cos(aroundCorner.context.pose.yaw)*v*.05;
  aroundCorner.context.pose.y+=Math.sin(aroundCorner.context.pose.yaw)*v*.05;
  aroundCorner.context.telemetry.speed=v;
  aroundCorner.refresh(50,new Float32Array());aroundCorner.controller.tick();
}
assert.ok(Math.hypot(aroundCorner.context.pose.x-2,aroundCorner.context.pose.y-2)<.5,
  JSON.stringify({reason:aroundCorner.results.at(-1),pose:aroundCorner.context.pose,status:aroundCorner.status.at(-1)}));
console.log('PASS: closed-loop map routing crosses visited floor and reaches a destination around an L-shaped corner.');

const divided = new ExplorationGrid({x:0,y:0},0);divided.observe(floor(3),0);
const barrier=[];for(let y=-3;y<=3.001;y+=.1)barrier.push(...cluster(.9,y,.2));
confirmObstacle(divided,new Float32Array(barrier),0);
assert.equal(solveSearch(divided,startPose,{x:2,y:0,yaw:0}).state,'none','global search cannot route through a wall or unknown floor around it');
const anchoredSearch=new ExplorationFrontier(mapped,startPose,.73);
assert.equal(anchoredSearch.matchesStart({...startPose,x:.1}),false,'pose drift restarts incremental search');
const cancelledSearch = fixture();cancelledSearch.controller.start();cancelledSearch.refresh(5001);visitedNear(cancelledSearch.controller.grid);
cancelledSearch.controller.tick();cancelledSearch.controller.stop('User stopped map search.');
const cancelledCount=cancelledSearch.moves.length;cancelledSearch.refresh(50);cancelledSearch.controller.tick();
assert.equal(cancelledSearch.moves.length,cancelledCount);assert.deepEqual(cancelledSearch.moves.at(-1),[0,0]);
console.log('PASS: global wall separation, search pose consistency and user cancellation.');

const avoidDrop=fixture();avoidDrop.controller.start();avoidDrop.refresh(5001);avoidDrop.controller.tick();
avoidDrop.refresh(50,new Float32Array([.9,0,-.2]));avoidDrop.controller.tick();
assert.match(avoidDrop.status.at(-1),/Possible drop ahead: taking a checked turn/);
assert.equal(avoidDrop.controller.goal.kind,'turn');
assert.equal(avoidDrop.controller.grid.dropStatus(avoidDrop.context.pose,avoidDrop.controller.goal),null,'bypass sweep excludes suspected drop');
avoidDrop.refresh(601,new Float32Array());avoidDrop.controller.tick();
assert.ok(Math.abs(avoidDrop.moves.at(-1)[1])>=.4,'checked drop bypass turns before two seconds');
console.log('PASS: suspected drops ahead can also be bypassed without the rescan wait when the complete turn is checked.');
