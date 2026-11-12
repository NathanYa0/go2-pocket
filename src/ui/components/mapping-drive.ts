export interface MappingDriveState { lx: number; ly: number; rx: number; ry: number }
const ZERO = { lx: 0, ly: 0, rx: 0, ry: 0 };

/** Hold-to-drive, with release/blur/hidden cleanup and a bounded hold duration. */
export class MappingDrive {
  readonly element = document.createElement('div');
  private timer: ReturnType<typeof setInterval> | undefined;
  private pressedAt = 0;
  private pointer: number | null = null;
  private readonly blur = () => this.stop();
  private readonly visibility = () => { if (document.hidden) this.stop(); };
  constructor(private canDrive: () => boolean, private send: (state: MappingDriveState) => void,
    private onStart: () => void, private status: (text: string) => void) {
    this.element.className = 'mapping-drive';
    for (const [label, state] of [
      ['Forward', { ...ZERO, ly: 0.15 }], ['Back', { ...ZERO, ly: -0.15 }],
      ['Turn left', { ...ZERO, rx: -0.15 }], ['Turn right', { ...ZERO, rx: 0.15 }],
    ] as const) {
      const button = document.createElement('button');
      button.className = 'mapping-btn';
      button.textContent = label;
      button.style.touchAction = 'none';
      button.addEventListener('contextmenu', e => e.preventDefault());
      button.addEventListener('pointerdown', e => {
        if (!e.isPrimary || e.button !== 0 || this.pointer !== null) return;
        e.preventDefault();
        if (!this.canDrive()) { this.status('Wait for a live mapping or localized position before driving.'); return; }
        this.pointer = e.pointerId;
        button.setPointerCapture(e.pointerId);
        this.pressedAt = performance.now();
        this.onStart();
        const tick = () => {
          if (!this.canDrive() || performance.now() - this.pressedAt > 10_000) {
            this.stop(); this.status('Drive stopped. Release and hold again to continue.'); return;
          }
          this.send(state);
        };
        tick();
        if (this.pointer !== null) this.timer = setInterval(tick, 50);
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(event, () => this.stop());
      }
      this.element.appendChild(button);
    }
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
  }
  stop(): void {
    clearInterval(this.timer); this.timer = undefined;
    if (this.pointer !== null) this.send({ ...ZERO });
    this.pointer = null;
  }
  destroy(): void {
    this.stop();
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
