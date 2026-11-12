import { ExplorationGrid, HAZARD_RECHECK_MS, type ExplorationMotion, type FootprintPose } from './exploration-grid';
import { estimateFloor } from './exploration-floor';
import { EXPLORE_FORWARD_SPEED, EXPLORE_MEASURED_SPEED_LIMIT, EXPLORE_STOP_CORRIDOR, EXPLORE_YAW_RATE, EXPLORE_MIN_TURN_RATE } from './exploration-motion';
import { EXPLORE_TRAVEL_METRES, EXPLORE_DURATION_MS } from './exploration-limits';
import { ExplorationFrontier } from './exploration-frontier';

export interface ExplorePose { x: number; y: number; z: number; yaw: number; at: number; session: string }
export interface ExploreTelemetry { at: number; battery: number; batteryAt: number; bodyHeight: number; speed: number; roll: number; pitch: number }
export interface ExploreContext { mapping: boolean; session: string; pose: ExplorePose | null; telemetry: ExploreTelemetry | null }
export interface ExploreResult { reason: string; save: boolean; distance: number; cells: number }
// User-selected loss timeout: retain the last map during gaps without pausing.
export const EXPLORE_LIDAR_TIMEOUT_MS = 5 * 60_000;
interface Options {
  context(): ExploreContext;
  move(forward: number, yawRate: number): boolean;
  status(text: string): void;
  finish(result: ExploreResult): void;
  now?: () => number;
  verifiedStartingArea?: () => boolean;
}

/** Arm only after stand-up has settled; does not relax any running limits. */
export class MappingStartStability {
  private since: number | null = null;
  private lastAt = -Infinity;
  private last: { x: number; y: number; z: number; yaw: number; height: number } | null = null;
  reset(): void { this.since = null; this.lastAt = -Infinity; this.last = null; }
  ready(c: ExploreContext, now: number): boolean {
    const p = c.pose, t = c.telemetry;
    if (!c.mapping || !c.session || !p || p.session !== c.session || !t
      || ![now, p.x, p.y, p.z, p.yaw, p.at, t.at, t.battery, t.batteryAt, t.bodyHeight, t.speed, t.roll, t.pitch].every(Number.isFinite)
      || now < p.at || now - p.at > 750 || now < t.at || now - t.at > 750
      || now < t.batteryAt || now - t.batteryAt > 2000 || t.battery <= 10 || t.battery > 100
      || t.speed < 0 || t.speed > 0.03 || t.bodyHeight < 0.2 || t.bodyHeight > 0.5
      || Math.abs(t.roll) > 0.2 || Math.abs(t.pitch) > 0.2) {
      this.reset(); return false;
    }
    const last = this.last;
    const angle = last ? Math.atan2(Math.sin(p.yaw - last.yaw), Math.cos(p.yaw - last.yaw)) : 0;
    const changed = last && (Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 0.015
      || Math.abs(angle) > 0.03 || Math.abs(t.bodyHeight - last.height) > 0.01);
    if (this.since === null || changed || now < this.lastAt || now - this.lastAt > 250) this.since = now;
    this.lastAt = now;
    this.last = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, height: t.bodyHeight };
    return now - this.since >= 2000;
  }
}

