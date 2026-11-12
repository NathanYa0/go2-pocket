import type { Scene3D } from '../scene/scene';

type Position = { x: number; y: number; z: number };
type Orientation = Position & { w: number };
export function localLidarPose(data: unknown): { position: Position; orientation: Orientation } | null {
  const message = data as { header?: { frame_id?: string }; pose?: { position?: Position; orientation?: Orientation; pose?: { position?: Position; orientation?: Orientation } } } | null;
  if (!message || (message.header?.frame_id && message.header.frame_id !== 'odom')) return null;
  const pose = message.pose?.pose ?? message.pose;
  const p = pose?.position, q = pose?.orientation;
  if (!p || !q || ![p.x,p.y,p.z,q.x,q.y,q.z,q.w].every(Number.isFinite)) return null;
  const norm = Math.hypot(q.x,q.y,q.z,q.w);
  if (norm < 0.5 || norm > 1.5) return null;
  return { position: p, orientation: { x:q.x/norm,y:q.y/norm,z:q.z/norm,w:q.w/norm } };
}

/** Drive's live renderer in its own coordinate frame. Display only: this class
 * has no command publisher or connection to exploration perception. */
export class MappingLiveView {
  readonly element = document.createElement('section');
  private body = document.createElement('div');
  private status = document.createElement('div');
  private toggle = document.createElement('button');
  private canvas = document.createElement('canvas');
  private scene: Scene3D | null = null;
  private loading = false;
  private failed = false;
  private available = false;
  private expanded = true;
  private suspended = false;
  private disposed = false;
  private data: unknown = null;
  private dataAt = -Infinity;
  private pose: ReturnType<typeof localLidarPose> = null;
  private poseAt = -Infinity;
  private timer: ReturnType<typeof setInterval>;
  private visibility = () => this.refresh();
  constructor(parent: HTMLElement) {
    this.element.className = 'mapping-live-view';
    this.element.setAttribute('aria-label', 'Nearby live LiDAR');
    const header = document.createElement('div');header.className = 'mapping-live-header';
    const title = document.createElement('strong');title.textContent = 'Nearby LiDAR';
    this.toggle.type = 'button';this.toggle.textContent = '−';
    this.toggle.addEventListener('click', () => { this.expanded = !this.expanded; this.refresh(); });
    header.append(title, this.toggle);
    this.body.className = 'mapping-live-body';
    this.canvas.setAttribute('aria-label', 'Live nearby surroundings');
    this.body.appendChild(this.canvas);
    this.status.className = 'mapping-live-status';
    this.element.append(header, this.body, this.status);parent.appendChild(this.element);
    this.timer = setInterval(() => this.refreshStatus(), 500);
    document.addEventListener('visibilitychange', this.visibility);
    this.refresh();
  }
  setAvailable(available: boolean): void {
    if (this.available === available) return;
    this.available = available;this.refresh();
  }
  setSuspended(suspended: boolean): void { this.suspended = suspended;this.refresh(); }
  private active(): boolean { return this.available && this.expanded && !this.suspended && !document.hidden; }
  private refresh(): void {
    if (this.disposed) return;
    this.element.hidden = !this.available || this.suspended;
    this.body.hidden = !this.expanded;this.status.hidden = !this.expanded;
    this.element.classList.toggle('is-collapsed', !this.expanded);
    this.toggle.textContent = this.expanded ? '−' : '+';
    this.toggle.setAttribute('aria-expanded', String(this.expanded));
    this.toggle.setAttribute('aria-label', this.expanded ? 'Hide nearby LiDAR' : 'Show nearby LiDAR');
    if (this.active() && !this.scene && !this.loading && !this.failed) void this.loadScene();
    this.scene?.setActive(this.active());
    if (this.active() && this.data && performance.now() - this.dataAt <= 2000) this.scene?.voxelMap.processCompressed(this.data);
    this.refreshStatus();
  }
  private async loadScene(): Promise<void> {
    this.loading = true;
    try {
      const { Scene3D } = await import('../scene/scene');
      if (this.disposed || !this.active()) return;
      this.scene = new Scene3D(this.canvas, true);
      this.scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.refresh();
    } catch { this.failed = true;this.refreshStatus(); }
    finally { this.loading = false; }
  }
  setData(data: unknown, at: number): void {
    if (this.disposed || !Number.isFinite(at) || at > performance.now()) return;
    this.data = data;this.dataAt = at;
    if (this.active() && performance.now() - at <= 2000) this.scene?.voxelMap.processCompressed(data);
    this.refreshStatus();
  }
  setPose(data: unknown, at: number): void {
    const pose = localLidarPose(data);
    if (!pose || !Number.isFinite(at) || at > performance.now()) return;
    this.pose = pose;this.poseAt = at;
    if (this.active()) this.scene?.robotModel.updateOdom(pose.position, pose.orientation);
  }
  private refreshStatus(): void {
    if (this.disposed) return;
    const age = performance.now() - this.dataAt;
    const fresh = !!this.data && age >= 0 && age <= 2000;
    this.element.classList.toggle('is-stale', !fresh);
    this.status.textContent = this.failed ? 'Live view unavailable' : fresh ? 'Live · nearby view' : this.data ? 'LiDAR not updating · last view' : 'Waiting for live LiDAR';
    if (this.active() && this.pose && performance.now() - this.poseAt <= 2000) this.scene?.robotModel.updateOdom(this.pose.position, this.pose.orientation);
  }
  destroy(): void {
    this.disposed = true;clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    this.scene?.destroy();this.scene = null;this.element.remove();
  }
}
