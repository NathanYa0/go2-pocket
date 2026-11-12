import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

/** Import a USB-provisioned setup file once, without bundling credentials. */
export async function importDeviceSetup(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const file = { path: 'go2-setup.json', directory: Directory.Data };
  try { await Filesystem.stat(file); } catch { return; }
  try {
    const result = await Filesystem.readFile({ ...file, encoding: Encoding.UTF8 });
    const setup = JSON.parse(String(result.data));
    if (typeof setup.sn !== 'string' || !setup.sn.trim()
      || typeof setup.ip !== 'string' || !/^(\d{1,3}\.){3}\d{1,3}$/.test(setup.ip)
      || setup.ip.split('.').some((part: string) => Number(part) > 255)
      || typeof setup.key !== 'string' || !/^[a-fA-F0-9]{32}$/.test(setup.key)) {
      throw new Error('Invalid device setup');
    }
    const keys = JSON.parse(localStorage.getItem('unitree_aes_keys_v1') || '{}');
    keys[setup.sn.trim()] = setup.key;
    localStorage.setItem('unitree_aes_keys_v1', JSON.stringify(keys));
    localStorage.setItem('unitree_last_sn_go2', setup.sn.trim());
    localStorage.setItem('unitree_last_ip_go2', setup.ip);
  } catch {
    console.warn('Device setup could not be imported. Configure the robot in the app.');
  } finally {
    await Filesystem.deleteFile(file);
  }
}
