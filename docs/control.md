# Control View

The control view is the live operating screen — joystick + actions + camera + 3D scene.

<p align="center">
  <img src="../images/webview_go2.png" width="48%" />
  <img src="../images/webview_g1.png" width="48%" />
</p>

## Layout

- **3D viewport** — Go2 / G1 model with live joint angles, lidar spinning animation, and SLAM voxel overlay (Go2).
- **Camera feed (PIP)** — draggable picture-in-picture; click to swap with the 3D scene.
- **Dual joysticks** — left moves, right rotates.
- **Action bar** — carousel of robot actions and modes. Customizable order.
- **Setting bar (top-right)** — Radar, LiDAR, Volume, Light. With a BLE remote connected, a gamepad icon also appears here for relay (see [bluetooth.md](bluetooth.md)).
- **Theme toggle** — floating sun/moon in the upper-right; preference is persisted.

## Actions and Modes

Actions and modes are issued as MCF sport API IDs. Tested against Go2 firmware v1.1.11; G1 uses an overlapping subset.

| Action | ID | Mode | ID |
|--------|----|------|----|
| Roll Over | 1021 | Free Walk | 2045 |
| Stretch | 1017 | Pose | 1028 |
| Shake Hand | 1016 | Run | 1011 |
| Heart | 1036 | Walk Stair | 1049 |
| Pounce | 1032 | Static Walk | 1061 |
| Jump Forward | 1031 | Endurance | 1035 |
| Greet | 1029 | Leash | 2056 |
| Dance 1 | 1022 | Hand Stand | 2044 |
| Dance 2 | 1023 | Free Avoid | 2048 |
| Front Flip | 1030 | Bound | 2046 |
| Back Flip | 2043 | Jump | 2047 |
| Left Flip | 2041 | Stand | 1006 |
| Damping | 1001 | Cross Step | 2051 |
| Sit Down | 1009 | Rear Stand | 2050 |
| Crouch | 1005 | Rage Mode | 2059 |
| Lock On | 1004 | | |

## Communication panel

In **Drive → Communication** (also **Actions → Communication**), there are five
fixed recording slots: **Hi**, **Nice to meet you**, **Explain instructions**,
**Voice line 1**, and **Voice line 2**. They start empty. Press the matching **Record** button, speak,
then press the same button (**Stop & save**) to finish. **Re-record** replaces
that slot; **Play** leaves it unchanged. Each slot is independent of Parrot.

Capture uses Go2's incoming WebRTC microphone, with the same noise reduction
and 5× gain as Parrot. The phone/computer microphone is never requested. Pause
briefly before speaking while the noise filter initializes. Recording does not
stop on silence; it ends on the second press or saves automatically at 55 seconds.
Closing the panel, hiding the app, disconnecting, or emergency stop cancels an
unfinished recording. It also stops panel audio and restores the previous repeat
setting when the connection is available. Closing does not issue a posture command.

Clips are saved in Go2's audio library, using versioned names
`Comm <slot> <timestamp>-<suffix>`. Opening on another client recovers the latest
version from the robot. The replacement is uploaded and its ID confirmed before
old versions of that slot are removed. Unrelated recordings are never deleted.
One free library slot is needed for safe replacement; if the 10-clip library is
full, remove an unused clip through **More → Sound & voice** first. Renaming a
Communication clip outside this panel removes its slot association.

