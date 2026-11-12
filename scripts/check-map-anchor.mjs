import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/ui/map-anchor.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { MapAnchorController, readAnchorPose } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
const intervals = new Map(); let serial = 0;
globalThis.setInterval = fn => { const id = ++serial; intervals.set(id, fn); return id; };
globalThis.clearInterval = id => intervals.delete(id);
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
const storage = new Map();
function fixture(extra = {}) {
  const calls = [], status = [];
  const c = { robotId: 'robot-a', mapId: 'map-a', localized: true, mapping: false, patrolling: false, pose: { x: 2, y: 1, yaw: 0.4, at: 100, mapId: 'map-a' } };
  const f = { now: 100, c, calls, status };
  f.controller = new MapAnchorController({ context: () => c, now: () => f.now,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) },
    mapId: async () => c.mapId, localizationStatus: async () => '1', navigationStatus: async () => '1', idle: async () => true,
    send: command => calls.push(command), status: text => status.push(text), ...extra });
  return f;
}
const goals = f => f.calls.filter(c => c.startsWith('navigation/set_goal_pose/'));
try {
  const pose = readAnchorPose({ pose: { pose: { position: { x: 1, y: 2 }, orientation: { x: 0,y: 0,z: Math.sin(Math.PI/4),w: Math.cos(Math.PI/4) } } } }, 'map-a', 10);
  assert.ok(Math.abs(pose.yaw - Math.PI/2) < 1e-9);
  assert.equal(readAnchorPose({}, 'map-a', 0), null);
  assert.equal(readAnchorPose({ pose: { pose: { position: { x: NaN, y: 2 }, orientation: { x: 0,y: 0,z: 0,w: 1 } } } }, 'map-a', 0), null);
  assert.equal(readAnchorPose({ header: { frame_id: 'unrelated-map' }, pose: { pose: { position: { x: 1, y: 2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } } }, 'map-a', 0), null);
  const mapped = fixture(); mapped.c.mapId = 'new-map'; mapped.c.localized = false;
  mapped.controller.saveMappingStart({ x: 0.8, y: -1.2, yaw: 0.3, at: 0, mapId: 'new-map' });
  assert.equal(mapped.controller.anchor().x, 0.8, 'mapping origin A is retained even before localization');
  assert.equal(mapped.calls.length, 0, 'saving the mapping origin issues no robot command');
  assert.throws(() => mapped.controller.saveMappingStart({ x: 0, y: 0, yaw: 0, at: 0, mapId: 'wrong-map' }), /saved map/);
  assert.equal(mapped.controller.restore({ robotId: 'robot-b', mapId: 'new-map', x: 0, y: 0, yaw: 0 }), false);
  mapped.c.mapping = true;
  assert.throws(() => mapped.controller.saveMappingStart({ x: 0, y: 0, yaw: 0, at: 0, mapId: 'new-map' }), /saved map/);
  mapped.controller.destroy();
  const f = fixture(); await f.controller.set(); assert.equal(f.calls.length, 0, 'setting an anchor never moves Go2');
  const reloaded = fixture(); assert.equal(reloaded.controller.anchor().x, 2, 'anchor survives a new controller'); reloaded.controller.destroy();
  f.c.pose.x = 5; await f.controller.returnToAnchor();
  assert.deepEqual(f.calls, ['navigation/start', 'navigation/set_goal_pose/2.000/1.000/0.400']);
  f.controller.navigationState('GOAL_CHANGED'); assert.equal(f.calls.length, 2, 'normal goal acceptance does not abort');
  f.controller.navigationState('NO_PATH'); assert.equal(f.calls.at(-1), 'navigation/stop');
  assert.ok(f.status.at(-1).includes('no path'));
  await f.controller.returnToAnchor(); f.now = 1700;
  for (const fn of intervals.values()) fn();
  assert.equal(f.calls.at(-1), 'navigation/stop', 'stale localization stops return'); f.controller.destroy();
  const mismatch = fixture(); mismatch.c.mapId = 'map-b'; mismatch.c.pose.mapId = 'map-b';
  assert.equal(mismatch.controller.anchor(), null); await assert.rejects(mismatch.controller.returnToAnchor(), /Set an anchor/); assert.equal(mismatch.calls.length, 0); mismatch.controller.destroy();
  const other = fixture(); other.c.robotId = 'robot-b'; assert.equal(other.controller.anchor(), null); other.controller.destroy();
  const lost = fixture(); lost.c.localized = false; await assert.rejects(lost.controller.returnToAnchor(), /localize/); assert.equal(lost.calls.length, 0); lost.controller.destroy();
  const unconfirmed = fixture({ mapId: async () => 'wrong-map' });
  await assert.rejects(unconfirmed.controller.returnToAnchor(), /same map/); assert.equal(unconfirmed.calls.length, 0); unconfirmed.controller.destroy();
  const occupied = fixture({ idle: async () => false });
  await assert.rejects(occupied.controller.returnToAnchor(), /mapping, patrol/); assert.equal(occupied.calls.length, 0); occupied.controller.destroy();
  const notReady = fixture({ navigationStatus: async () => '0' });
  await assert.rejects(notReady.controller.returnToAnchor(), /navigation is ready/); assert.equal(goals(notReady).length, 0); assert.equal(notReady.calls.at(-1), 'navigation/stop'); notReady.controller.destroy();
  let release;
  const pending = fixture({ navigationStatus: () => new Promise(r => { release = r; }) });
  const run = pending.controller.returnToAnchor(); const rejected = assert.rejects(run, /cancelled/); await flush(); pending.controller.destroy(); release('1'); await rejected;
  assert.equal(goals(pending).length, 0, 'late navigation reply cannot send a goal after leaving');
  const arrival = fixture(); await arrival.controller.returnToAnchor(); arrival.controller.navigationState('REACHED'); assert.ok(arrival.status.at(-1).includes('Anchor reached')); arrival.controller.destroy();
  const far = fixture(); await far.controller.returnToAnchor(); far.c.pose.x += 2; far.controller.navigationState('REACHED'); assert.ok(far.status.at(-1).includes('not within tolerance')); far.controller.destroy();
  const timed = fixture(); await timed.controller.returnToAnchor(); timed.now += 61000; timed.c.pose.at = timed.now;
  for (const fn of intervals.values()) fn(); assert.ok(timed.status.at(-1).includes('timeout')); timed.controller.destroy();
  const boundary = fixture(); boundary.c.mapId = 'pi-map'; boundary.c.pose.mapId = 'pi-map'; boundary.c.pose.yaw = Math.PI;
  await boundary.controller.set(); await boundary.controller.returnToAnchor();
  assert.ok(Math.abs(Number(goals(boundary)[0].split('/').at(-1))) <= Math.PI, 'rounded heading remains within firmware limits'); boundary.controller.destroy();
  assert.equal(intervals.size, 0);
  console.log('PASS: map/robot anchor persistence, pose validation, fresh localization, robot-side map confirmation, navigation readiness, cancellation, stale-data stop, no-path, arrival tolerance and timeout. No robot commands executed.');
} finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }

const storageBuild = await build({ entryPoints: ['src/storage/map-pcd-store.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { bundleToZip, zipToBundle } = await import('data:text/javascript;base64,' + Buffer.from(storageBuild.outputFiles[0].text).toString('base64'));
const bytes = new TextEncoder().encode('map-data').buffer;
const portableAnchor = { robotId: 'robot-a', mapId: 'portable-map', x: 1, y: 2, yaw: 0.3 };
const archive = bundleToZip({ id: 'portable-map', name: 'Room', date: '2026-11-06' }, { pcd: bytes, pgm: bytes, txt: bytes, anchor: portableAnchor });
assert.deepEqual(zipToBundle(archive).bundle.anchor, portableAnchor, 'ZIP preserves robot/map identity and A');
assert.equal(zipToBundle(bundleToZip({ id: 'other-map', name: 'Room', date: '' }, { pcd: bytes, anchor: portableAnchor })).bundle.anchor, undefined, 'ZIP does not attach A from a different map');
console.log('PASS: portable map archive retains A and excludes anchors belonging to other maps.');
