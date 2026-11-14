import { parseAudioList, parsePlayMode, type LoopMode } from './components/audio-player';
import { MusicDance } from './music-dance';

export const VOICE_SLOTS = [
  { key: 'hi', label: 'Hi' },
  { key: 'nice', label: 'Nice to meet you' },
  { key: 'guide', label: 'Explain instructions' },
  { key: 'music', label: 'Music' },
  { key: 'line1', label: 'Voice line 1' },
  { key: 'line2', label: 'Voice line 2' },
  { key: 'after1', label: 'After Voice line 1' },
] as const;
export type VoiceSlot = typeof VOICE_SLOTS[number]['key'];
type AudioFile = ReturnType<typeof parseAudioList>[number];
export interface CommunicationState {
  phase: 'loading' | 'idle' | 'starting' | 'recording' | 'saving' | 'working' | 'music' | 'closed';
  slot?: VoiceSlot;
  clips: Partial<Record<VoiceSlot, AudioFile>>;
  message: string;
  library: AudioFile[];
  uploadPercent?: number;
  audioBusy?: boolean;
}
interface Recorder {
  start(): Promise<void>;
  stop(): Promise<ArrayBuffer | null>;
  destroy(): void;
}
interface Options {
  available(): boolean;
  request(api: number, payload: string): Promise<unknown>;
  upload(wav: ArrayBuffer, name: string, check: () => void, progress?: (percent: number) => void): Promise<void>;
  readSelections?(): Partial<Record<VoiceSlot, string>>;
  saveSelections?(selections: Partial<Record<VoiceSlot, string>>): void;
  wait?(ms: number): Promise<void>;
  recorder(): Recorder;
  convertFile(file: File): Promise<ArrayBuffer>;
  offerPaw(): void;
  dance?(): number | undefined;
  stopDance?(): void;
  state(state: CommunicationState): void;
}

// Names live on Go2, so another phone/computer can recover the same slots.
// Version each replacement; never delete the previous voice before confirming upload.
function slotFiles(files: AudioFile[], slot: VoiceSlot): AudioFile[] {
  const pattern = new RegExp(`^Comm ${slot} (\\d{13})-[a-f0-9]{6}(?:\\.wav)?$`);
  return files.filter(file => file.UNIQUE_ID && pattern.test(file.CUSTOM_NAME))
    .sort((a, b) => Number(b.CUSTOM_NAME.match(pattern)![1]) - Number(a.CUSTOM_NAME.match(pattern)![1]));
}
export function communicationClips(files: AudioFile[]): CommunicationState['clips'] {
  return Object.fromEntries(VOICE_SLOTS.map(slot => [slot.key, slotFiles(files, slot.key)[0]]));
}

export class Communication {
  state: CommunicationState = { phase: 'loading', clips: {}, library: [], message: 'Loading saved voice lines…' };
  private recorder: Recorder | null = null;
  private task: Promise<void> = Promise.resolve();
  private closed = false;
  private stoppingEarly = false;
  private deadline?: ReturnType<typeof setTimeout>;
  private previousLoop: LoopMode | null = null;
  private touchedAudio = false;
  private closeTask?: Promise<void>;
  private selections: Partial<Record<VoiceSlot, string>> = {};
  private audioTask: Promise<void> = Promise.resolve();
  readonly music: MusicDance;
  constructor(private options: Options) {
    this.music = new MusicDance({
      available: () => !this.closed && options.available(),
      play: id => this.request(1002, JSON.stringify({ unique_id: id })),
      pause: () => options.request(1003, '{}'),
      dance: () => options.dance?.(), stopDance: () => options.stopDance?.(),
      state: (busy, message) => this.update(busy ? 'music' : 'idle', message, busy ? 'music' : undefined),
    });
    const saved = options.readSelections?.();
    if (saved && typeof saved === 'object') for (const { key } of VOICE_SLOTS) {
      if (typeof saved[key] === 'string') this.selections[key] = saved[key];
    }
  }
  private setLibrary(files: AudioFile[]): void {
    this.state.library = files;
    this.state.clips = communicationClips(files);
    for (const { key } of VOICE_SLOTS) {
      if (this.selections[key]) this.state.clips[key] = files.find(file => file.UNIQUE_ID === this.selections[key]);
    }
  }
  useSavedClip(slot: VoiceSlot, id: string): Promise<void> {
    if (this.state.phase !== 'idle' || this.closed || !id) return Promise.resolve();
    this.update('working', 'Checking saved audio…', slot);
    return this.run(async () => {
      const files = parseAudioList(await this.request(1001));
      if (!files.some(file => file.UNIQUE_ID === id)) throw new Error('That clip is no longer in Go2’s library. Refresh saved audio and try again.');
      const choices = { ...this.selections, [slot]: id };
      this.options.saveSelections?.(choices);
      this.selections = choices;
      this.setLibrary(files);
      this.update('idle', 'Saved clip selected. Press Play to hear it. This choice is remembered on this device.');
    });
  }

