/** Conservative flat-floor map for short, supervised exploration trials.
 * Empty/missing cloud space is UNKNOWN unless the operator explicitly verifies starting terrain.
 * Occupied columns remain occupied for the session. No ray-carving of free space.
 */
import { floorHeight, type FloorPlane } from './exploration-floor';
import { EXPLORE_DURATION_MS } from './exploration-limits';
export interface FootprintPose { x: number; y: number; yaw: number }
export interface ExplorationMotion extends FootprintPose { kind: 'forward' | 'turn' }
export const OBSTACLE_MIN_RETURNS = 5;
export const OBSTACLE_MIN_HEIGHT_METRES = 0.127; // five inches
export const DROP_MIN_DEPTH_METRES = 0.1524; // half a foot
export const HAZARD_RECHECK_MS = 2000;
type Evidence = { firstAt: number; confirmed: boolean };

export class ExplorationGrid {
  readonly resolution = 0.1;
  readonly radius = 0.45; // body turning envelope plus clearance, in metres
  private cells = new Map<string, { floorAt: number; blocked: boolean; verifiedUntil?: number }>();
  private visits = new Set<string>();
  private views = new Set<string>();
  private positions = new Set<string>();
  private drops = new Map<string, Evidence>();
  private obstacles = new Map<string, Evidence>();
  private readonly limit = 100; // +/- 10 metres around A
  constructor(readonly origin: { x: number; y: number }, readonly floorZ: number | FloorPlane) {}
  /** Explicit operator evidence, session-limited; never erase a sensor obstacle. */
  verifyStartingArea(now: number): void {
    const r = 10; // one metre of verified flat terrain; obstacles remain blocked
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
      if (Math.hypot(x, y) * this.resolution + 0.071 > 1) continue;
      const key = this.key(x, y), old = this.cells.get(key);
      this.cells.set(key, { floorAt: old?.floorAt ?? -Infinity, blocked: !!old?.blocked, verifiedUntil: now + EXPLORE_DURATION_MS });
    }
  }
  private index(x: number, y: number): [number, number] {
    return [Math.round((x - this.origin.x) / this.resolution), Math.round((y - this.origin.y) / this.resolution)];
  }
  private key(x: number, y: number): string { return `${x},${y}`; }
  private position(x: number, y: number): { x: number; y: number } {
    return { x: this.origin.x + x * this.resolution, y: this.origin.y + y * this.resolution };
  }
  observe(points: Float32Array, at: number): number {
    let accepted = 0;
    // Evidence is local to this scan. Repeated isolated noise must not build
    // into a permanent obstacle merely because mapping runs for longer.
    const obstacleReturns = new Map<string, Set<string>>();
    const dropEvidence = new Map<string, boolean>();
    const seen = new Set<string>();
    // Bound work and memory. A cloud that exceeds the cap is not truncated into
    // an apparently clear map: reject it before inserting any points.
    if (points.length % 3 || points.length > 300_000 || !Number.isFinite(at)) return 0;
    for (let i = 0; i < points.length; i += 3) {
      const px = points[i], py = points[i + 1], pz = points[i + 2];
      if (![px, py, pz].every(Number.isFinite)) continue;
      const [x, y] = this.index(px, py);
      if (Math.abs(x) > this.limit || Math.abs(y) > this.limit) continue;
      const height = pz - (typeof this.floorZ === 'number' ? this.floorZ : floorHeight(this.floorZ, px, py));
      // Lower returns may indicate a drop. Higher returns may hit the body.
      const floor = Math.abs(height) <= 0.05;
      const drop = height <= -DROP_MIN_DEPTH_METRES;
      const obstacle = height >= OBSTACLE_MIN_HEIGHT_METRES && height < 1.2;
      const key = this.key(x, y);
      if (height >= -DROP_MIN_DEPTH_METRES && height < 1.2) seen.add(key);
      // A shallower return can clear a suspected drop at the later recheck,
      // but is not itself evidence of level, traversable floor.
      if (height <= 0.05) dropEvidence.set(key, drop || dropEvidence.get(key) === true);
      if (!floor && !drop && !obstacle) continue;
      const old = this.cells.get(key);
      this.cells.set(key, { floorAt: floor ? Math.max(at, old?.floorAt ?? -Infinity) : old?.floorAt ?? -Infinity,
        blocked: !!old?.blocked, verifiedUntil: old?.verifiedUntil });
      if (obstacle) {
        let returns = obstacleReturns.get(key);
        if (!returns) { returns = new Set(); obstacleReturns.set(key, returns); }
        // The source is a 5 cm voxel cloud. Duplicate entries do not count
        // as separate evidence, including tiny coordinate jitter in one voxel.
        if (returns.size < OBSTACLE_MIN_RETURNS) returns.add(`${Math.round(px / 0.05)},${Math.round(py / 0.05)},${Math.round(pz / 0.05)}`);
      }
      accepted++;
    }
    for (const key of new Set([...seen, ...obstacleReturns.keys()])) {
      const detected = (obstacleReturns.get(key)?.size ?? 0) >= OBSTACLE_MIN_RETURNS;
      const old = this.obstacles.get(key);
      if (old?.confirmed) continue;
      if (!old) {
        if (detected) this.obstacles.set(key, { firstAt: at, confirmed: false });
      } else if (at - old.firstAt >= HAZARD_RECHECK_MS) {
        if (detected) {
          old.confirmed = true;
          this.cells.get(key)!.blocked = true;
        } else this.obstacles.delete(key);
      }
    }
    for (const [key, detected] of dropEvidence) {
      const old = this.drops.get(key);
      if (old?.confirmed) continue;
      if (!old) {
        if (detected) this.drops.set(key, { firstAt: at, confirmed: false });
      } else if (at - old.firstAt >= HAZARD_RECHECK_MS) {
        if (detected) {
          old.confirmed = true;
          this.cells.get(key)!.blocked = true;
        } else this.drops.delete(key);
      }
    }
    return accepted;
  }
  /** Pending drops stop motion for a recheck; they are not sticky obstacles yet. */
  dropStatus(from: FootprintPose, to: FootprintPose): 'pending' | 'confirmed' | null {
    return this.evidenceStatus(this.drops, from, to);
  }
  obstacleStatus(from: FootprintPose, to: FootprintPose): 'pending' | 'confirmed' | null {
    return this.evidenceStatus(this.obstacles, from, to);
  }
  beginRecheck(from: FootprintPose, to: FootprintPose, now: number): void {
    for (const evidence of [this.drops, this.obstacles]) {
      for (const [key, item] of evidence) {
        if (!item.confirmed && this.cellInSweep(key, from, to)) item.firstAt = Math.max(item.firstAt, now);
      }
    }
  }
  private evidenceStatus(evidence: Map<string, Evidence>, from: FootprintPose, to: FootprintPose): 'pending' | 'confirmed' | null {
    let pending = false;
    for (const [key, item] of evidence) {
      if (!this.cellInSweep(key, from, to)) continue;
      if (item.confirmed) return 'confirmed';
      pending = true;
    }
    return pending ? 'pending' : null;
  }
  private cellInSweep(key: string, from: FootprintPose, to: FootprintPose): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const [ix, iy] = key.split(',').map(Number), point = this.position(ix, iy);
    if (Math.hypot(point.x - from.x, point.y - from.y) > distance + 0.6) return false;
    const steps = Math.max(1, Math.ceil(distance / 0.025), Math.ceil(Math.abs(angle) / (Math.PI / 36)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, yaw = from.yaw + angle * t, c = Math.cos(yaw), s = Math.sin(yaw);
      const x = point.x - from.x - (to.x - from.x) * t, y = point.y - from.y - (to.y - from.y) * t;
      if (Math.abs(c * x + s * y) <= 0.471 && Math.abs(-s * x + c * y) <= 0.276) return true;
    }
    return false;
  }
  /** 70 x 31 cm body, with 5 cm clearance and grid-cell uncertainty. */
  footprintClear(pose: FootprintPose, now: number): boolean {
    const [cx, cy] = this.index(pose.x, pose.y), c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const halfLength = 0.4 + 0.071, halfWidth = 0.205 + 0.071;
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
      const p = this.position(cx + dx, cy + dy), x = p.x - pose.x, y = p.y - pose.y;
      if (Math.abs(c * x + s * y) > halfLength || Math.abs(-s * x + c * y) > halfWidth) continue;
      const cell = this.cells.get(this.key(cx + dx, cy + dy));
      if (!cell || cell.blocked) return false;
      const knownFloor = Number.isFinite(cell.floorAt) && cell.floorAt <= now;
      const verifiedFloor = cell.verifiedUntil !== undefined && cell.verifiedUntil >= now;
      if (!knownFloor && !verifiedFloor) return false;
    }
    return true;
  }
  /** Check the complete translated/rotated rectangle, not a full turn circle. */
  sweepClear(from: FootprintPose, to: FootprintPose, now: number): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    if (!Number.isFinite(distance) || !Number.isFinite(angle) || distance > 1) return false;
    const steps = Math.max(1, Math.ceil(distance / 0.025), Math.ceil(Math.abs(angle) / (Math.PI / 36)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.footprintClear({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, yaw: from.yaw + angle * t }, now)) return false;
    }
    return true;
  }
  private viewKey(p: FootprintPose): string {
    const [x, y] = this.index(p.x, p.y);
    return `${Math.round(x / 2)},${Math.round(y / 2)},${Math.round(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)) / (Math.PI / 4))}`;
  }
  private positionKey(p: FootprintPose): string {
    return `${Math.round((p.x - this.origin.x) / 0.2)},${Math.round((p.y - this.origin.y) / 0.2)}`;
  }
  motionVisited(p: FootprintPose): void { this.views.add(this.viewKey(p)); this.positions.add(this.positionKey(p)); }
  positionVisited(p: FootprintPose): boolean { return this.positions.has(this.positionKey(p)); }
  viewVisited(p: FootprintPose): boolean { return this.views.has(this.viewKey(p)); }
  unknownScore(p: FootprintPose): number {
    let unknown = 0;
    for (const offset of [-0.4, 0, 0.4]) for (const radius of [0.7, 1, 1.3]) {
      const [x, y] = this.index(p.x + Math.cos(p.yaw + offset) * radius, p.y + Math.sin(p.yaw + offset) * radius);
      if (!this.cells.has(this.key(x, y))) unknown++;
    }
    return unknown;
  }
  checkedSweep(from: FootprintPose, to: FootprintPose, now: number): boolean {
    return this.sweepClear(from, to, now) && !this.dropStatus(from, to) && !this.obstacleStatus(from, to);
  }
  nextMotion(pose: FootprintPose, now: number, stoppingCorridor = 0,
    options: { avoidHazards?: boolean; turnsOnly?: boolean; allowVisited?: boolean } = {}): ExplorationMotion | null {
    const checked = (from: FootprintPose, to: FootprintPose) => options.avoidHazards
      ? this.checkedSweep(from, to, now) : this.sweepClear(from, to, now);
    // Prefer a straight step when the body's forward corridor is clear.
    // Faster steps need room to accelerate before the early braking point.
    for (const length of options.turnsOnly ? [] : stoppingCorridor > 0 ? [0.5, 0.4] : [0.3, 0.2]) {
      const target = { x: pose.x + Math.cos(pose.yaw) * length, y: pose.y + Math.sin(pose.yaw) * length, yaw: pose.yaw };
      const ahead = { x: pose.x + Math.cos(pose.yaw) * Math.max(length, stoppingCorridor), y: pose.y + Math.sin(pose.yaw) * Math.max(length, stoppingCorridor), yaw: pose.yaw };
      if ((options.allowVisited || !this.viewVisited(target)) && checked(pose, ahead)) return { ...target, kind: 'forward' };
    }
    // Rotate only when the actual swept body fits and the new heading offers
    // a checked forward corridor. The robot never turns just to test a gap.
    let best: ExplorationMotion | null = null, score = -Infinity;
    for (const angle of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const yaw = Math.atan2(Math.sin(pose.yaw + angle), Math.cos(pose.yaw + angle));
      const turn = { x: pose.x, y: pose.y, yaw };
      const ahead = { x: turn.x + Math.cos(yaw) * Math.max(0.25, stoppingCorridor), y: turn.y + Math.sin(yaw) * Math.max(0.25, stoppingCorridor), yaw };
      if ((!options.allowVisited && (this.viewVisited(turn) || this.viewVisited(ahead)))
        || !checked(pose, turn) || !checked(turn, ahead)) continue;
      const unknown = this.unknownScore(turn);
      const value = unknown - Math.abs(angle) * 0.2;
      if (value > score) { score = value; best = { ...turn, kind: 'turn' }; }
    }
    return best;
  }
  /** Require observed floor throughout the body envelope, including cell margin. */
  clear(x: number, y: number, now: number, fresh = true): boolean {
    const [cx, cy] = this.index(x, y), r = Math.ceil((this.radius + 0.071) / this.resolution);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.hypot(dx, dy) * this.resolution > this.radius + 0.071) continue;
      const cell = this.cells.get(this.key(cx + dx, cy + dy));
      if (!cell || cell.blocked) return false;
      const verified = cell.verifiedUntil !== undefined && (!fresh || cell.verifiedUntil >= now);
      if (!verified && (!Number.isFinite(cell.floorAt) || (fresh && (now - cell.floorAt > 1500 || cell.floorAt > now)))) return false;
    }
    return true;
  }
  segmentClear(from: { x: number; y: number }, to: { x: number; y: number }, now: number): boolean {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!Number.isFinite(length) || length > 0.6) return false;
    const steps = Math.max(1, Math.ceil(length / 0.05));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.clear(from.x + t * (to.x - from.x), from.y + t * (to.y - from.y), now)) return false;
    }
    return true;
  }
  /** Connected previously checked space to A. Not a command to return to A. */
  connectedToA(pose: { x: number; y: number }, now: number): boolean {
    const [sx, sy] = this.index(pose.x, pose.y);
    if (Math.abs(sx) > this.limit || Math.abs(sy) > this.limit) return false;
    const queue: Array<[number, number]> = [[sx, sy]], seen = new Set([this.key(sx, sy)]);
    for (let head = 0; head < queue.length && head < 5000; head++) {
      const [x, y] = queue[head], p = this.position(x, y);
      if (!this.clear(p.x, p.y, now, false)) continue;
      if (x === 0 && y === 0) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = this.key(nx, ny);
        if (Math.abs(nx) <= this.limit && Math.abs(ny) <= this.limit && !seen.has(key)) {
          seen.add(key); queue.push([nx, ny]);
        }
      }
    }
    return false;
  }
  visit(pose: { x: number; y: number }): void {
    const [x, y] = this.index(pose.x, pose.y);
    // Do not repeatedly select nearly identical viewpoints.
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) this.visits.add(this.key(x + dx, y + dy));
  }
  next(pose: { x: number; y: number }, now: number): { x: number; y: number } | null {
    const [sx, sy] = this.index(pose.x, pose.y);
    const queue: Array<{ x: number; y: number; parent: number; depth: number }> = [{ x: sx, y: sy, parent: -1, depth: 0 }];
    const seen = new Set([this.key(sx, sy)]);
    let best = -1, score = -Infinity;
    for (let head = 0; head < queue.length && head < 1200; head++) {
      const node = queue[head], target = this.position(node.x, node.y);
      if (!this.clear(target.x, target.y, now, false)) continue;
      if (node.depth >= 3 && !this.visits.has(this.key(node.x, node.y))) {
        let unknown = 0;
        // Nearby unknown columns are a frontier heuristic, not proof of visibility.
        for (const radius of [6, 8]) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[0.7,0.7],[-0.7,0.7],[0.7,-0.7],[-0.7,-0.7]]) {
          if (!this.cells.has(this.key(node.x + Math.round(dx * radius), node.y + Math.round(dy * radius)))) unknown++;
        }
        const value = unknown / (1 + node.depth * 0.1);
        if (unknown > 0 && value > score) { best = head; score = value; }
      }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x = node.x + dx, y = node.y + dy, key = this.key(x, y);
        if (Math.abs(x) <= this.limit && Math.abs(y) <= this.limit && !seen.has(key)) {
          seen.add(key); queue.push({ x, y, parent: head, depth: node.depth + 1 });
        }
      }
    }
    if (best < 0) return null;
    const path: typeof queue = [];
    for (let index = best; index >= 0; index = queue[index].parent) path.push(queue[index]);
    path.reverse();
    let step: { x: number; y: number } | null = null;
    for (const node of path) {
      const p = this.position(node.x, node.y), distance = Math.hypot(p.x - pose.x, p.y - pose.y);
      if (distance > 0.45) break;
      if (distance >= 0.2 && this.segmentClear(pose, p, now)) step = p;
    }
    return step;
  }

  get observedCells(): number { return this.cells.size; }
}
