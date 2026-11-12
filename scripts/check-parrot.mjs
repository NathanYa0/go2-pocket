import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/ui/parrot.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { Parrot, latestParrotVoice } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
let now = 0, sequence = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
async function tick(ms) {
  const end = now + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]); now = next[1].at; next[1].fn(); await flush();
  }
  now = end; await flush();
}
const initial = { previous: 'seed', middle: 'fixed' };
function fixture(overrides = {}) {
  const events = [], saves = [], states = [];
  const files = [{ UNIQUE_ID: 'seed', CUSTOM_NAME: 'Starting voice' }, { UNIQUE_ID: 'fixed', CUSTOM_NAME: 'Your turn' }];
  let serial = 0, parrot;
  let soundPending = false;
  const recorder = { start: async () => { soundPending = true; events.push('record'); }, stop: async () => new ArrayBuffer(100), destroy: () => events.push('destroy'), takeSignificantSound: () => { const heard = soundPending; soundPending = false; return heard; } };
  const options = {
    available: () => true,
    now: () => now,
    recorder: () => recorder,
    state: label => states.push(label),
    save: settings => saves.push(settings),
    upload: async (wav, name, check) => { check(); events.push('upload'); files.push({ UNIQUE_ID: `new-${++serial}`, CUSTOM_NAME: name }); },
    request: async (api, payload) => {
      const data = JSON.parse(payload); events.push([api, data]);
      if (api === 1001) return { audio_list: files };
      if (api === 1010) return { play_mode: 'list_loop' };
      if (api === 1002 && !overrides.noTelemetry) {
        // State pushes may arrive before the play response.
        parrot.playbackState({ is_playing: true, current_audio_unique_id: data.unique_id });
        parrot.playbackState({ is_playing: false, current_audio_unique_id: data.unique_id });
      }
      return {};
    },
    ...overrides,
  };
  parrot = new Parrot(options);
  return { parrot, events, saves, states, options, files, recorder };
}
const plays = f => f.events.filter(e => Array.isArray(e) && e[0] === 1002).map(e => e[1].unique_id);
try {
  const f = fixture();
  let run = f.parrot.start(initial); await flush();
  assert.deepEqual(plays(f), ['seed', 'fixed']);
  assert.equal(f.saves.length, 0); assert.ok(f.states.includes('Recording Go2 microphone… 0s / 20s max'));
  await f.parrot.start(initial); assert.equal(plays(f).length, 2, 'double start cannot overlap');
  await tick(3000); await run;
  assert.equal(f.saves[0].previous, 'new-1'); assert.equal(f.saves[0].middle, 'fixed');
  assert.ok(!f.events.some(e => Array.isArray(e) && e[0] === 1009), 'user’s seed recording is retained');
  run = f.parrot.start(f.saves[0]); await flush(); await tick(3000); await run;
  assert.deepEqual(plays(f), ['seed', 'fixed', 'new-1', 'fixed']);
  assert.equal(f.saves[1].previous, 'new-2');
  assert.deepEqual(f.events.filter(e => Array.isArray(e) && e[0] === 1009).map(e => e[1].unique_id), ['new-1']);
  assert.equal(f.events.filter(e => Array.isArray(e) && e[0] === 1007).at(-1)[1].play_mode, 'list_loop');
  const cancelled = fixture(); run = cancelled.parrot.start(initial); await flush(); cancelled.parrot.cancel();
  await assert.rejects(run, /cancelled/); assert.equal(cancelled.saves.length, 0);
  assert.ok(!cancelled.events.includes('upload')); assert.ok(cancelled.events.includes('destroy'));
  const failed = fixture({ upload: async () => { throw Error('upload rejected'); } });
  run = failed.parrot.start(initial); const rejected = assert.rejects(run, /upload rejected/);
  await flush(); await tick(3000); await rejected; assert.equal(failed.saves.length, 0);
  const quiet = fixture({ noTelemetry: true }); run = quiet.parrot.start(initial);
  const timeout = assert.rejects(run, /confirm playback/); await flush(); await tick(120000); await timeout;
  assert.deepEqual(plays(quiet), ['seed']); assert.ok(!quiet.events.includes('record'));
  const denied = fixture({ recorder: () => ({ ...recorderStub(), start: async () => { throw Error('microphone denied'); } }) });
  await assert.rejects(denied.parrot.start(initial), /microphone denied/); assert.equal(denied.saves.length, 0);
  const first = fixture(); run = first.parrot.start({ ...initial, previous: '' }); await flush();
  assert.deepEqual(plays(first), ['fixed'], 'first turn needs no previous recording');
  await tick(3000); await run; assert.equal(first.saves[0].previous, 'new-1');
  const autoFiles = [
    { UNIQUE_ID: 'old', CUSTOM_NAME: 'Parrot 1700000000000-abc' },
    { UNIQUE_ID: 'latest', CUSTOM_NAME: 'Parrot 1700000001000-def.wav' },
    { UNIQUE_ID: 'unrelated', CUSTOM_NAME: 'My other recording' },
  ];
  assert.equal(latestParrotVoice(autoFiles, { ...initial, previous: 'old' }).id, 'latest', 'recover latest turn from robot, even on another client');
  assert.equal(latestParrotVoice(autoFiles, { ...initial, middle: 'latest' }).id, 'old', 'fixed clip cannot become previous response');
  assert.equal(latestParrotVoice([{ UNIQUE_ID: 'unrelated', CUSTOM_NAME: 'Other' }]), null);
  const pauses = fixture();
  let sound = true;
  pauses.recorder.takeSignificantSound = () => { const value = sound; sound = false; return value; };
  run = pauses.parrot.start(initial); await flush();
  await tick(2900); assert.equal(pauses.saves.length, 0, 'pause below 3 seconds must not stop');
  sound = true; await tick(100); // resumed sound resets the silence window
  await tick(2999); assert.equal(pauses.saves.length, 0, 'new sound restarts the full 3 seconds');
  await tick(1); await run; assert.equal(pauses.saves.length, 1);
  const continuous = fixture(); continuous.recorder.takeSignificantSound = () => true;
  run = continuous.parrot.start(initial); await flush();
  await tick(19999); assert.equal(continuous.saves.length, 0, 'continuous sound can continue up to the limit');
  await tick(1); await run; assert.equal(continuous.saves.length, 1, 'hard stop at 20 seconds even with continuous sound');
  const noSound = fixture(); noSound.recorder.takeSignificantSound = () => false;
  run = noSound.parrot.start(initial); const noSoundResult = assert.rejects(run, /No significant sound/);
  await flush(); await tick(3000); await noSoundResult;
  assert.equal(noSound.saves.length, 0, 'complete quiet keeps the old recording');
  assert.ok(!noSound.events.includes('upload'));
  assert.equal(timers.size, 0, 'no leftover timers');
  console.log('PASS: Parrot turn order, next-turn voice, fixed middle line, cleanup, cancellation, failure handling, 3-second silence stop/reset, 20-second cap and no-sound preservation. No robot used.');
} finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; }
function recorderStub() { return { start: async () => {}, stop: async () => null, destroy: () => {}, takeSignificantSound: () => false }; }
