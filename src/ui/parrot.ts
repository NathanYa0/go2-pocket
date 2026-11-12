import { parseAudioList, parsePlayMode, type LoopMode } from './components/audio-player';

export interface ParrotSettings {
  previous: string;
  middle: string;
  ownedPrevious?: boolean;
}

/** Recover the latest Parrot voice from Go2, including turns on another client. */
export function latestParrotVoice(files: ReturnType<typeof parseAudioList>, settings?: ParrotSettings): { id: string; name: string; owned: boolean } | null {
  const generated = files.filter(file => file.UNIQUE_ID && file.UNIQUE_ID !== settings?.middle && /^Parrot \d{13}-[a-f0-9]+(?:\.wav)?$/.test(file.CUSTOM_NAME || ''))
    .sort((a, b) => Number(b.CUSTOM_NAME.slice(7, 20)) - Number(a.CUSTOM_NAME.slice(7, 20)));
  const file = generated[0] || files.find(file => file.UNIQUE_ID === settings?.previous && file.UNIQUE_ID !== settings?.middle);
  return file ? { id: file.UNIQUE_ID, name: file.CUSTOM_NAME || file.UNIQUE_ID, owned: generated.includes(file) || settings?.ownedPrevious === true } : null;
}
interface Recorder {
  start(): Promise<void>;
  stop(): Promise<ArrayBuffer | null>;
  destroy(): void;
  takeSignificantSound(): boolean;
}
interface Options {
  request(api: number, payload: string): Promise<unknown>;
  upload(wav: ArrayBuffer, name: string, check: () => void): Promise<void>;
  recorder(): Recorder;
  available(): boolean;
  save(settings: ParrotSettings): void;
  state(label: string): void;
  now?: () => number;
}

/** Play last turn, play a fixed prompt, then save this turn for next time. */
export class Parrot {
  private abort: AbortController | null = null;
  private recorder: Recorder | null = null;
  private playback: { id: string; started: boolean; done: () => void; fail: () => void } | null = null;
  get busy(): boolean { return this.abort !== null; }
  constructor(private options: Options) {}

  playbackState(state: { is_playing?: boolean | 0 | 1; current_audio_unique_id?: string | null }): void {
    const pending = this.playback;
    if (!pending) return;
    const id = state.current_audio_unique_id;
    if (state.is_playing === true || state.is_playing === 1) {
      if (id === pending.id) pending.started = true;
      else if (id) pending.fail();
    } else if ((state.is_playing === false || state.is_playing === 0)
      && pending.started && (!id || id === pending.id)) pending.done();
  }

  cancel(): void {
    this.abort?.abort();
    this.recorder?.destroy();
  }

