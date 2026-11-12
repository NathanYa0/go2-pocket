/** Resolve a local robot without guessing addresses or resuming robot actions. */
export type LocalMethod = 'new' | 'old';
export interface FoundRobot { ip: string; sn: string }
export function fullRobotSerial(value: string): boolean { return /^[A-Za-z0-9]{16}$/.test(value); }
export function validRobotIp(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(n => Number(n) <= 255)
    && value !== '0.0.0.0' && value !== '255.255.255.255';
}
interface Options {
  ip: string; sn: string; signal?: AbortSignal;
  probe(ip: string): Promise<LocalMethod>;
  discover(sn?: string): Promise<FoundRobot[]>;
  status?(message: string): void;
}
function check(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Connection cancelled', 'AbortError'); }
export async function discoverLocalRobot(o: Options): Promise<FoundRobot & { method: LocalMethod }> {
  check(o.signal);
  if (o.ip && !validRobotIp(o.ip)) throw new Error('Enter a valid IPv4 address or leave it blank to find Go2 automatically.');
  if (o.ip) {
    o.status?.('Trying the last entered robot address...');
    try { const method = await o.probe(o.ip); check(o.signal); return { ip: o.ip, sn: o.sn, method }; }
    catch { check(o.signal); }
  }
  const serial = fullRobotSerial(o.sn) ? o.sn : undefined;
  const attempted = new Set<string>();
  // Two finite discovery rounds cope with a lost UDP reply / robot startup.
  for (let round = 0; round < 2; round++) {
    check(o.signal);
    o.status?.(serial ? 'Finding your robot by its saved serial number...' : 'Finding robots on this Wi-Fi...');
    const found = await o.discover(serial); check(o.signal);
    const unique = new Map<string, FoundRobot>();
    for (const r of found) {
      if (validRobotIp(r.ip) && fullRobotSerial(r.sn) && (!serial || r.sn === serial)) unique.set(`${r.sn}/${r.ip}`, r);
    }
    const robots = [...unique.values()];
    const identities = new Set(robots.map(r => r.sn));
    if (!serial && identities.size > 1) throw new Error('Several robots found. Use Find Go2 to select your dog, then Connect.');
    for (const r of robots) {
      if (attempted.has(r.ip)) continue;
      o.status?.(`Found your robot at ${r.ip}. Checking its connection service...`);
      try {
        const method = await o.probe(r.ip); check(o.signal);
        return { ...r, method };
      } catch { check(o.signal); }
    }
    // Retry a found-but-not-ready service once in the second round.
    attempted.clear();
  }
  throw new Error('Cannot reach your robot after automatic discovery. Check that it has joined this Wi-Fi and that the network allows devices to communicate. Bluetooth can help with Wi-Fi setup; manual IP entry is also available.');
}

/** Cache only after authenticated validation, keyed by stable identity. */
export function rememberRobotAddress(storage: Pick<Storage, 'getItem' | 'setItem'>, ip: string, sn: string): void {
  if (!validRobotIp(ip)) return;
  try {
    storage.setItem('unitree_last_ip_go2', ip);
    if (!fullRobotSerial(sn)) return;
    storage.setItem('unitree_last_sn_go2', sn);
    let addresses: Record<string, string> = {};
    try { const value = JSON.parse(storage.getItem('unitree_robot_addresses_v1') || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) addresses = value; } catch { /* repair corrupt cache */ }
    addresses[sn] = ip;
    storage.setItem('unitree_robot_addresses_v1', JSON.stringify(addresses));
  } catch { /* private mode/full storage must not break a connection */ }
}
