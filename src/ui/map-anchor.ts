export interface AnchorPose { x: number; y: number; yaw: number; at: number; mapId: string }
export interface MapAnchor { robotId: string; mapId: string; x: number; y: number; yaw: number }
export interface AnchorContext { robotId: string; mapId: string; localized: boolean; mapping: boolean; patrolling: boolean; pose: AnchorPose | null }
interface Options {
  context(): AnchorContext;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  mapId(): Promise<string>;
  localizationStatus(): Promise<string>;
  navigationStatus(): Promise<string>;
  idle(): Promise<boolean>;
  send(command: string): void;
  status(message: string): void;
  now?: () => number;
}

export function validMapAnchor(value: unknown): value is MapAnchor {
  const a = value as MapAnchor | null;
  return !!a && typeof a.robotId === 'string' && !!a.robotId
    && typeof a.mapId === 'string' && !!a.mapId
    && [a.x, a.y, a.yaw].every(Number.isFinite) && Math.abs(a.yaw) <= Math.PI;
}

export function readAnchorPose(data: unknown, mapId: string, at: number): AnchorPose | null {
  const frame = (data as { header?: { frame_id?: string } })?.header?.frame_id;
  if (frame && frame !== 'odom') return null;
  const pose = (data as { pose?: { pose?: { position?: { x: number; y: number }; orientation?: { x: number; y: number; z: number; w: number } } } })?.pose?.pose;
  const p = pose?.position, q = pose?.orientation;
  if (!mapId || !p || !q || ![p.x, p.y, q.x, q.y, q.z, q.w].every(Number.isFinite)) return null;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (norm < 0.5 || norm > 1.5) return null;
  const [x,y,z,w] = [q.x,q.y,q.z,q.w].map(v => v / norm);
  return { x: p.x, y: p.y, yaw: Math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z)), at, mapId };
}

