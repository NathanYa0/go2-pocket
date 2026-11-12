import { parseAudioList, parsePlayMode, type LoopMode } from './components/audio-player';

export const VOICE_SLOTS = [
  { key: 'hi', label: 'Hi' },
  { key: 'nice', label: 'Nice to meet you' },
  { key: 'guide', label: 'Explain instructions' },
  { key: 'line1', label: 'Voice line 1' },
  { key: 'line2', label: 'Voice line 2' },
] as const;
export type VoiceSlot = typeof VOICE_SLOTS[number]['key'];
type AudioFile = ReturnType<typeof parseAudioList>[number];
export interface CommunicationState {
  phase: 'loading' | 'idle' | 'starting' | 'recording' | 'saving' | 'working' | 'closed';
  slot?: VoiceSlot;
  clips: Partial<Record<VoiceSlot, AudioFile>>;
  message: string;
}
interface Recorder {
  start(): Promise<void>;
  stop(): Promise<ArrayBuffer | null>;
  destroy(): void;
}
interface Options {
  available(): boolean;
  request(api: number, payload: string): Promise<unknown>;
  upload(wav: ArrayBuffer, name: string, check: () => void): Promise<void>;
  recorder(): Recorder;
  convertFile(file: File): Promise<ArrayBuffer>;
  offerPaw(): void;
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
  state: CommunicationState = { phase: 'loading', clips: {}, message: 'Loading saved voice lines…' };
  private recorder: Recorder | null = null;
  private task: Promise<void> = Promise.resolve();
  private closed = false;
  private stoppingEarly = false;
  private deadline?: ReturnType<typeof setTimeout>;
  private previousLoop: LoopMode | null = null;
  private touchedAudio = false;
  private closeTask?: Promise<void>;
  constructor(private options: Options) {}

  private update(phase: CommunicationState['phase'], message: string, slot?: VoiceSlot): void {
    this.state = { ...this.state, phase, message, slot };
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
    this.task = work().catch(error => {
      this.recorder?.destroy(); this.recorder = null;
      clearTimeout(this.deadline);
      this.update('idle', error instanceof Error ? error.message : 'Could not complete this action.');
    });
    return this.task;
  }
  load(): Promise<void> {
    return this.run(async () => {
      this.state.clips = communicationClips(parseAudioList(await this.request(1001)));
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
  play(slot: VoiceSlot): Promise<void> {
    if (this.state.phase !== 'idle' || this.closed) return Promise.resolve();
    this.update('working', 'Preparing playback…', slot);
    return this.run(async () => {
      // Refresh IDs in case another device replaced a recording.
      this.state.clips = communicationClips(parseAudioList(await this.request(1001)));
      const clip = this.state.clips[slot];
      if (!clip) throw new Error('Record or upload this voice line first.');
      await this.stopAudio(); await this.singlePlayback();
      await this.request(1002, JSON.stringify({ unique_id: clip.UNIQUE_ID }));
      this.check();
      if (slot === 'nice') this.options.offerPaw();
      this.update('idle', slot === 'nice'
        ? 'Greeting playback and paw request sent. Go2 lowers its paw automatically.'
        : 'Playback requested. The saved voice line stays unchanged.');
    });
  }
  stopPlayback(): Promise<void> {
    if (this.state.phase !== 'idle' || this.closed) return Promise.resolve();
    this.update('working', 'Stopping audio…');
    return this.run(async () => { await this.stopAudio(); this.update('idle', 'Audio stopped.'); });
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
    await this.saveVoice(slot, wav);
  }
  private async saveVoice(slot: VoiceSlot, wav: ArrayBuffer): Promise<void> {
    this.check();
    if (wav.byteLength > 10 * 1024 * 1024) throw new Error('Converted audio exceeds Go2’s 10 MB limit. Choose a shorter clip. Previous voice kept.');
    this.update('saving', 'Saving voice line to Go2…', slot);
    const before = parseAudioList(await this.request(1001));
    if (before.length >= 10) throw new Error('Go2’s library is full. Free one slot in Sound & voice first. Your current recording is kept.');
    const old = slotFiles(before, slot);
    const name = `Comm ${slot} ${Date.now()}-${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
    await this.options.upload(wav, name, this.check); this.check();
    const files = parseAudioList(await this.request(1001));
    const saved = files.filter(file => file.UNIQUE_ID && (file.CUSTOM_NAME === name || file.CUSTOM_NAME === `${name}.wav`));
    if (saved.length !== 1) throw new Error('Could not confirm the new recording. Previous voice kept.');
    this.state.clips = communicationClips(files);
    let cleanupFailed = false;
    for (const file of old) {
      if (file.UNIQUE_ID === saved[0].UNIQUE_ID) continue;
      try { await this.request(1009, JSON.stringify({ unique_id: file.UNIQUE_ID })); }
      catch { cleanupFailed = true; }
    }
    this.check();
    this.update('idle', cleanupFailed ? 'New voice saved. An old copy could not be removed.' : 'Voice saved on Go2. It stays the same until you re-record or upload a replacement.');
  }
  /** Cancel capture immediately; wait for in-flight replies before stopping/restoring audio. */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    clearTimeout(this.deadline); this.recorder?.destroy(); this.recorder = null;
    const pending = this.task;
    this.closeTask = (async () => {
      await pending;
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