  async start(settings: ParrotSettings): Promise<void> {
    if (this.busy) return;
    if (!this.options.available()) throw new Error('Connect to Go2 before using Parrot.');
    if (!settings.middle || settings.previous === settings.middle) {
      throw new Error('Choose a fixed middle line different from the previous response.');
    }
    const abort = this.abort = new AbortController();
    const check = () => {
      if (abort.signal.aborted || !this.options.available()) throw new Error('Parrot cancelled.');
    };
    const request = async (api: number, data = '{}') => {
      check(); const reply = await this.options.request(api, data); check(); return reply;
    };
    let previousLoop: LoopMode | null = null;
    let changedLoop = false;
    let failure: unknown;
    const play = async (id: string) => {
      check();
      // Arm before sending: playback notifications can precede the API reply.
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const complete = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      void complete.catch(() => {});
      const cancelled = () => fail(new Error('Parrot cancelled.'));
      abort.signal.addEventListener('abort', cancelled, { once: true });
      const timer = setTimeout(() => fail(new Error('Could not confirm playback finished. Parrot stopped.')), 120_000);
      this.playback = { id, started: false, done: finish, fail: () => fail(new Error('Another recording interrupted Parrot.')) };
      try { await request(1002, JSON.stringify({ unique_id: id })); await complete; check(); }
      finally { clearTimeout(timer); abort.signal.removeEventListener('abort', cancelled); this.playback = null; }
    };
    try {
      this.options.state('Preparing…');
      const files = parseAudioList(await request(1001));
      if (![settings.previous, settings.middle].filter(Boolean).every(id => files.some(file => file.UNIQUE_ID === id))) {
        throw new Error('A selected recording is missing. Choose the recordings again.');
      }
      if (files.length >= 10) throw new Error('Go2’s recording library is full. Remove an unused recording in Sound & voice first.');
      // Check the robot microphone before playing anything; capture starts later.
      const recorder = this.recorder = this.options.recorder();
      previousLoop = parsePlayMode(await request(1010));
      if (!previousLoop) throw new Error('Could not read Go2’s audio repeat setting.');
      changedLoop = true;
      await request(1007, JSON.stringify({ play_mode: 'no_cycle' }));
      if (settings.previous) {
        this.options.state('Playing previous voice…');
        await play(settings.previous);
      }
      this.options.state('Playing fixed line…');
      await play(settings.middle);
      this.options.state('Starting Go2 microphone…');
      await recorder.start(); check();
      const now = this.options.now ?? (() => performance.now());
      const started = now();
      let lastSound = started, heardSound = false, shownSecond = -1;
      const activity = () => {
        if (recorder.takeSignificantSound()) { lastSound = now(); heardSound = true; }
      };
      await new Promise<void>((resolve, reject) => {
        let poll: ReturnType<typeof setTimeout>;
        const finish = (error?: unknown) => {
          clearTimeout(poll); clearTimeout(deadline);
          abort.signal.removeEventListener('abort', cancelled);
          if (error) reject(error); else resolve();
        };
        const cancelled = () => finish(new Error('Parrot cancelled.'));
        const deadline = setTimeout(() => { activity(); finish(); }, 20_000);
        const sample = () => {
          try {
            check(); activity();
            if (now() - lastSound >= 3000) { finish(); return; }
            const second = Math.floor((now() - started) / 1000);
            if (second !== shownSecond) {
              shownSecond = second;
              this.options.state(`Recording Go2 microphone… ${second}s / 20s max`);
            }
            poll = setTimeout(sample, 100);
          } catch (error) { finish(error); }
        };
        abort.signal.addEventListener('abort', cancelled, { once: true });
        sample();
      });
      const wav = await recorder.stop(); recorder.destroy(); this.recorder = null; check();
      if (!heardSound) throw new Error('No significant sound was heard for 3 seconds. Previous voice kept.');
      if (!wav || wav.byteLength <= 44) throw new Error('No Go2 microphone audio was received. Previous voice kept.');
      this.options.state('Saving next voice…');
      const name = `Parrot ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      await this.options.upload(wav, name, check); check();
      const saved = parseAudioList(await request(1001)).filter(file => file.CUSTOM_NAME === name || file.CUSTOM_NAME === `${name}.wav`);
      if (saved.length !== 1 || !saved[0].UNIQUE_ID) throw new Error('Could not confirm the new recording. Previous voice kept.');
      this.options.save({ ...settings, previous: saved[0].UNIQUE_ID, ownedPrevious: true });
      // Only remove recordings created by Parrot; never delete user-selected clips.
      if (settings.ownedPrevious && settings.previous !== settings.middle) {
        try { await request(1009, JSON.stringify({ unique_id: settings.previous })); }
        catch { this.options.state('Voice saved. Old recording could not be removed.'); }
      }
      this.options.state('Saved for next time.');
    } catch (error) { failure = error; }
    finally {
      this.recorder?.destroy(); this.recorder = null;
      if (changedLoop) {
        try { await this.options.request(1003, '{}'); }
        catch { failure ??= new Error('Could not stop audio. Check Sound & voice.'); }
        try { await this.options.request(1007, JSON.stringify({ play_mode: previousLoop })); }
        catch { failure ??= new Error('Could not restore audio settings. Check Sound & voice.'); }
      }
      this.abort = null;
    }
    if (failure) throw failure;
  }
}
