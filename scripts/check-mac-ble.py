"""Transport checks use a fake CoreBluetooth client; no radio or Wi-Fi changes."""
import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
import ble_server as ble

class FakeClient:
    uuids = [ble.OLD_WRITE_UUID, ble.OLD_NOTIFY_UUID]
    fail_notify = False
    def __init__(self, device, disconnected_callback, **kwargs):
        self.device = device
        self.callback = disconnected_callback
        self.is_connected = False
        self.writes = []
        self.services = [SimpleNamespace(characteristics=[SimpleNamespace(uuid=u, properties=['write']) for u in self.uuids])]
    async def connect(self): self.is_connected = True
    async def disconnect(self):
        self.is_connected = False
        self.callback(self)
    async def start_notify(self, uuid, callback):
        if self.fail_notify: raise RuntimeError('notifications unavailable')
        self.notify = callback
    async def write_gatt_char(self, uuid, packet, response): self.writes.append((uuid, packet, response))

class MacTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock = patch.object(ble, 'BleakClient', FakeClient)
        self.mock.start()
        FakeClient.uuids = [ble.OLD_WRITE_UUID, ble.OLD_NOTIFY_UUID]
        FakeClient.fail_notify = False
        self.device = object()
        ble._scanned_devices['mac-uuid'] = self.device
        self.session = ble.MacBLESession()
    async def asyncTearDown(self):
        await self.session.disconnect()
        self.mock.stop()
        ble._scanned_devices.clear()
    async def test_discovery_and_write(self):
        self.assertEqual(await self.session.connect('mac-uuid'), 'ffe0')
        self.assertIs(self.session._device.device, self.device)
        await self.session._write(b'test')
        self.assertEqual(self.session._device.writes, [(ble.OLD_WRITE_UUID, b'test', True)])
    async def test_nus(self):
        FakeClient.uuids = [ble.NUS_TX_UUID, ble.NUS_RX_UUID]
        self.assertEqual(await self.session.connect('mac-uuid'), 'nus')
    async def test_failure_cleans_up(self):
        FakeClient.fail_notify = True
        with self.assertRaises(RuntimeError): await self.session.connect('mac-uuid')
        self.assertFalse(self.session.connected)
        self.assertIsNone(self.session._device)
    async def test_disconnect_clears_authentication(self):
        await self.session.connect('mac-uuid')
        self.session.aes_key = bytes(range(16))
        self.session.v3_version = 3
        self.session.sn_result = 'old'
        await self.session.disconnect()
        self.assertIsNone(self.session.aes_key)
        self.assertIsNone(self.session.v3_version)
        self.assertIsNone(self.session.sn_result)
        with self.assertRaises(RuntimeError): await self.session._write(b'test')
    async def test_authenticated_reply_uses_async_transport(self):
        await self.session.connect('mac-uuid')
        key = bytes(range(16))
        self.session.aes_key = key
        frame = bytes([0x51, 12, 0x0b]) + (5).to_bytes(8, 'big') + b'\x00'
        self.session._reply_check3(frame)
        for _ in range(5): await asyncio.sleep(0)
        packet = self.session._device.writes[-1][1]
        plain = ble.decrypt_gcm_v3(packet, key)
        self.assertEqual(plain[2], 0x0c)
        self.assertEqual(int.from_bytes(plain[3:11], 'big'), 6)
    async def test_unknown_device_needs_scan(self):
        with self.assertRaises(ble.HTTPException): await self.session.connect('unknown')

unittest.main()
