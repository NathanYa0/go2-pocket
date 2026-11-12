/** Pointer-held teleoperation. A released gesture can never be sent again. */
export class MappingOperator {
  private gesture: string | null = null;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private release = () => this.stop();
  private hidden = () => { if (document.hidden) this.stop(); };
  constructor(private parent: HTMLElement, private ready: () => boolean,
    private send: (command: string, payload: Record<string, unknown>) => Promise<void>) {
    parent.querySelectorAll<HTMLButtonElement>('[data-drive]').forEach(button => {
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !ready()) return;
        event.preventDefault();this.stop();button.setPointerCapture(event.pointerId);
        const directions: Record<string, [number, number]> = {forward:[0.4,0],back:[-0.25,0],left:[0,0.5],right:[0,-0.5]};
        const [forward,yawRate] = directions[button.dataset.drive!];
        const gesture = this.gesture = crypto.randomUUID();
        const started = performance.now();
        const pump = async () => {
          if (this.gesture !== gesture) return;
          if (!ready() || performance.now() - started >= 10000) { this.stop();return; }
          try { await send('manual', {gesture,sequence:++this.sequence,forward,yawRate}); }
          catch { this.stop();return; }
          if (this.gesture === gesture) this.timer = setTimeout(() => void pump(), 100);
        };
        void pump();
      });
      for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,this.release);
    });
    window.addEventListener('blur',this.release);
    window.addEventListener('pagehide',this.release);
    document.addEventListener('visibilitychange',this.hidden);
  }
  async stop(): Promise<void> {
    const gesture=this.gesture;this.gesture=null;
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    if(gesture)await this.send('manual-stop',{gesture}).catch(()=>{});
  }
  destroy(): void {
    this.stop();window.removeEventListener('blur',this.release);window.removeEventListener('pagehide',this.release);
    document.removeEventListener('visibilitychange',this.hidden);
  }
}
