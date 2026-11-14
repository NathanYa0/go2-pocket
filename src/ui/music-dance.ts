interface Options {
  available(): boolean;
  play(id: string): Promise<unknown>;
  pause(): Promise<unknown>;
  dance(): number | undefined;
  stopDance(): void;
  state(busy: boolean, message: string): void;
  now?(): number;
}
interface Run {
  id: string;
  started: number;
  ready: boolean;
  heardPlaying: boolean;
  audioAt: number;
  danceAt: number;
  requestId?: number;
  dancing: boolean;
  cycle: number;
  sawMotion: boolean;
  movingSince?: number;
  movingSamples: number;
  danceIssue?: string;
  stoppedAt?: number;
  sawProgress: boolean;
  progressAt: number;
  idleSince?: number;
  idleSamples: number;
  quietSince?: number;
  motionAt?: number;
  angles?: { at: number; q: number[] };
  pending?: Promise<unknown>;
}

/** Repeat completed built-in routines while the selected song plays once.
 * Never restart a dance on a guessed fixed interval or replay the song.
 */
export class MusicDance {
  private run?: Run;
  private timer?: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
  constructor(private options: Options) {}
  private now(): number { return this.options.now?.() ?? performance.now(); }
  async start(id: string): Promise<void> {
    if (this.run || this.stopping || !this.options.available()) return;
    const now = this.now();
    const run: Run = { id, started: now, ready: false, heardPlaying: false,
      audioAt: now, danceAt: now, dancing: false, cycle: 0, sawMotion: false, movingSamples: 0, sawProgress: false,
      progressAt: now, idleSamples: 0 };
    this.run = run;
    this.options.state(true, 'Starting music; waiting for Go2 playback…');
    this.timer = setInterval(() => this.tick(), 250);
    try {
      run.pending = this.options.play(id);
      await run.pending;
      if (this.run !== run) return;
      run.ready = true;
      if (run.heardPlaying) this.beginDance(run);
    } catch {
      if (this.run === run) await this.stop('Could not start music.');
    }
  }
  playbackState(state: { is_playing?: boolean | 0 | 1; current_audio_unique_id?: string | null }): void {
    const run = this.run;
    if (!run) return;
    const playing = state.is_playing === true || state.is_playing === 1;
    const stopped = state.is_playing === false || state.is_playing === 0;
    const id = state.current_audio_unique_id;
    if (playing && id === run.id) {
      run.heardPlaying = true; run.audioAt = this.now();
      run.stoppedAt = undefined;
      if (run.ready && !run.dancing && !run.danceIssue) this.beginDance(run);
    } else if (run.heardPlaying && stopped && (!id || id === run.id)) {
      // Some firmware emits a brief false state around a routine transition.
      // Require a stable stop, without replaying/restarting the selected song.
      run.stoppedAt ??= this.now();
    } else if (run.heardPlaying && playing && id && id !== run.id) {
      void this.stop('Another track interrupted the song. Music dance stopped.');
    }
  }
  private beginDance(run: Run): void {
    if (this.run !== run || run.danceIssue || run.stoppedAt !== undefined || !this.options.available() || this.now() - run.audioAt > 3000) return;
    run.sawProgress = false; run.idleSince = undefined; run.idleSamples = 0;
    run.sawMotion = false; run.movingSince = undefined; run.movingSamples = 0;
    run.quietSince = undefined; run.motionAt = undefined; run.angles = undefined;
    run.progressAt = run.danceAt = this.now();
    try {
      run.requestId = this.options.dance();
      if (run.requestId === undefined) throw new Error('Dance not sent');
      run.dancing = true;
      run.cycle++;
      this.options.state(true, `Music playing · dance ${run.cycle}. Press Stop music to end.`);
    } catch { this.pauseDance(run, 'Could not start the dance'); }
  }
  danceResponse(id: number | undefined, code: number | undefined): void {
    if (id !== undefined && id === this.run?.requestId && code !== undefined && code !== 0) {
      this.pauseDance(this.run!, 'Go2 refused the dance');
    }
  }
  danceProgress(progress: unknown): void {
    const run = this.run;
    if (!run?.dancing || typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) return;
    const now = this.now();
    if (now - run.progressAt >= 1500) { run.idleSince = undefined; run.idleSamples = 0; }
    run.progressAt = now;
    if (progress > 0) { run.sawProgress = true; run.idleSince = undefined; run.idleSamples = 0; }
    else if (run.sawProgress) { run.idleSince ??= now; run.idleSamples++; }
    this.repeatIfSettled(run);
  }
  jointState(motors: unknown): void {
    const run = this.run;
    if (!run?.dancing) return;
    const now = this.now();
    const joints = Array.isArray(motors) ? motors.slice(0, 12) : [];
    const valid = (v: unknown[]): v is number[] => v.length === 12 && v.every(x => typeof x === 'number' && Number.isFinite(x));
    let speeds = joints.map(m => m?.dq);
    if (!valid(speeds)) {
      const q = joints.map(m => m?.q), previous = run.angles;
      if (!valid(q)) {
        run.quietSince = undefined; run.motionAt = undefined; run.angles = undefined;
        run.movingSince = undefined; run.movingSamples = 0; return;
      }
      if (!previous || now - previous.at >= 1500 || now < previous.at) {
        run.angles = { at: now, q }; run.quietSince = undefined; run.motionAt = undefined;
        run.movingSince = undefined; run.movingSamples = 0; return;
      }
      if (now - previous.at < 80) return;
      speeds = q.map((angle, i) => (angle - previous.q[i]) * 1000 / (now - previous.at));
      run.angles = { at: now, q };
    } else run.angles = undefined;
    if (run.motionAt === undefined || now - run.motionAt >= 1500) {
      run.quietSince = undefined; run.movingSince = undefined; run.movingSamples = 0;
    }
    run.motionAt = now;
    const rms = Math.sqrt(speeds.reduce((sum, v) => sum + v * v, 0) / 12);
    if (rms > 0.12 || speeds.some(v => Math.abs(v) > 0.35)) {
      run.quietSince = undefined;
      run.movingSince ??= now; run.movingSamples++;
      if (now - run.movingSince >= 500 && run.movingSamples >= 4) run.sawMotion = true;
    } else {
      run.quietSince ??= now; run.movingSince = undefined; run.movingSamples = 0;
    }
    this.repeatIfSettled(run);
  }
  private repeatIfSettled(run: Run): void {
    const now = this.now();
    if (run.quietSince === undefined || run.motionAt === undefined || now - run.motionAt >= 1500) return;
    const progressFresh = now - run.progressAt < 1500;
    const reportedComplete = run.sawProgress && progressFresh
      && run.idleSince !== undefined && run.idleSamples >= 3
      && now - run.idleSince >= 1200 && now - run.quietSince >= 1200;
    // This Pro can dance while progress stays zero. Require sustained observed
    // joint motion first, then a longer quiet period with fresh joint samples.
    // A short stage pause, one jolt, idle startup or missing samples is not EOF.
    const motionComplete = run.sawMotion && (!run.sawProgress || !progressFresh)
      && now - run.quietSince >= 3000;
    if (reportedComplete || motionComplete) this.beginDance(run);
  }
  private tick(): void {
    const run = this.run;
    if (!run) return;
    const now = this.now();
    if (!this.options.available()) void this.stop('Connection lost. Music dance stopped.');
    else if (!run.heardPlaying && now - run.started > 10000) void this.stop('Go2 did not confirm song playback. Dance not started.');
    else if (run.stoppedAt !== undefined && now - run.stoppedAt >= 750) void this.stop('Song ended. Dance stop requested.');
    else if (run.heardPlaying && now - run.audioAt > 5000) this.pauseDance(run, 'Playback updates stopped');
    else if (run.dancing && now - run.progressAt > 5000
      && (run.motionAt === undefined || now - run.motionAt >= 1500)) this.pauseDance(run, 'Dance updates stopped');
    else if (run.dancing && !run.sawProgress && !run.sawMotion && now - run.danceAt > 15000) this.pauseDance(run, 'Go2 did not report dance activity');
  }
  private pauseDance(run: Run, reason: string): void {
    if (this.run !== run || run.danceIssue) return;
    run.danceIssue = reason;
    if (run.dancing) this.options.stopDance();
    run.dancing = false;
    // Movement uncertainty must not become an audio PAUSE. Let the selected
    // file keep playing; Stop music, genuine EOF and disconnect still stop it.
    this.options.state(true, `${reason}. Dance paused; song playback left running. Press Stop music to end.`);
  }
  stop(message = 'Music and dance stopped.'): Promise<void> {
    if (this.stopping) return this.stopping;
    const run = this.run;
    if (!run) return Promise.resolve();
    this.run = undefined; clearInterval(this.timer); this.timer = undefined;
    if (run.dancing) this.options.stopDance();
    this.options.state(true, 'Stopping music and dance…');
    this.stopping = (async () => {
      // A delayed PLAY reply must be followed by PAUSE, never restart after Stop.
      try { await run.pending; } catch { /* pause any partial playback */ }
      try { await this.options.pause(); } catch { /* disconnected */ }
      this.stopping = undefined;
      this.options.state(false, message);
    })();
    return this.stopping;
  }
}
