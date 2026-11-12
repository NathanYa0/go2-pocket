import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/ui/audio-recorder.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { AudioRecorder } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const properties = ['window', 'navigator', 'MediaStream', 'AudioWorkletNode'];
const original = properties.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
const realNow = Date.now;
let now = 1000, localMicCalls = 0, originalStops = 0, clonedStops = 0, worklet;
const source = {
  readyState: 'live', enabled: true,
  stop() { originalStops++; },
  clone() { return { readyState: 'live', enabled: true, stop() { clonedStops++; this.readyState = 'ended'; } }; },
};
class Stream { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } getTracks() { return this.tracks; } }
class Context {
  state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} };
  resume = async () => {};
  close = async () => { this.state = 'closed'; };
  createMediaStreamSource(stream) {
    assert.notEqual(stream.getAudioTracks()[0], source, 'record only cloned remote tracks');
    return { connect() {}, disconnect() {} };
  }
}
try {
  Date.now = () => now;
  const globals = {
    window: { AudioContext: Context },
    navigator: { mediaDevices: { getUserMedia: async () => { localMicCalls++; throw Error('Local microphone forbidden'); } } },
    MediaStream: Stream,
    AudioWorkletNode: class { port = {}; constructor() { worklet = this; } connect() {} disconnect() {} },
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
  const recorder = new AudioRecorder(new Stream([source]));
  await recorder.start(); worklet.port.onmessage({ data: new Float32Array([0.2, -0.3, 0.1]) }); now += 1000;
  const wav = await recorder.stop(); recorder.destroy();
  assert.ok(wav.byteLength > 44); assert.ok(clonedStops > 0); assert.equal(originalStops, 0);
  const boosted = new AudioRecorder(new Stream([source]), 5);
  await boosted.start(); worklet.port.onmessage({ data: new Float32Array([0.1, -0.1, 0.8, -0.8]) }); now += 1000;
  const boostedWav = new DataView(await boosted.stop()); boosted.destroy();
  assert.equal(boostedWav.getInt16(44, true), 16384, 'Parrot recordings get 5x gain');
  assert.equal(boostedWav.getInt16(46, true), -16384);
  assert.equal(boostedWav.getInt16(48, true), 32767, 'positive peaks saturate without wrapping');
  assert.equal(boostedWav.getInt16(50, true), -32768, 'negative peaks saturate without wrapping');
  const activity = new AudioRecorder(new Stream([source]), 5); await activity.start();
  assert.equal(activity.takeSignificantSound(), false);
  worklet.port.onmessage({ data: new Float32Array(128).fill(0.001) });
  assert.equal(activity.takeSignificantSound(), false, 'quiet background noise does not reset silence');
  worklet.port.onmessage({ data: new Float32Array(128).fill(0.006) });
  assert.equal(activity.takeSignificantSound(), true, 'RMS activity is detected before gain');
  assert.equal(activity.takeSignificantSound(), false, 'activity is consumed and cannot extend silence indefinitely');
  worklet.port.onmessage({ data: new Float32Array(128).fill(0.004) });
  assert.equal(activity.takeSignificantSound(), false, '5x gain does not make quiet noise significant');
  activity.destroy();
  const missing = new AudioRecorder(new Stream([]));
  await assert.rejects(missing.start(), /Go2 microphone is unavailable/);
  const silent = new AudioRecorder(new Stream([source])); await silent.start(); now += 1000;
  assert.equal(await silent.stop(), null, 'missing remote audio must not replace previous voice'); silent.destroy();
  const ended = new AudioRecorder(new Stream([source])); await ended.start();
  worklet.port.onmessage({ data: new Float32Array([0.2]) }); source.readyState = 'ended'; now += 1000;
  assert.equal(await ended.stop(), null, 'ended robot stream is rejected'); ended.destroy();
  assert.equal(localMicCalls, 0, 'remote recording never requests device microphone');
  assert.equal(originalStops, 0, 'Listen/WebRTC source tracks remain intact');
  console.log('PASS: robot stream recording, WAV output, no local microphone requests, clone-only cleanup, missing/silent/ended remote audio rejection. No hardware used.');
} finally {
  Date.now = realNow;
  for (const [name, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
}