  private update(phase: CommunicationState['phase'], message: string, slot?: VoiceSlot, uploadPercent?: number): void {
    this.state = { ...this.state, phase, message, slot, uploadPercent };
    if (!this.closed) this.options.state(this.state);
  }
  private check = (): void => {
    if (this.closed) throw new Error('Communication closed.');
    if (!this.options.available()) throw new Error('Connect to Go2 to use Communication.');
  };
  private async request(api: number, payload = '{}'): Promise<unknown> {
    this.check();
    const response = await this.options.request(api, payload);
    this.check(); return response;
  }
  private run(work: () => Promise<void>): Promise<void> {
    this.task = work().catch(async error => {
      await this.audioTask;
      this.recorder?.destroy(); this.recorder = null;
      clearTimeout(this.deadline);
      this.update('idle', error instanceof Error ? error.message : 'Could not complete this action.');
    });
    return this.task;
  }
  load(): Promise<void> {
    if (this.closed || !['idle', 'loading'].includes(this.state.phase)) return Promise.resolve();
    this.update('loading', 'Refreshing saved audio…');
    return this.run(async () => {
      this.setLibrary(parseAudioList(await this.request(1001)));
      this.update('idle', 'Record or upload a voice line once. Play keeps it unchanged.');
    });
  }
  private async stopAudio(): Promise<void> {
    this.touchedAudio = true;
    await this.request(1003);
  }
  private async singlePlayback(): Promise<void> {
    if (!this.previousLoop) {
      this.previousLoop = parsePlayMode(await this.request(1010));
      if (!this.previousLoop) throw new Error('Could not read the audio repeat setting.');
    }
    await this.request(1007, JSON.stringify({ play_mode: 'no_cycle' }));
  }
  play(slot: VoiceSlot, danceWithMusic = true): Promise<void> {
    if (this.state.phase === 'saving' && !(slot === 'music' && danceWithMusic)) {
      return this.audioWhileSaving(slot);
    }
    if (this.state.phase !== 'idle' || this.closed) return Promise.resolve();
    this.update('working', 'Preparing playback…', slot);
    return this.run(async () => {
      // Refresh IDs in case another device replaced a recording.
      this.setLibrary(parseAudioList(await this.request(1001)));
      const clip = this.state.clips[slot];
      if (!clip) throw new Error('Record or upload this voice line first.');
      await this.stopAudio(); await this.singlePlayback();
      if (slot === 'music' && danceWithMusic) { await this.music.start(clip.UNIQUE_ID); return; }
      await this.request(1002, JSON.stringify({ unique_id: clip.UNIQUE_ID }));
      this.check();
      if (slot === 'nice') this.options.offerPaw();
      this.update('idle', slot === 'music' ? 'Playing the saved song only. Press Stop audio to end playback.' : slot === 'nice'
        ? 'Greeting playback and paw request sent. Go2 lowers its paw automatically.'
        : 'Playback requested. The saved voice line stays unchanged.');
    });
  }
  stopPlayback(): Promise<void> {
    if (this.state.phase === 'music') return this.music.stop();
    if (this.state.phase === 'saving') return this.audioWhileSaving();
    if (this.state.phase !== 'idle' || this.closed) return Promise.resolve();
    this.update('working', 'Stopping audio…');
    return this.run(async () => { await this.stopAudio(); this.update('idle', 'Audio stopped.'); });
  }
  private audioWhileSaving(slot?: VoiceSlot): Promise<void> {
    if (this.closed || this.state.audioBusy) return Promise.resolve();
    const clip = slot ? this.state.clips[slot] : undefined;
    if (slot && !clip) return Promise.resolve();
    this.state.audioBusy = true;
    this.options.state(this.state);
    const work = (async () => {
      await this.stopAudio();
      if (clip) {
        await this.singlePlayback();
        await this.request(1002, JSON.stringify({ unique_id: clip.UNIQUE_ID }));
        if (slot === 'nice') this.options.offerPaw();
      }
    })().catch(error => {
      if (!this.closed) this.update(this.state.phase,
        `Audio command failed; recording upload continues. ${error instanceof Error ? error.message : ''}`,
        this.state.slot, this.state.uploadPercent);
    }).finally(() => {
      this.state.audioBusy = false;
      if (!this.closed) this.options.state(this.state);
    });
    this.audioTask = work;
    return work;
  }
  uploadFile(slot: VoiceSlot, file: File): Promise<void> {
    if (this.state.phase !== 'idle' || this.closed) return Promise.resolve();
    this.update('working', 'Converting audio file…', slot);
    return this.run(async () => {
      this.check();
      if (!file.size) throw new Error('This file is empty. Previous voice kept.');
      const files = parseAudioList(await this.request(1001));
      if (files.length >= 10) throw new Error('Go2’s library is full. Free one slot in Sound & voice first. Your current recording is kept.');
      let wav: ArrayBuffer;
      try { wav = await this.options.convertFile(file); }
      catch { throw new Error('Could not read this audio file. Try WAV, MP3 or M4A supported by your browser. Previous voice kept.'); }
      this.check();
      if (wav.byteLength <= 44) throw new Error('The file contains no usable audio. Previous voice kept.');
      await this.stopAudio();
      await this.saveVoice(slot, wav);
    });
  }
  toggleRecord(slot: VoiceSlot): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.state.slot === slot && this.state.phase === 'starting') {
      this.stoppingEarly = true;
      this.update('starting', 'Finishing microphone startup, then saving…', slot);
      return this.task;
    }
    if (this.state.slot === slot && this.state.phase === 'recording') return this.finishRecording(slot);
    if (this.state.phase !== 'idle') return Promise.resolve();
    this.stoppingEarly = false;
    this.update('starting', 'Starting Go2 microphone…', slot);
    return this.run(async () => {
      const files = parseAudioList(await this.request(1001));
      if (files.length >= 10) throw new Error('Go2’s library is full. Free one slot in Sound & voice first. Your current recording is kept.');
      await this.stopAudio();
      this.recorder = this.options.recorder();
      await this.recorder.start(); this.check();
      this.update('recording', 'Recording on Go2. Press Stop & save when finished.', slot);
      // AudioRecorder caps capture at 60 s; finish before that cap discards its result.
      this.deadline = setTimeout(() => { void this.finishRecording(slot); }, 55_000);
      if (this.stoppingEarly) await this.finishRecordingWork(slot);
    });
  }
  private finishRecording(slot: VoiceSlot): Promise<void> {
    this.update('saving', 'Saving voice line to Go2…', slot);
    return this.run(() => this.finishRecordingWork(slot));
  }
  private async finishRecordingWork(slot: VoiceSlot): Promise<void> {
    clearTimeout(this.deadline);
    this.update('saving', 'Saving voice line to Go2…', slot);
    const recorder = this.recorder;
    const wav = await recorder?.stop();
    recorder?.destroy(); this.recorder = null; this.check();
    if (!wav || wav.byteLength <= 44) throw new Error('No usable audio recorded. Speak for at least half a second. Previous voice kept.');
    // Start the saved message after capture stops, before transferring the new
    // recording. Wait only for the PLAY command, never for the clip to finish.
    if (slot === 'line1') await this.audioWhileSaving('after1');
    await this.saveVoice(slot, wav);
  }
  playbackState(state: { is_playing?: boolean | 0 | 1; current_audio_unique_id?: string | null }): void {
    this.music.playbackState(state);
  }
  private async saveVoice(slot: VoiceSlot, wav: ArrayBuffer): Promise<void> {
    this.check();
    if (wav.byteLength > 10 * 1024 * 1024) throw new Error('Converted audio exceeds Go2’s 10 MB limit. Choose a shorter clip. Previous voice kept.');
    this.update('saving', 'Saving voice line to Go2…', slot);
    const before = parseAudioList(await this.request(1001));
    if (before.length >= 10) throw new Error('Go2’s library is full. Free one slot in Sound & voice first. Your current recording is kept.');
    const old = slotFiles(before, slot);
    const oldIds = new Set(before.map(file => file.UNIQUE_ID));
    const name = `Comm ${slot} ${Date.now()}-${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
    this.update('saving', 'Uploading to Go2… 0%', slot, 0);
    await this.options.upload(wav, name, this.check, percent => {
      const value = Math.max(0, Math.min(100, Math.round(percent)));
      this.update('saving', `Uploading to Go2… ${value}%`, slot, value);
    }); this.check();
    this.update('saving', 'Upload 100% — confirming saved audio on Go2…', slot, 100);
    let files: AudioFile[] = [], saved: AudioFile[] = [];
    // A successful final-block reply can precede the library update.
    for (let attempt = 0; attempt < 21; attempt++) {
      this.check();
      files = parseAudioList(await this.request(1001));
      this.setLibrary(files);
      saved = files.filter(file => file.UNIQUE_ID && (file.CUSTOM_NAME === name || file.CUSTOM_NAME === `${name}.wav`));
      if (saved.length) break;
      if (attempt < 20) await (this.options.wait?.(500) ?? new Promise(resolve => setTimeout(resolve, 500)));
    }
    if (saved.length !== 1) {
      const newCount = files.filter(file => file.UNIQUE_ID && !oldIds.has(file.UNIQUE_ID)).length;
      throw new Error(newCount
        ? 'Go2 added audio under a different name. Use “Use saved audio” below the line to select it. Previous voice kept.'
        : 'Go2 has not listed the uploaded clip yet. Press Refresh saved audio and check “Use saved audio” before uploading again. Previous voice kept.');
    }
    // Named uploads follow the latest version across clients; only explicit
    // library selections pin an ID on this device.
    const choices = { ...this.selections };
    delete choices[slot];
    this.options.saveSelections?.(choices); this.selections = choices;
    this.setLibrary(files);
    let cleanupFailed = false;
    for (const file of old) {
      if (file.UNIQUE_ID === saved[0].UNIQUE_ID || Object.entries(this.selections).some(([key, id]) => key !== slot && id === file.UNIQUE_ID)) continue;
      try { await this.request(1009, JSON.stringify({ unique_id: file.UNIQUE_ID })); }
      catch { cleanupFailed = true; }
    }
    this.check();
    await this.audioTask; this.check();
    const message = cleanupFailed ? 'New voice saved. An old copy could not be removed.' : 'Voice saved on Go2. It stays the same until you re-record or upload a replacement.';
    this.update('idle', message);
  }
  /** Cancel capture immediately; wait for in-flight replies before stopping/restoring audio. */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    const musicStopping = this.music.stop();
    clearTimeout(this.deadline); this.recorder?.destroy(); this.recorder = null;
    const pending = this.task;
    this.closeTask = (async () => {
      await pending;
      await this.audioTask;
      await musicStopping;
      if (this.touchedAudio) {
        try { await this.options.request(1003, '{}'); } catch { /* disconnected */ }
      }
      if (this.previousLoop) {
        try { await this.options.request(1007, JSON.stringify({ play_mode: this.previousLoop })); } catch { /* disconnected */ }
      }
      this.state.phase = 'closed';
    })();
    return this.closeTask;
  }
}
