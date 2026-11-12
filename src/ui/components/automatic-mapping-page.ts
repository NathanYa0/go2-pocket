import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './automatic-mapping.css';

type Status = { state: string; message: string; running: boolean; installed: boolean; runId?: string; saved?: boolean };
type Cloud = { points: number[][]; frame: string; capturedAt: number };
type SavedMap = { id: string; bytes: number; modified: number; preview: boolean };

/** Mac-owned mapping. No browser WebRTC session or manual command publisher. */
export class AutomaticMappingPage {
  private element = document.createElement('section');
  private client = crypto.randomUUID();
  private disposed = false;
  private owns = false;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: Status = { state: 'idle', message: 'Checking the Mac mapping engine…', running: false, installed: false };
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
  private orbit: OrbitControls;
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.035, vertexColors: true }));
  private resize: ResizeObserver;
  private fitted = false;
  private cloudAt = 0;
  private savedView = '';
  private frame = 0;
  private leave = () => { if (this.owns) void this.command('stop', true); };

  constructor(parent: HTMLElement, onBack: () => void, private readOnly = false) {
    this.element.className = 'auto-map-page';
    this.element.innerHTML = `
      <header><button data-back aria-label="Back">‹ Back</button><h2>Automatic mapping</h2><button data-toggle aria-expanded="true">Controls ‹</button></header>
      <div class="auto-map-layout"><div class="auto-map-view"><canvas aria-label="DimOS 3D room map"></canvas><div class="auto-map-caption">Waiting for map points. Drag to rotate; scroll or pinch to zoom.</div><button class="auto-map-fit">Fit map</button></div>
      <aside><h3>Explore the room</h3><p>The Mac builds the map while Go2 explores. Drive is disconnected while this screen owns the robot.</p>
        <p class="auto-map-status" role="status"></p>
        <label class="auto-map-confirm"><input type="checkbox"> I’m watching Go2, the floor is clear of drops, and the remote stop is available.</label>
        <div class="auto-map-buttons"><button data-command="start">Start new map</button><button data-command="explore">Explore</button><button data-command="pause">Pause movement</button><button data-command="stop">Stop & Save</button></div>
        <p class="auto-map-help">Start may make Go2 stand. Explore starts walking. Keep this tab open; losing the app connection stops exploration. Maps stay on this Mac.</p>
        <h3>Saved maps</h3><button class="auto-map-live">Show live map</button><div class="auto-map-saved"></div>
      </aside></div>`;
    parent.appendChild(this.element);
    this.element.querySelector('[data-back]')!.addEventListener('click', async () => {
      if (this.status.running) { await this.command('stop'); return; }
      onBack();
    });
    const toggle = this.element.querySelector<HTMLButtonElement>('[data-toggle]')!;
    toggle.onclick = () => {
      const collapsed = this.element.classList.toggle('drawer-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));toggle.textContent = collapsed ? 'Controls ›' : 'Controls ‹';
    };
    this.element.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(button => {
      button.onclick = () => void this.command(button.dataset.command!);
    });
    this.element.querySelector('input')!.addEventListener('change', () => this.renderStatus());
    this.element.querySelector('.auto-map-live')!.addEventListener('click', () => { this.savedView = ''; this.cloudAt = 0;this.fitted = false; });
    this.element.querySelector('.auto-map-fit')!.addEventListener('click', () => this.fit());
    const canvas = this.element.querySelector('canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new THREE.Color('#edf4f3');
    this.scene.add(this.points, new THREE.GridHelper(40, 40, '#a8c5c1', '#d4e3e0'));
    this.camera.position.set(7, 10, 9);
    this.orbit = new OrbitControls(this.camera, canvas);this.orbit.enableDamping = true;
    this.resize = new ResizeObserver(() => {
      const box = canvas.parentElement!.getBoundingClientRect();
      this.renderer.setSize(Math.max(1, box.width), Math.max(1, box.height), false);
      this.camera.aspect = box.width / Math.max(1, box.height);this.camera.updateProjectionMatrix();
    });
    this.resize.observe(canvas.parentElement!);
    const animate = () => {
      if (this.disposed) return;
      this.orbit.update();this.renderer.render(this.scene, this.camera);this.frame = requestAnimationFrame(animate);
    };
    animate();
    window.addEventListener('pagehide', this.leave);
    void this.poll();
  }

  private async api(path: string, method = 'GET', keepalive = false): Promise<any> {
    const response = await fetch('/mapping-api/' + path, { method,
      headers: method === 'POST' ? { 'X-Pocket-Mapping': this.client } : {}, keepalive,
      signal: keepalive ? undefined : AbortSignal.timeout(5000) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Open this app on the Mac using npm run dev. The iPhone installation cannot run the mapping engine locally.');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Mapping request failed.');
    return body;
  }
  private async command(command: string, keepalive = false): Promise<void> {
    if (this.readOnly) return;
    if (command === 'start' && !this.element.querySelector<HTMLInputElement>('input')!.checked) return;
    if (this.busy && command !== 'stop') return;
    this.busy = true;this.renderStatus();
    try {
      const result = await this.api(command, 'POST', keepalive);
      if (command === 'start') { this.owns = true; this.savedView = '';this.fitted = false;this.cloudAt = 0;this.draw({ points: [], frame: 'map', capturedAt: 0 }); }
      this.status = result;
    } catch (error) {
      this.status.message = error instanceof Error ? error.message : 'Mapping command failed.';
    } finally { this.busy = false;if (!this.disposed) this.renderStatus(); }
  }
  private async poll(): Promise<void> {
    try {
      if (this.owns) await this.api('heartbeat', 'POST');
      this.status = await this.api('status');
      if (!this.status.running) this.owns = false;
      if (!this.savedView) {
        const cloud: Cloud | null = await this.api('cloud');
        if (cloud && cloud.capturedAt !== this.cloudAt) this.draw(cloud);
      }
      if (!this.status.running) await this.refreshMaps();
    } catch (error) {
      this.status.state = 'unavailable';
      this.status.message = error instanceof Error ? error.message : 'Cannot reach mapping service.';
    }
    if (this.disposed) return;
    this.renderStatus();this.timer = setTimeout(() => void this.poll(), 1500);
  }
  private renderStatus(): void {
    if (this.disposed) return;
    this.element.querySelector('.auto-map-status')!.textContent = this.status.message;
    const confirmed = this.element.querySelector<HTMLInputElement>('input')!.checked;
    this.element.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(button => {
      const cmd = button.dataset.command;
      button.disabled = this.readOnly || (cmd === 'stop' ? !this.status.running : this.busy ||
        (cmd === 'start' ? this.status.running || !this.status.installed || !confirmed :
          !this.owns || !['mapping','exploring'].includes(this.status.state)));
    });
    if (this.readOnly) this.element.querySelector('.auto-map-status')!.textContent = 'Preview only. Robot movement is disabled.';
    if (!this.status.installed && !this.status.running && this.status.state === 'idle') {
      this.element.querySelector('.auto-map-status')!.textContent = 'Install the Mac engine once: npm run mapping:setup. Then reload this screen.';
    }
    this.element.querySelector<HTMLButtonElement>('[data-back]')!.textContent = this.status.running ? 'Stop before leaving' : '‹ Back';
  }
  private async refreshMaps(): Promise<void> {
    const maps: SavedMap[] = await this.api('maps');
    if (this.disposed) return;
    const list = this.element.querySelector('.auto-map-saved')!;
    list.replaceChildren();
    if (!maps.length) { list.textContent = 'No saved maps yet.';return; }
    for (const map of maps) {
      const row = document.createElement('div');row.className = 'auto-map-saved-row';
      const title = document.createElement('span');title.textContent = new Date(map.modified).toLocaleString();
      const view = document.createElement('button');view.textContent = 'View';view.disabled = !map.preview;
      view.onclick = async () => {
        try { const cloud = await this.api('preview/' + map.id);this.savedView = map.id;this.fitted = false;this.draw(cloud); }
        catch { this.status.message = 'Could not load that map preview.';this.renderStatus(); }
      };
      const download = document.createElement('a');download.textContent = 'Download';download.href = '/mapping-api/map/' + map.id;download.download = map.id + '.map.db';
      row.append(title, view, download);list.appendChild(row);
    }
  }
  private draw(cloud: Cloud): void {
    if (this.disposed) return;
    const positions: number[] = [], colors: number[] = [];
    for (const p of cloud.points) {
      if (p.length !== 3 || !p.every(Number.isFinite)) continue;
      positions.push(p[0], p[2], -p[1]);
      const c = new THREE.Color().setHSL(0.48 - Math.min(Math.max(p[2], 0), 2) * 0.18, 0.65, 0.43);
      colors.push(c.r, c.g, c.b);
    }
    this.points.geometry.dispose();this.points.geometry = new THREE.BufferGeometry();
    this.points.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.cloudAt = cloud.capturedAt;
    this.element.querySelector('.auto-map-caption')!.textContent = `${this.savedView ? 'Saved' : 'Live'} map · ${positions.length / 3} displayed points · ${cloud.frame} frame. Drag to rotate; pinch to zoom.`;
    if (!this.fitted && positions.length) this.fit();
  }
  private fit(): void {
    this.points.geometry.computeBoundingSphere();
    const sphere = this.points.geometry.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius)) return;
    this.orbit.target.copy(sphere.center);const r = Math.max(2, sphere.radius);
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(r, r * 1.4, r));this.orbit.update();this.fitted = true;
  }
  get running(): boolean { return this.status.running || this.busy; }
  stop(): void { void this.command('stop'); }

  destroy(): void {
    this.leave();this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('pagehide', this.leave);
    cancelAnimationFrame(this.frame);this.resize.disconnect();this.orbit.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.Points || object instanceof THREE.LineSegments) { object.geometry.dispose();const materials = Array.isArray(object.material) ? object.material : [object.material];materials.forEach(m => m.dispose()); } });
    this.renderer.dispose();this.element.remove();
  }
}