**Play + offer paw** plays the saved Nice to meet you line once and requests the
existing `Hello` / Shake Hand action (sport API 1016). **Lower paw**, pinned directly below the panel title, requests
`BalanceStand` (1002) independently of playback. These IDs and parameter-free
calls follow [Unitree's SportClient](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/go2/sport/sport_client.py).
There is no documented hold-paw parameter: the robot controls the gesture's
animation. The user’s live test confirmed that the standard greeting lowers the
paw automatically. Holding it until Lower paw is pressed is not implemented.
Paw-down interruption and timing
still need a supervised test on this Go2. The separate API 1029 guard is unchanged.
A sent request is not confirmation that the physical gesture completed.

Paw-hold investigation (2026-11-12): the app sends a single `Hello` request;
there is no automatic lower-paw timer in Communication. The official
[C++ SportClient interface](https://github.com/unitreerobotics/unitree_sdk2/blob/main/include/unitree/robot/go2/sport/sport_client.hpp)
also declares only `Hello()` with no hold/duration argument. `Pose(bool)` is a
separate command, not a documented way to freeze a greeting. Unitree provides a
[low-level joint-control example](https://github.com/unitreerobotics/unitree_sdk2/blob/main/example/go2/go2_low_level.cpp)
using DDS `rt/lowcmd`, but this is not a verified control interface for our stock
Pro WebRTC connection. A reliable held-paw implementation remains blocked on a
supported pose-hold or joint-control interface for this robot. No repeated
Hello loop, guessed freeze command, or low-level motor command was sent.

Validation: `npm run check:communication`, `node scripts/check-communication-ui.mjs`
(with the dev server running), and `npm run build`. The tests use an in-memory
robot library and fake audio capture; they do not move a real robot.

## Parrot voice exchange

In Drive, open **Actions → Parrot**. Save or upload the fixed middle line
through **More → Sound & voice**, then select it once in Parrot. Recording
stops after 3 seconds without significant sound, or at 20 seconds maximum.
Each significant sound resets the quiet window; low-level background noise
below 0.005 RMS (-46 dBFS, measured before gain) does not. The previous response is loaded
automatically from the latest Parrot recording on Go2; there is no first-voice
picker. On the first run, the previous-voice step is skipped.

**Start Parrot** plays the previous voice through Go2, waits for playback to
finish, plays the fixed middle line, then records **Go2’s incoming WebRTC
microphone stream** with a visible elapsed-time indicator. It never requests the phone or
computer microphone. Parrot learns background noise during the first 0.4 seconds
and applies speech-band spectral noise suppression before both quiet detection
and the 5× boost. Pause briefly before speaking; speaking during calibration can
reduce voice clarity. This targets steady motor/LiDAR whine and hum, but does not
guarantee removal of changing noise or noise overlapping speech. Existing clips
and the Listen feature are unaffected. New Parrot recordings apply 5× gain, with peaks
clamped to the WAV sample range. Existing recordings are not modified.
The new recording is saved to Go2 and becomes the first
line on the next run. The fixed line stays the same. The middle-line selection
is remembered per robot on this phone/browser. A different client
can recover the latest response from Go2’s recording library, but must select
its fixed line independently. Missing, ended or silent robot audio keeps the
previous recording instead of saving an empty replacement. A recording with
no significant sound also keeps the previous voice.

Cancel, leaving Drive, app suspension or disconnect prevents an unfinished
recording from replacing the previous voice. Playback and upload errors are
shown in the panel. Go2 must report both playback start and completion before
the sequence advances. Parrot temporarily disables audio repeat and restores
the prior repeat mode afterward. It sends no movement commands.

Only superseded recordings created by Parrot are deleted after a successful
save. The fixed middle line and any manually selected legacy starting clip are retained. If the
robot library is full, remove an unused clip in Sound & voice before starting.

## BLE Remote Relay

When a Unitree BLE remote is paired (see [bluetooth.md](bluetooth.md)), a gamepad icon appears in the setting bar.

<p align="center">
  <img src="../images/bt_relay_button.png" width="60%" />
</p>

Click it to forward the remote's joystick axes and button states to the robot over `rt/wirelesscontroller`. The on-screen virtual joysticks hide while relay is active. Hz counter on the BT page shows the live update rate.

Protocol details: [remote-control.md](remote-control.md).

## Automatic local discovery (2026-11-08)

In Local Wi-Fi mode, Connect accepts a blank IP. It tries a supplied/cached IPv4
address first; if unreachable, it performs up to two discovery rounds. A saved
full 16-character serial targets the robot; a display name such as `Go2_6480`
is not a valid discovery serial. With no full serial, a broad scan may select
one unique robot, but multiple identities require explicit selection with Find
Go2. Discovery results are validated before connecting. AP and Remote modes keep
their existing connection paths. Authentication errors are reported directly,
not retried as address discovery.

Only authenticated validation updates the successful local address and stable
identity cache. Addresses are additionally indexed by serial. Leaving the
connection screen cancels pending discovery/connection work. The connection UI
prevents concurrent Connect/Find requests, and desktop UDP discovery sessions
are serialized because they share a reply port. Reconnection never restores
joystick input or autonomous mapping motion.

Bluetooth remains a setup/identity aid; no automatic Bluetooth provisioning or
Wi-Fi credential changes were added. Multicast filtering, guest isolation,
missing network membership and robot-service outages can still prevent local
connection. Use the existing Bluetooth & Wi-Fi page or manual address fallback
when needed. Tests: `npm run check:discovery` and
`node scripts/check-auto-discovery-ui.mjs` (dev server required for the latter).

## Manual drive speed slider

Open Drive, press the settings icon, then use Controls > Driving > Drive speed.
The 10%-100% slider scales manual joystick axes from the touchscreen, a gamepad,
or a Bluetooth remote relayed through the app. 100% preserves the existing full
joystick response; it is not a measured metres-per-second limit. The percentage
is stored locally and restored after reopening/reconnecting. Button actions,
tricks, robot-native modes and autonomous mapping limits are not changed. The
app does not increase commands beyond the pre-existing joystick range. Direct
physical-remote commands that bypass the app are outside this setting.

Verification: `npm run check:speed` with the Vite dev server running. The test
uses mocked transport and validates slider persistence, scaled touch/gamepad/BT
wire output, button preservation, zero release and malformed input bounds.
