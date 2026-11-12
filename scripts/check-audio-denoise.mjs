import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/ui/audio-denoise-worklet.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { DENOISE_WORKLET_CODE } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const rate = 16000;
function render(voice) {
  const output = [];
  let Processor;
  vm.runInNewContext(DENOISE_WORKLET_CODE, {
    sampleRate: rate,
    AudioWorkletProcessor: class { port = { postMessage: block => output.push(...block) }; },
    registerProcessor: (name, processor) => { assert.equal(name, 'denoise-recorder'); Processor = processor; },
  });
  const processor = new Processor();
  const input = new Float32Array(rate * 3);
  for (let i = 0; i < input.length; i++) {
    const t = i / rate;
    input[i] = 0.025 * Math.sin(2 * Math.PI * 2200 * t) + 0.01 * Math.sin(2 * Math.PI * 80 * t)
      + (voice && t > 0.7 ? 0.04 * Math.sin(2 * Math.PI * 450 * t) : 0);
  }
  for (let i = 0; i < input.length; i += 128) processor.process([[input.slice(i, i + 128)]]);
  assert.ok(output.length > rate * 2, 'streaming output continues after calibration');
  assert.ok(output.every(Number.isFinite), 'no invalid audio samples');
  return output.slice(-rate);
}
function amplitude(samples, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < samples.length; i++) {
    re += samples[i] * Math.cos(2 * Math.PI * hz * i / rate);
    im += samples[i] * Math.sin(2 * Math.PI * hz * i / rate);
  }
  return 2 * Math.hypot(re, im) / samples.length;
}
const noise = render(false), speech = render(true);
assert.ok(amplitude(noise, 2200) < 0.025 * 0.15, 'suppress learned steady whine by at least 85% in this synthetic test');
assert.ok(amplitude(noise, 80) < 0.001, 'reduce low-frequency motor hum');
assert.ok(amplitude(speech, 450) > 0.04 * 0.75, 'retain newly arriving speech-band sound');
assert.ok(amplitude(speech, 2200) < 0.025 * 0.2, 'whine stays suppressed while speech-band sound is present');
console.log('PASS: denoiser reduces synthetic steady whine/hum, preserves new speech-band sound, and streams finite audio. Real Go2 noise still needs listening validation.');