/** Step 1 only. Never starts localization, navigation, patrol or return-to-A. */
export class MappingExplorer {
  private running = false;
  private session = '';
  private grid: ExplorationGrid | null = null;
  private started = 0;
  private scanOrigin: ExplorePose | null = null;
  private floorCalibrated = false;
  private verifiedStartingArea = false;
  private cloudAt = -Infinity;
  private lastPose: ExplorePose | null = null;
  private goal: ExplorationMotion | null = null;
  private breadcrumbs: ExplorePose[] = [];
  private settlingUntil = 0;
  private goalAt = 0;
  private distancePose: ExplorePose | null = null;
  private noGoalAt = 0;
  private travelled = 0;
  private hazardWaiting: 'drop' | 'obstacle' | null = null;
  private hazardPath: FootprintPose | null = null;
  private frontierSearch: ExplorationFrontier | null = null;
  private frontierTarget: FootprintPose | null = null;
  constructor(private options: Options) {}
  get active(): boolean { return this.running; }
  private now(): number { return this.options.now?.() ?? performance.now(); }
  start(initialStopAlreadySent = false): void {
    if (this.running) throw new Error('Exploration is already running.');
    const c = this.options.context(), now = this.now();
    const problem = this.problem(c, now);
    if (problem || !c.pose || !c.telemetry) throw new Error(problem || 'Live mapping data required.');
    if (c.telemetry.speed > 0.03) throw new Error('Wait for Go2 to stand still before exploration.');
    this.session = c.session;
    this.grid = new ExplorationGrid({ x: c.pose.x, y: c.pose.y }, c.pose.z - c.telemetry.bodyHeight);
    this.started = now; this.scanOrigin = { ...c.pose }; this.cloudAt = -Infinity; this.lastPose = { ...c.pose };
    this.floorCalibrated = false;
    this.verifiedStartingArea = this.options.verifiedStartingArea?.() === true;
    this.travelled = 0; this.distancePose = { ...c.pose }; this.goal = null;
    this.hazardWaiting = null; this.hazardPath = null;
    this.frontierSearch = null; this.frontierTarget = null;
    this.breadcrumbs = [{ ...c.pose }]; this.settlingUntil = 0; this.noGoalAt = now;
    this.running = true;
    this.options.status('Explore & Map: stationary scan for 5 seconds. Unknown floor stays blocked.');
    try { if (!initialStopAlreadySent && !this.options.move(0, 0)) this.end('Movement transport unavailable.', false); }
    catch { this.end('Movement transport unavailable.', false); }
  }
  cloud(points: Float32Array, at: number, session: string): void {
    if (!this.running || !this.grid || session !== this.session || !Number.isFinite(at) || at > this.now() || this.now() - at > 750) return;
    if (!points.length || points.length % 3 || points.length > 300_000) return;
    this.cloudAt = at;
    if (!this.floorCalibrated) {
      const pose = this.options.context().pose;
      if (!pose) return;
      const plane = estimateFloor(points, pose);
      if (!plane) return;
      this.grid = new ExplorationGrid({ x: this.scanOrigin!.x, y: this.scanOrigin!.y }, plane);
      if (this.verifiedStartingArea) this.grid.verifyStartingArea(this.started);
      this.grid.motionVisited(this.scanOrigin!);
      this.floorCalibrated = true;
      this.options.status('Floor reference found in the scan. Finishing the initial scan before moving.');
    }
    this.grid.observe(points, at);
  }
  private problem(c: ExploreContext, now: number): string | null {
    if (!c.mapping || !c.session || (this.running && c.session !== this.session)) return 'Mapping stopped or session changed.';
    const p = c.pose, t = c.telemetry;
    if (!p || p.session !== c.session || ![p.x, p.y, p.z, p.yaw, p.at].every(Number.isFinite) || now < p.at || now - p.at > 750) return 'Mapping position is missing or stale.';
    if (!t || ![t.at, t.battery, t.batteryAt, t.bodyHeight, t.speed, t.roll, t.pitch].every(Number.isFinite)
      || now < t.at || now - t.at > 750 || now < t.batteryAt || now - t.batteryAt > 2000) return 'Motion or battery telemetry is missing or stale.';
    if (t.battery <= 10 || t.battery > 100) return 'Battery reserve reached (10%).';
    if (t.bodyHeight < 0.2 || t.bodyHeight > 0.5 || Math.abs(t.roll) > 0.2 || Math.abs(t.pitch) > 0.2) return 'Go2 is not level at a supported body height.';
    // StopMove can produce an isolated estimator spike while standing still.
    // The initial no-motion scan is guarded by displacement; after it, raw
    // overspeed still prevents every movement command.
    const scanning = this.running && now - this.started < 5000;
    if (t.speed < 0 || (!scanning && t.speed > EXPLORE_MEASURED_SPEED_LIMIT)) return 'Measured speed exceeds the exploration limit.';
    return null;
  }
  tick(): void {
    if (!this.running || !this.grid) return;
    const now = this.now(), c = this.options.context(), problem = this.problem(c, now);
    if (problem) { this.end(problem, problem.startsWith('Battery reserve') && c.telemetry!.battery >= 0 && c.telemetry!.battery <= 10); return; }
    const p = c.pose!;
    if (this.lastPose && p.at !== this.lastPose.at) {
      const distance = Math.hypot(p.x - this.lastPose.x, p.y - this.lastPose.y);
      const angle = Math.atan2(Math.sin(p.yaw - this.lastPose.yaw), Math.cos(p.yaw - this.lastPose.yaw));
      if (distance > 0.25 || Math.abs(angle) > 0.35) { this.end('Mapping pose jumped. Check the estimate.', false); return; }
      if (this.distancePose) {
        const travelled = Math.hypot(p.x - this.distancePose.x, p.y - this.distancePose.y);
        if (travelled >= 0.02) { this.travelled += travelled; this.distancePose = { ...p }; }
      }
      this.lastPose = { ...p };
    }
    if (now - this.started >= EXPLORE_DURATION_MS || this.travelled >= EXPLORE_TRAVEL_METRES) { this.end('Exploration budget reached; coverage may be incomplete.', true); return; }
    if (now - this.started < 5000) {
      const origin = this.scanOrigin!;
      const heading = Math.atan2(Math.sin(p.yaw - origin.yaw), Math.cos(p.yaw - origin.yaw));
      if (Math.hypot(p.x - origin.x, p.y - origin.y) > 0.05 || Math.abs(heading) > 0.1) {
        this.end('Position changed during the initial stationary scan.', false);
      }
      return;
    }
    if (now - this.cloudAt > EXPLORE_LIDAR_TIMEOUT_MS) { this.end('No usable LiDAR cloud for 5 minutes.', false); return; }
    if (!this.floorCalibrated) { this.end('Could not establish a supported floor reference. Map is partial.', true); return; }
    // Track the remaining turn around the current estimated position rather
    // than treating an accumulated translation as a reason to end the run.
    // Keep the original heading target and timeout; recheck the current sweep.
    if (this.goal?.kind === 'turn') { this.goal.x = p.x; this.goal.y = p.y; }
    const ahead = { x: p.x + Math.cos(p.yaw) * EXPLORE_STOP_CORRIDOR,
      y: p.y + Math.sin(p.yaw) * EXPLORE_STOP_CORRIDOR, yaw: p.yaw };
    if (this.recheckHazard(p, this.hazardPath ?? (this.goal?.kind === 'turn' ? this.goal : ahead), now)) return;
    if (this.hazardWaiting) {
      this.hazardWaiting = null; this.hazardPath = null; this.goal = null; this.noGoalAt = now;
      this.settlingUntil = now + 600;
      this.options.status('Recheck finished. Waiting for Go2 to settle, then choosing another checked direction.');
    }
    if (!this.grid.footprintClear(p, now)) {
      this.end('Current body footprint is blocked or floor support is unknown. Map is partial.', true); return;
    }
    // Keep the actually checked sequence back toward A. This does not command
    // a return or assume that every point has room for a full rotation.
    let previous = this.breadcrumbs[0];
    for (const next of [...this.breadcrumbs.slice(1), p]) {
      if (!this.grid.sweepClear(previous, next, now)) { this.end('Previously checked route is no longer clear.', false); return; }
      previous = next;
    }
    if (now < this.settlingUntil) return;
    // Do not start another step while the previous stop is still decelerating.
    if (!this.goal && c.telemetry!.speed > 0.03) {
      if (!this.options.move(0, 0)) this.end('Stop command failed.', false);
      return;
    }
    if (this.goal) {
      const distance = Math.hypot(this.goal.x - p.x, this.goal.y - p.y);
      const angle = Math.atan2(Math.sin(this.goal.yaw - p.yaw), Math.cos(this.goal.yaw - p.yaw));
      // Begin braking before reaching the target rather than tapering the
      // command into the low-speed range that previously only caused leaning.
      const reached = this.goal.kind === 'forward' ? distance < 0.08 + c.telemetry!.speed * 0.5 : Math.abs(angle) < 0.08;
      if (reached) {
        this.grid.motionVisited(this.goal); this.grid.motionVisited(p); this.breadcrumbs.push({ ...p });
        this.goal = null; this.noGoalAt = now; this.settlingUntil = now + 600;
        try { if (!this.options.move(0, 0)) this.end('Movement transport unavailable.', false); }
        catch { this.end('Stop command failed.', false); }
        return;
      }
    }
    if (!this.goal) {
      const planned = this.planMotion(p, now);
      if (planned === undefined) {
        try { if (!this.options.move(0, 0)) this.end('Stop command failed during map search.', false); }
        catch { this.end('Stop command failed during map search.', false); }
        return;
      }
      this.goal = planned;
      if (!this.goal) {
        if (!this.options.move(0, 0)) { this.end('Movement transport unavailable.', false); return; }
        if (now - this.noGoalAt > 3000) this.end('No checked forward step or turn is available. Map may be incomplete.', true);
        return;
      }
      this.goalAt = now;
      this.options.status(this.goal.kind === 'forward' ? 'Explore & Map: taking a short checked forward step.' : 'Explore & Map: turning within the checked body sweep.');
    }
    if (this.now() - now > 250) { this.end('Planning exceeded the input freshness budget.', false); return; }
    if (this.recheckHazard(p, this.goal, now)) return;
    if (!this.grid.sweepClear(p, this.goal, now)) { this.replan('Movement corridor changed. Looking for another checked direction.', now); return; }
    if (this.goal.kind === 'forward') {
      const ahead = { x: p.x + Math.cos(p.yaw) * EXPLORE_STOP_CORRIDOR,
        y: p.y + Math.sin(p.yaw) * EXPLORE_STOP_CORRIDOR, yaw: p.yaw };
      if (!this.grid.sweepClear(p, ahead, now)) { this.replan('Forward corridor changed. Looking for another checked direction.', now); return; }
    }
    const angle = Math.atan2(Math.sin(this.goal.yaw - p.yaw), Math.cos(this.goal.yaw - p.yaw));
    if (now - this.goalAt > 25_000) { this.end('Movement target timed out (25 seconds).', false); return; }
    if (this.goal.kind === 'forward' && Math.abs(angle) > 0.12) { this.end('Heading changed unexpectedly during a straight step.', false); return; }
    const correction = Math.max(-EXPLORE_YAW_RATE, Math.min(EXPLORE_YAW_RATE, angle));
    // Keep in-place turns above the ineffective low-input range observed on
    // this Go2. Reaching the heading tolerance still sends a full stop above.
    // Small steering corrections while walking must remain proportional.
    const turn = this.goal.kind === 'turn'
      ? Math.sign(angle) * Math.max(EXPLORE_MIN_TURN_RATE, Math.abs(correction))
      : correction;
    const forward = this.goal.kind === 'forward' ? EXPLORE_FORWARD_SPEED : 0;

    try { if (!this.options.move(forward, turn)) this.end('Movement transport rejected the command.', false); }
    catch { this.end('Movement command failed.', false); }
  }
  private planMotion(p: FootprintPose, now: number): ExplorationMotion | null | undefined {
    if (this.frontierSearch && !this.frontierSearch.matchesStart(p)) this.frontierSearch = null;
    if (this.frontierTarget && Math.hypot(p.x - this.frontierTarget.x, p.y - this.frontierTarget.y) < 0.35) {
      this.grid!.motionVisited(this.frontierTarget);
      this.frontierTarget = null; this.frontierSearch = null;
    }
    if (!this.frontierSearch && !this.frontierTarget) {
      const local = this.grid!.nextMotion(p, now, EXPLORE_STOP_CORRIDOR);
      if (local) return local;
    }
    if (!this.frontierSearch) {
      this.frontierSearch = new ExplorationFrontier(this.grid!, { ...p }, EXPLORE_STOP_CORRIDOR, this.frontierTarget ?? undefined);
      this.options.status('Searching the map for a checked route to an unvisited area.');
    }
    const result = this.frontierSearch.step(now);
    if (result.state === 'working') return undefined;
    this.frontierSearch = null;
    if (result.state === 'found') {
      this.frontierTarget = result.target;
      return result.motion;
    }
    if (this.frontierTarget) {
      this.frontierTarget = null; this.noGoalAt = now;
      return undefined; // Retry all frontiers if the previous destination changed.
    }
    return null;
  }
  private replan(reason: string, now: number): void {
    this.frontierSearch = null;
    this.goal = null; this.noGoalAt = now; this.settlingUntil = now + 600;
    this.options.status(reason);
    try { if (!this.options.move(0, 0)) this.end('Stop command failed while replanning.', false); }
    catch { this.end('Stop command failed while replanning.', false); }
  }
  private recheckHazard(from: FootprintPose, to: FootprintPose, now: number): boolean {
    const drop = this.grid!.dropStatus(from, to);
    if (drop === 'confirmed') {
      this.end(`Drop still present after the ${HAZARD_RECHECK_MS / 1000}-second recheck. Map is partial.`, true); return true;
    }
    const obstacle = this.grid!.obstacleStatus(from, to);
    const pending = drop === 'pending' ? 'drop' : obstacle === 'pending' ? 'obstacle' : null;
    if (!pending) return false;
    { // A checked bypass may avoid either suspected objects or drops.
      const alternate = this.grid!.nextMotion(from, now, EXPLORE_STOP_CORRIDOR,
        { avoidHazards: true, turnsOnly: true, allowVisited: true });
      if (alternate) {
        this.hazardWaiting = null; this.hazardPath = null;
        this.frontierSearch = null; this.frontierTarget = null;
        this.replan(`${pending === 'drop' ? 'Possible drop' : 'Obstacle'} ahead: taking a checked turn without the ${HAZARD_RECHECK_MS / 1000}-second rescan wait.`, now);
        if (this.running) { this.goal = alternate; this.goalAt = now; }
        return true;
      }
    }
    if (!this.hazardWaiting) {
      this.hazardPath = { ...to };
      this.grid!.beginRecheck(from, to, now);
    }
    if (this.hazardWaiting !== pending) this.options.status(`Possible ${pending}: movement paused for ${HAZARD_RECHECK_MS / 1000} seconds, then waiting for a fresh LiDAR recheck.`);
    this.hazardWaiting = pending; this.goal = null; this.noGoalAt = now;
    this.frontierSearch = null;
    try { if (!this.options.move(0, 0)) this.end('Stop command failed during obstacle/drop recheck.', false); }
    catch { this.end('Stop command failed during obstacle/drop recheck.', false); }
    return true;
  }
  stop(reason = 'Exploration stopped.', save = false): void { if (this.running) this.end(reason, save); }
  private end(reason: string, save: boolean): void {
    this.running = false;
    this.goal = null;
    let stopped = false;
    try { stopped = this.options.move(0, 0); } catch { /* report failed transport below */ }
    this.options.finish({ reason: stopped ? reason : `${reason} Stop command could not be delivered.`,
      save: save && stopped, distance: this.travelled, cells: this.grid?.observedCells ?? 0 });
  }
}
