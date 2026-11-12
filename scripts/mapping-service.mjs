import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One local process owner. Never exposes .env values or accepts arbitrary commands/paths. */
export function createMappingService({ root = process.cwd(), launch, leaseMs = 15000, stopMs = 40000 } = {}) {
  const runtime = join(root, 'output/mapping');
  const python = join(root, 'vendor/dimos/.venv/bin/python');
  let child = null, status = { state: 'idle', message: 'Ready to start a new map.' };
  let cloud = null, owner = '', lastSeen = 0, killTimer, closed = false;
  let motionEpoch = 0, lastSequence = -1, currentGesture = null;
  const endedGestures = new Set();
  function cancelManual() { motionEpoch++;if (currentGesture) endedGestures.add(currentGesture);currentGesture = null; }
  const installed = () => !!launch || existsSync(python);
  const send = (command, payload = {}) => { if (child?.stdin.writable) child.stdin.write(JSON.stringify({ ...payload, command }) + '\n'); };
  function stop(reason = 'Stopping movement and saving the map…') {
    if (!child || status.state === 'stopping') return;
    status = { ...status, state: 'stopping', message: reason };
    cancelManual();send('stop');
    const stopping = child;
    killTimer = setTimeout(() => {
      try { process.kill(-stopping.pid, 'SIGKILL'); } catch { stopping.kill('SIGKILL'); }
      status = { ...status, state: 'error', message: 'Mapper did not finish stopping. Use the robot remote. Map save unconfirmed.' };
    }, stopMs);
    killTimer.unref();
  }
  const watchdog = setInterval(() => {
    if (child && Date.now() - lastSeen > leaseMs) stop('App connection lost. Stopping and saving…');
  }, Math.min(1000, leaseMs));
  watchdog.unref();
  function start(client) {
    if (child) throw new Error('A mapping session is already running.');
    if (!installed()) throw new Error('Run npm run mapping:setup on the Mac first.');
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    status = { state: 'starting', message: 'Starting the mapping engine…', runId };
    cloud = null;motionEpoch++;endedGestures.clear();lastSequence = -1; owner = client; lastSeen = Date.now();
    child = launch ? launch(runId) : spawn(python, [join(root, 'integrations/dimos/bridge.py'), runId], {
      cwd: root, detached: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', ZENOH_DOMAIN: 'pocket-' + runId, ZENOH_SCOUTING: 'false', ZENOH_CONNECT: '', ROBOT_IP: '' },
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 64_000_000) { buffer = ''; stop('Invalid mapping output. Stopping…'); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const update = JSON.parse(line);
          if (update.cloud) cloud = update.cloud;
          else if (update.state) {
            // Do not let in-flight telemetry undo an operator stop.
            if (status.state === 'stopping' && !['stopped', 'error'].includes(update.state)) continue;
            status = { ...status, ...update };
          }
        } catch { /* Third-party stdout isn't a public log endpoint. */ }
      }
    });
    child.on('error', () => { status = { ...status, state: 'error', message: 'Could not launch mapping. Run npm run mapping:setup.' }; });
    child.on('close', () => {
      clearTimeout(killTimer); child = null; owner = '';
      if (!['stopped', 'error'].includes(status.state)) status = { ...status, state: 'error', message: 'Mapper exited. Movement stop and map save unconfirmed; check the robot.' };
    });
  }
  const json = (res, code, value) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/mapping-api/')) return next();
    // Loopback only: do not accidentally expose physical robot control with vite --host.
    const host = req.headers.host || '';
    const remote = req.socket.remoteAddress || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      return json(res, 403, { error: 'Mapping control is available only in the app on this Mac.' });
    }
    const path = url.pathname.slice('/mapping-api/'.length);
    if (req.method === 'GET' && path === 'status') {
      return json(res, 200, { ...status, running: !!child, installed: installed() });
    }
    if (req.method === 'GET' && path === 'cloud') return json(res, 200, cloud);
    if (req.method === 'GET' && path === 'maps') {
      const maps = existsSync(runtime) ? readdirSync(runtime).filter(n => !n.startsWith('replay-test-') && /^[\w-]+\.map\.db$/.test(n) && existsSync(join(runtime, n.replace('.map.db', '.meta.json')))).map(name => {
        const s = statSync(join(runtime, name));
        return { id: name.replace('.map.db', ''), bytes: s.size, modified: s.mtimeMs,
          preview: existsSync(join(runtime, name.replace('.map.db', '.json'))) };
      }).filter(m => m.bytes > 0 && !(child && m.id === status.runId)).sort((a,b) => b.modified-a.modified) : [];
      return json(res, 200, maps);
    }
    const match = /^(map|preview)\/([\w-]+)$/.exec(path);
    if (req.method === 'GET' && match) {
      const file = join(runtime, match[2] + (match[1] === 'map' ? '.map.db' : '.json'));
      if (!existsSync(file)) return json(res, 404, { error: 'Map not found.' });
      res.writeHead(200, { 'Content-Type': match[1] === 'map' ? 'application/octet-stream' : 'application/json',
        'Cache-Control': 'no-store', ...(match[1] === 'map' ? { 'Content-Disposition': `attachment; filename="${match[2]}.map.db"` } : {}) });
      const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'Unknown mapping endpoint.' });
    const client = req.headers['x-pocket-mapping'];
    if (typeof client !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(client)) return json(res, 403, { error: 'Missing app session.' });
    if (!['start', 'explore', 'pause', 'stop', 'heartbeat', 'manual', 'manual-stop', 'goal'].includes(path)) return json(res, 404, { error: 'Unknown mapping command.' });
    if (closed) return json(res, 503, { error: 'App server is closing.' });
    // Any local app tab may stop; only the session owner may start/resume motion.
    if (child && client !== owner && !['stop','manual-stop','pause'].includes(path)) return json(res, 409, { error: 'Another app tab owns mapping. Return to it, or stop this session.' });
    try {
      if (path === 'start') start(client);
      else if (path === 'stop') stop();
      else if (path === 'heartbeat') { if (child && client === owner) lastSeen = Date.now(); }
      else if (path === 'manual' || path === 'goal' || path === 'manual-stop') {
        const epoch = motionEpoch;
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) throw new Error('Mapping command is too large.');
        }
        const payload = JSON.parse(raw || '{}');
        if (!child || !['mapping','exploring','navigating','manual'].includes(status.state) || epoch !== motionEpoch) throw new Error('Mapping is not ready for movement.');
        if (payload.runId !== status.runId) throw new Error('This command belongs to a different map session.');
        if (path === 'manual-stop') {
          if (typeof payload.gesture === 'string') endedGestures.add(payload.gesture);
          cancelManual();send('manual-stop');
        } else if (path === 'manual') {
          if (typeof payload.gesture !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.gesture) || endedGestures.has(payload.gesture)) throw new Error('This drive gesture has ended.');
          if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= lastSequence) throw new Error('Stale drive request.');
          if (![payload.forward,payload.yawRate].every(v => typeof v === 'number' && Number.isFinite(v)) || Math.abs(payload.forward) > 0.4 || Math.abs(payload.yawRate) > 0.6) throw new Error('Invalid manual velocity.');
          currentGesture = payload.gesture;lastSequence = payload.sequence;
          send('manual', { forward:payload.forward, yawRate:payload.yawRate, validUntil:Date.now()+350 });
        } else {
          if (payload.frame !== 'world' || !cloud || cloud.frame !== 'world' || Date.now()-cloud.capturedAt > 5000) throw new Error('Use a fresh live map to place a flag.');
          if (![payload.x,payload.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v)<=100)) throw new Error('Invalid map coordinates.');
          cancelManual();send('goal', {x:payload.x,y:payload.y});
        }
      }
      else {
        if (!child || !['mapping', 'exploring', 'navigating', 'manual'].includes(status.state)) throw new Error('Wait for the mapping engine to be ready.');
        cancelManual();send(path);
      }
      return json(res, 200, { ...status, running: !!child, installed: installed() });
    } catch (error) { return json(res, 409, { error: error.message }); }
  }
  function close() { closed = true; clearInterval(watchdog); stop('App server closing. Stopping and saving…'); }
  return { middleware, close };
}
