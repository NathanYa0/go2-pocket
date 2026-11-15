# Bluetooth

Configure the robot's WiFi and pair the BLE remote control without the phone app. Open from the landing page → **Bluetooth** tile.

## Robot Provisioning

<p align="center">
  <img src="../images/bluetooth_robot.png" width="70%" />
</p>

Scan, connect, fetch SN + AP MAC, configure WiFi (SSID, password, STA / AP mode, region). Adapter selector for switching between multiple HCI adapters (handy with USB dongles).

Protocol versions:

- **V1 / V2** — used by legacy firmware (Go2 `< 1.1.15`, G1 `< 1.5.1`). Standard Nordic UART or FFE0 service. See [bluetooth-v1-v2.md](bluetooth-v1-v2.md) for the full GATT layout and command schema.
- **V3** — G1 `≥ 1.5.1` and Go2 `≥ 1.1.15`. Adds two new opcodes: `VERSION` (`0xF1`) and `GCM_KEY` (`0xF2`). The UI gates V3 probes on the scanned BLE name (`/^(G1|Go2)[_\W]/i`); older firmware silently drops the probe so it fails soft (a few-second timeout). See [bluetooth-v3.md](bluetooth-v3.md) for the magic-prefix handshake and key-exchange details.

## Remote Control

<p align="center">
  <img src="../images/bluetooth_remote.png" width="70%" />
</p>

Pair the Unitree BLE remote (`Unitree-*` advertising name) to read live joystick axes and button states, with an Hz counter showing the update rate.

Once paired, a gamepad icon appears in the control view's setting bar — click it to relay the remote's input to the robot over the WebRTC `rt/wirelesscontroller` channel:

<p align="center">
  <img src="../images/bt_relay_button.png" width="50%" />
</p>

Full protocol details and frame layout in [remote-control.md](remote-control.md).

## Desktop setup (macOS and Linux)

The installed iPhone/Android app uses native Bluetooth directly. The desktop
browser uses a local Python helper on `127.0.0.1:5051`, proxied by Vite through
`/ble-api/*`.

One-time installation, from the repository directory:

```bash
npm run ble:setup
```

Run the helper and web app in two terminal windows:

```bash
npm run ble-server
```

```bash
npm run dev
```

On macOS, allow Bluetooth access for the program hosting Python (Terminal,
iTerm, or the coding app) when prompted. If denied, enable it under macOS
**System Settings → Privacy & Security → Bluetooth**, then restart the helper.
Turn Bluetooth on before scanning. The Mac backend uses Bleak/CoreBluetooth;
Linux keeps its existing pygatt/gatttool transport. macOS uses device UUIDs
rather than Bluetooth MAC addresses and selects the system adapter automatically.

In Go2 Pocket, choose **Connect Go2 → Access Point (AP) → Set up Go2 hotspot**.
Click **Find Go2**, then **Connect**. On newer firmware, expand **Device key**
and paste the robot's existing 32-character AES key to unlock configuration.
No official app login is needed when you already have that key. Set the hotspot
SSID/password, check the network-change confirmation, and click **Enable
hotspot**. Join that Wi-Fi in the computer's network settings, then return to
AP mode in Go2 Pocket to connect over Wi-Fi.

Mac support here covers **robot provisioning**, not the separate handheld BLE
remote. That remote's desktop backend remains Linux-only. A successful scan
does not prove that authentication or a hotspot change succeeded; the UI reports
those results separately. Never infer hotspot success from an empty scan.

Transport tests (fake client, no radio or network changes):

```bash
.venv/ble/bin/python scripts/check-mac-ble.py
```
