import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './automatic-mapping.css';
import { MappingOperator } from './mapping-operator';

type Status = { state: string; message: string; running: boolean; installed: boolean; runId?: string; saved?: boolean; pose?: {position: number[]; yaw: number; frame: string; receivedAt: number}; path?: {points: number[][]; frame: string} | null };
type Cloud = { points: number[][]; frame: string; capturedAt: number; totalPoints?: number; palette?: number[][] };
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
  private points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.025, vertexColors: true }));
  private operator: MappingOperator;
  private liveFrame = '';
  private target: {x:number;y:number} | null = null;
  private flag = new THREE.Group();
  private robot = new THREE.Group();
  private route = new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffc857}));
  private resize: ResizeObserver;
  private fitted = false;
  private panelResize: ResizeObserver;
  private cloudAt = 0;
  private savedView = '';
  private frame = 0;
  private leave = () => { if (this.owns) void this.command('stop', true); };

  constructor(parent: HTMLElement, onBack: () => void, private readOnly = false) {
    this.element.className = 'auto-map-page';
    this.element.innerHTML = `
      <header><button data-back aria-label="Back">‹ Back</button><h2>Automatic mapping</h2><button data-command="stop" class="auto-map-emergency">Stop robot</button><button data-toggle aria-expanded="true">Controls ‹</button></header>
      <div class="auto-map-layout"><div class="auto-map-view"><canvas aria-label="DimOS 3D room map"></canvas><div class="auto-map-caption">Waiting for map points. Drag to rotate; scroll or pinch to zoom.</div><button class="auto-map-fit">Fit map</button></div>
      <div class="auto-map-resizer" role="separator" tabindex="0" aria-label="Resize mapping controls" aria-orientation="vertical"></div><aside><h3>Explore the room</h3><p>The Mac builds the map while Go2 explores. Explore automatically, drive to missed areas, or send Go2 to a flag—all while building the same map.</p>
        <p class="auto-map-status" role="status"></p>
        <label class="auto-map-confirm"><input type="checkbox"> I’m watching Go2, the floor is clear of drops, and the remote stop is available.</label>
        <div class="auto-map-buttons"><button data-command="start">Start new map</button><button data-command="explore">Explore</button><button data-command="pause">Pause movement</button><button data-command="stop">Stop & Save</button></div>
        <p class="auto-map-help">Start may make Go2 stand. Explore starts walking. Keep this tab open; losing the app connection stops exploration. Maps stay on this Mac.</p>
        <h3>Drive to missed areas</h3>
        <div class="auto-map-manual"><button data-drive="forward">Hold forward</button><button data-drive="left">Hold left turn</button><button data-drive="back">Hold back</button><button data-drive="right">Hold right turn</button></div>
        <p class="auto-map-help">Release to stop. A hold lasts up to 10 seconds. Manual drive cancels the current route; watch the floor and robot.</p>
        <h3>Choose a destination</h3>
        <div class="auto-map-buttons"><button data-place-flag>⚑ Drag flag to map</button><button data-top-view>Top view</button><button data-go-flag>Go to flag</button><button data-clear-flag>Clear flag</button></div>
        <p class="auto-map-goal" role="status">Drag the flag button onto the live map, or click it then click the map. Press Go to flag to move.</p>
        <p class="auto-map-help">The planner checks the route. If blocked, it may choose a nearby safe point or report no route. Saved maps are view-only.</p>
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
    const layout = this.element.querySelector<HTMLElement>('.auto-map-layout')!;
    const aside = this.element.querySelector<HTMLElement>('aside')!;
    const handle = this.element.querySelector<HTMLElement>('.auto-map-resizer')!;
    let panelWidth = 330;
    try {
      const stored = Number(localStorage.getItem('pocket-mapping-panel-width'));
      if (Number.isFinite(stored) && stored >= 180) panelWidth = stored;
    } catch { /* Storage can be unavailable. */ }
    const setPanelWidth = (requested: number, persist = false) => {
      const max = Math.max(180, layout.clientWidth - 120);
      const width = Math.min(max, Math.max(180, requested));
      aside.style.width = `${width}px`;
      handle.setAttribute('aria-valuemin', '180');
      handle.setAttribute('aria-valuemax', String(max));
      handle.setAttribute('aria-valuenow', String(Math.round(width)));
      if (persist) {
        panelWidth = width;
        try { localStorage.setItem('pocket-mapping-panel-width', String(width)); } catch { /* Optional preference. */ }
      }
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      setPanelWidth(layout.getBoundingClientRect().right - event.clientX - handle.clientWidth / 2, true);
    });
    const release = (event: PointerEvent) => {
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', release);handle.addEventListener('pointercancel', release);
    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setPanelWidth(aside.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20), true);
    });
    this.panelResize = new ResizeObserver(() => setPanelWidth(panelWidth));
    this.panelResize.observe(layout);
    setPanelWidth(panelWidth);
    const canvas = this.element.querySelector('canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new THREE.Color('#161b23');
    this.scene.add(this.points, new THREE.GridHelper(40, 40, '#486277', '#293846'));
    this.camera.position.set(7, 10, 9);
    this.orbit = new OrbitControls(this.camera, canvas);this.orbit.enableDamping = true;
    this.setupMapControls(canvas);
    this.operator = new MappingOperator(this.element, () => this.canMove(), async (command,payload) => {
      try { await this.api(command,'POST',command==='manual-stop',payload); }
      catch (error) { this.status.message = error instanceof Error ? error.message : 'Movement request failed.';this.renderStatus();throw error; }
    });
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

  private async api(path: string, method = 'GET', keepalive = false, payload?: Record<string,unknown>): Promise<any> {
    const response = await fetch('/mapping-api/' + path, { method,
      headers: method === 'POST' ? { 'X-Pocket-Mapping': this.client, 'Content-Type':'application/json' } : {}, keepalive,
      body: payload ? JSON.stringify({...payload,runId:this.status.runId}) : undefined,
      signal: keepalive ? undefined : AbortSignal.timeout(5000) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Open this app on the Mac using npm run dev. The iPhone installation cannot run the mapping engine locally.');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Mapping request failed.');
    return body;
  }
  private async command(command: string, keepalive = false): Promise<void> {
    if (this.readOnly) return;
    await this.operator?.stop();
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
        this.drawNavigation();
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
          !this.owns || !['mapping','exploring','navigating','manual'].includes(this.status.state)));
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-drive]').forEach(b=>b.disabled=!this.canMove());
    this.element.querySelector<HTMLButtonElement>('[data-go-flag]')!.disabled=!this.canTarget();
    this.element.querySelector<HTMLButtonElement>('[data-place-flag]')!.disabled=!this.canMove() || this.liveFrame !== 'world';
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
        try { const cloud = await this.api('preview/' + map.id);this.savedView = map.id;this.clearFlag();this.robot.visible=false;this.route.visible=false;this.fitted = false;this.draw(cloud); }
        catch { this.status.message = 'Could not load that map preview.';this.renderStatus(); }
      };
      const download = document.createElement('a');download.textContent = 'Download';download.href = '/mapping-api/map/' + map.id;download.download = map.id + '.map.db';
      row.append(title, view, download);list.appendChild(row);
    }
  }
  private draw(cloud: Cloud): void {
    if (this.disposed) return;
    this.liveFrame = cloud.frame;
    const positions: number[] = [], colors: number[] = [];
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of cloud.points) if (Number.isFinite(p[2])) { minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]); }
    const palette = cloud.palette?.map(rgb=>new THREE.Color().setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255).convertSRGBToLinear());
    for (const p of cloud.points) {
      if (p.length !== 3 || !p.every(Number.isFinite)) continue;
      positions.push(p[0], p[2], -p[1]);
      const height = (p[2]-minZ)/Math.max(0.001,maxZ-minZ);
      const c = palette?.[Math.min(255,Math.floor(height*255))] ?? new THREE.Color().setHSL(0.7-height*0.7,0.8,0.55);
      colors.push(c.r, c.g, c.b);
    }
    this.points.geometry.dispose();this.points.geometry = new THREE.BufferGeometry();
    this.points.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.cloudAt = cloud.capturedAt;
    this.element.querySelector('.auto-map-caption')!.textContent = `${this.savedView ? 'Saved' : 'Live'} map · ${(positions.length / 3).toLocaleString()} / ${(cloud.totalPoints ?? cloud.points.length).toLocaleString()} points · ${cloud.frame} frame. Drag to rotate; pinch to zoom.`;
    if (!this.fitted && positions.length) this.fit();
  }
  private canMove(): boolean {
    return !this.readOnly && this.owns && !this.savedView && this.status.running &&
      ['mapping','exploring','navigating','manual'].includes(this.status.state);
  }
  private canTarget(): boolean {
    return this.canMove() && !!this.target && this.liveFrame==='world' && Date.now()-this.cloudAt<5000 &&
      this.status.pose?.frame==='world' && Date.now()-this.status.pose.receivedAt<2000;
  }
  private clearFlag(): void {
    this.target=null;this.flag.visible=false;
    this.element.querySelector('.auto-map-goal')!.textContent='Drag a flag onto the live map, then press Go to flag.';
  }
  private setupMapControls(canvas: HTMLCanvasElement): void {
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.7),new THREE.MeshBasicMaterial({color:0xffffff}));pole.position.y=0.35;
    const cloth=new THREE.Mesh(new THREE.PlaneGeometry(0.35,0.22),new THREE.MeshBasicMaterial({color:0xffb52e,side:THREE.DoubleSide}));cloth.position.set(0.18,0.58,0);
    this.flag.add(pole,cloth);this.flag.visible=false;
    const body=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.25,0.3),new THREE.MeshBasicMaterial({color:0x43dfa5}));body.position.y=0.08;
    this.robot.add(body,new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(0,0.28,0),0.65,0xffffff,0.2,0.12));this.robot.visible=false;
    this.scene.add(this.flag,this.robot,this.route);
    let placing=false,dragging=false;
    const button=this.element.querySelector<HTMLButtonElement>('[data-place-flag]')!;
    const place=(x:number,y:number) => {
      if (!this.canMove() || this.liveFrame!=='world')return;
      const rect=canvas.getBoundingClientRect();
      if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return;
      const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),this.camera);
      const point=new THREE.Vector3();
      if(!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),point))return;
      if(Math.abs(point.x)>100||Math.abs(point.z)>100)return;
      this.target={x:point.x,y:-point.z};this.flag.position.copy(point);this.flag.visible=true;
      this.element.querySelector('.auto-map-goal')!.textContent=`Flag: ${point.x.toFixed(2)} m, ${(-point.z).toFixed(2)} m. Press Go to flag to start.`;
      this.renderStatus();
    };
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0||!this.canMove())return;
      event.preventDefault();dragging=true;placing=true;this.orbit.enabled=false;button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove',event=>{if(dragging)place(event.clientX,event.clientY);});
    button.addEventListener('pointerup',event=>{
      if(!dragging)return;dragging=false;place(event.clientX,event.clientY);
      const r=canvas.getBoundingClientRect();placing=!(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom);
      this.orbit.enabled=!placing;
    });
    button.addEventListener('pointercancel',()=>{dragging=false;placing=false;this.orbit.enabled=true;});
    button.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();placing=true;this.orbit.enabled=false;}});
    canvas.addEventListener('pointerdown',event=>{if(placing){place(event.clientX,event.clientY);placing=false;this.orbit.enabled=true;}});
    this.element.querySelector('[data-clear-flag]')!.addEventListener('click',()=>{placing=false;this.orbit.enabled=true;this.clearFlag();this.renderStatus();});
    this.element.querySelector('[data-top-view]')!.addEventListener('click',()=>{
      const t=this.orbit.target.clone();const distance=Math.max(5,this.camera.position.distanceTo(t));
      this.camera.position.set(t.x,t.y+distance,t.z+0.001);this.orbit.update();
    });
    this.element.querySelector('[data-go-flag]')!.addEventListener('click',async()=>{
      if(!this.canTarget())return;
      await this.operator.stop();
      try { await this.api('goal','POST',false,{...this.target,frame:'world'}); }
      catch(error){this.status.message=error instanceof Error?error.message:'Could not send flag.';this.renderStatus();}
    });
  }
  private drawNavigation(): void {
    const pose=this.status.pose;
    this.robot.visible=!!pose&&pose.frame===this.liveFrame&&Date.now()-pose.receivedAt<2000;
    if(pose&&this.robot.visible){this.robot.position.set(pose.position[0],pose.position[2],-pose.position[1]);this.robot.rotation.y=pose.yaw;}
    const path=this.status.path;
    this.route.visible=!!path&&path.frame===this.liveFrame;
    if(path&&this.route.visible){
      const xyz=path.points.flatMap(p=>[p[0],p[2]+0.04,-p[1]]);
      this.route.geometry.dispose();this.route.geometry=new THREE.BufferGeometry();
      this.route.geometry.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));
    }
  }
  private fit(): void {
    this.points.geometry.computeBoundingSphere();
    const sphere = this.points.geometry.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius)) return;
    this.orbit.target.copy(sphere.center);const r = Math.max(2, sphere.radius);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = r / Math.sin(Math.min(vertical, horizontal) / 2) * 1.08;
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(1, 1.4, 1).normalize().multiplyScalar(distance));
    this.camera.far = Math.max(300, distance + r * 2);this.camera.updateProjectionMatrix();
    this.orbit.update();this.fitted = true;
  }
  get running(): boolean { return this.status.running || this.busy; }
  stop(): void { void this.command('stop'); }

  destroy(): void {
    this.operator.destroy();this.leave();this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('pagehide', this.leave);
    cancelAnimationFrame(this.frame);this.resize.disconnect();this.panelResize.disconnect();this.orbit.dispose();
    this.scene.traverse(object => { if (object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Mesh) { object.geometry.dispose();const materials = Array.isArray(object.material) ? object.material : [object.material];materials.forEach(m => m.dispose()); } });
    this.renderer.dispose();this.element.remove();
  }
}