/** Anchors belong to one robot/map. All motion uses the robot's existing planner. */
export class MapAnchorController {
  private generation = 0;
  private pending = false;
  private returning: MapAnchor | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  constructor(private options: Options) {}
  get active(): boolean { return this.pending || this.returning !== null; }
  private now(): number { return this.options.now?.() ?? performance.now(); }
  private key(context: { robotId: string; mapId: string }): string {
    return `go2_anchor_v1_${encodeURIComponent(context.robotId)}_${encodeURIComponent(context.mapId)}`;
  }
  anchor(mapId = this.options.context().mapId): MapAnchor | null {
    const context = { ...this.options.context(), mapId };
    try {
      const a = JSON.parse(this.options.storage.getItem(this.key(context)) || 'null');
      return validMapAnchor(a) && a.robotId === context.robotId && a.mapId === context.mapId ? a : null;
    } catch { return null; }
  }
  /** Restore only an anchor belonging to this robot; never issue motion. */
  restore(anchor: unknown): boolean {
    if (this.closed || !validMapAnchor(anchor) || anchor.robotId !== this.options.context().robotId) return false;
    this.options.storage.setItem(this.key(anchor), JSON.stringify(anchor));
    return true;
  }
  /** Commit the first mapping pose after that same newly-created map is saved. */
  saveMappingStart(pose: AnchorPose): void {
    const c = this.options.context();
    if (this.closed || this.active || c.mapping || !c.robotId || c.mapId !== pose.mapId) {
      throw new Error('Mapping start does not belong to the saved map.');
    }
    if (!this.restore({ robotId: c.robotId, mapId: c.mapId, x: pose.x, y: pose.y, yaw: pose.yaw })) {
      throw new Error('Invalid mapping start pose.');
    }
    this.options.status('Starting point A saved with this map. Localize before returning.');
  }
  private ready(expected?: AnchorContext): AnchorContext & { pose: AnchorPose } {
    const c = this.options.context();
    if (this.closed || !c.robotId || !c.mapId || !c.localized || c.mapping || c.patrolling) throw new Error('Load a map and localize Go2 first; stop mapping or patrol before using anchors.');
    if (expected && (c.robotId !== expected.robotId || c.mapId !== expected.mapId)) throw new Error('Robot or map changed. Return cancelled.');
    if (!c.pose || c.pose.mapId !== c.mapId || this.now() - c.pose.at > 1500 || this.now() < c.pose.at) throw new Error('Localization position is stale. Wait for a live position on the map.');
    return c as AnchorContext & { pose: AnchorPose };
  }
  private async verify(c: AnchorContext, generation: number): Promise<void> {
    const [map, localized, idle] = await Promise.all([this.options.mapId(), this.options.localizationStatus(), this.options.idle()]);
    if (generation !== this.generation || this.closed) throw new Error('Anchor operation cancelled.');
    this.ready(c);
    if (map !== c.mapId || localized !== '1') throw new Error('Go2 did not confirm the same map and active localization.');
    if (!idle) throw new Error('Go2 must confirm mapping, patrol and auto-charge are stopped.');
  }
  async set(): Promise<void> {
    if (this.pending || this.returning) throw new Error('Stop the current return before changing the anchor.');
    this.pending = true;
    const generation = ++this.generation;
    try {
      const c = this.ready(); await this.verify(c, generation);
      const { x,y,yaw } = this.ready(c).pose;
      this.options.storage.setItem(this.key(c), JSON.stringify({ robotId: c.robotId, mapId: c.mapId, x,y,yaw }));
      this.options.status('Anchor saved for this robot and map.');
    } finally { this.pending = false; }
  }
  async returnToAnchor(): Promise<void> {
    if (this.pending || this.returning) throw new Error('An anchor operation is already active.');
    this.pending = true;
    const generation = ++this.generation;
    try {
      const c = this.ready(), anchor = this.anchor();
      if (!anchor) throw new Error('Set an anchor on this map first.');
      await this.verify(c, generation);
      this.returning = anchor;
      const started = this.now();
      this.timer = setInterval(() => {
        try {
          this.ready(c);
          if (this.now() - started > 60_000) this.stop('Return stopped: 60-second timeout.');
        } catch { this.stop('Return stopped: localization lost, stale position, or map changed.'); }
      }, 250);
      this.options.send('navigation/start');
      const navigation = await this.options.navigationStatus();
      if (generation !== this.generation || this.closed) throw new Error('Return cancelled.');
      this.ready(c);
      if (navigation !== '1') throw new Error('Go2 did not confirm navigation is ready.');
      // Rounding pi to 3 decimals would exceed firmware's allowed yaw range.
      const yaw = Math.max(-3.141, Math.min(3.141, anchor.yaw));
      this.options.send(`navigation/set_goal_pose/${anchor.x.toFixed(3)}/${anchor.y.toFixed(3)}/${yaw.toFixed(3)}`);
      this.options.status('Returning to anchor. Use Stop Return to cancel.');
    } catch (error) {
      if (this.returning) this.stop('Return stopped.');
      throw error;
    } finally { this.pending = false; }
  }
  navigationState(state: string): void {
    if (!this.returning) return;
    if (state === 'REACHED') {
      const a = this.returning;
      try {
        const p = this.ready().pose;
        const angle = Math.atan2(Math.sin(p.yaw-a.yaw), Math.cos(p.yaw-a.yaw));
        this.stop(Math.hypot(p.x-a.x,p.y-a.y) <= 0.3 && Math.abs(angle) <= Math.PI/12
          ? 'Anchor reached (within 30 cm and 15°).' : 'Go2 reported arrival; anchor position or heading is not within tolerance.');
      } catch { this.stop('Arrival could not be verified: localization unavailable.'); }
    } else if (['NO_PATH','TIMEOUT','FAILURE','GOAL_OCCUPIED','GOAL_CANCELLED'].includes(state)) {
      this.stop(`Return stopped: ${state.replace(/_/g,' ').toLowerCase()}.`);
    }
  }
  stop(message = 'Return cancelled.'): void {
    const wasActive = this.active;
    ++this.generation;
    clearInterval(this.timer); this.timer = undefined;
    if (this.returning) this.options.send('navigation/stop');
    this.returning = null;
    if (wasActive || message !== 'Return cancelled.') this.options.status(message);
  }
  destroy(): void { this.stop(); this.closed = true; }
}
