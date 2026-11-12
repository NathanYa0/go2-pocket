# Go2 Pro: reproducible WebRTC data-access guide

Verified on the user's Go2 Pro over local Wi-Fi. Written 2026-11-06.
Observed robot firmware: **1.1.15**; LiDAR software: **1.0.0.38**.
See [findings and evidence](go2-pro-data.md) for the complete investigation,
and [the short PDF](../output/pdf/go2-pro-data-summary.pdf) for an overview.

## Scope and original objective

The intended project is to manually drive from anchor A while building a room
map, move elsewhere, localize against that map and return to A, with map reuse
across sessions. The Mac must run the client; the robot must not be jailbroken.
The following access uses the existing authenticated WebRTC app interface.
No firmware modification, SSH, password guessing or robot-side installation is
part of this procedure. Compatibility observed here is not an official promise
that every Go2 Pro firmware supports the same developer interface.

Confirmed: sensor telemetry, onboard mapping, onboard localization, map-file
download, and navigation service startup without a goal. Unverified: autonomous
return, generated routes, collision handling, recovery after physical displacement,
cross-session relocalization, and raw timed LiDAR access for Mac Point-LIO.

## 1. Run the existing read-only probe

From this repository on the Mac, with Chrome installed and dependencies present:

```sh
cd /path/to/go2-pocket
npm run dev
```

Keep that terminal running. In another terminal in the same directory:

```sh
node integrations/point-lio/inspect-webrtc.mjs
```

If dependencies are absent, run `npm install` first. The script imports
`chromium` from `playwright` and launches the installed Google Chrome via
`channel: 'chrome'`; it does not need a separately downloaded Chromium binary.
The dev URL must be `http://127.0.0.1:5186/`; check Vite did not select another port.

The Mac and powered-on robot must be reachable on the same local network.
The local `.env` must contain these names, with the actual values already used
by this project (do not publish them):

```dotenv
IP_ADDRESS=<robot Wi-Fi IP>
DOGID=<robot identifier used by this app>
UNITREE_AES_KEY=<per-device AES key>
```

The probe reads `.env` in Node, passes those three values into an isolated browser
page, seeds the existing app key cache, connects using `connectLocal(..., 'STA-L',
..., {sn})`, waits for data-channel validation, subscribes and observes telemetry.
It sends the normal session request to disable traffic saving so LiDAR data can
flow. It also queries service status/map ID and requests the cloud-map topic.
It does **not** start mapping, localization or navigation in default mode.

Output: `output/point-lio/inspection/sensor-report.json`, created with mode 0600.
It contains `observedAt`, requested `topics`, `counts`, arrival `timing`, first
`samples`, `lastSamples`, server logs and optional activation/backup details.
The report is overwritten after a successful run. Copy it to a named file to
retain evidence. Binary arrays are summarized as `{binaryBytes: N}`; **the
default report does not contain the actual cloud bytes** or a full time series.
The older `rpc` field remains in the schema but the current probe sends no
bashrunner requests.

Useful offline inspection:

```sh
python3 - <<'PY'
import json
r = json.load(open('output/point-lio/inspection/sensor-report.json'))
for topic, count in r['counts'].items():
    print(topic, count)
print(r['samples'].get('rt/lf/sportmodestate', {}).get('imu_state'))
print('\n'.join(r['serverLogs']))
PY
```

If validation times out, no service activation has occurred. Confirm network,
IP, power, credentials and other active clients before retrying; do not assume
the missing telemetry is unsupported. An early-message queue in the probe keeps
validation messages received before the handler is constructed. A successful
connection still needs the normal heartbeat, managed by `DataChannelHandler`.

## 2. Exact subscriptions and fields

Subscribe only after validation. A subscribe envelope is:

```json
{"type":"subscribe","topic":"rt/lf/sportmodestate"}
```

In the existing app classes, use `dc.subscribe(topic)` and process
`dc.onTopicData = msg => { /* msg.topic and msg.data */ }`.
`dc` is a `DataChannelHandler`; see the complete working setup in
[`inspect-webrtc.mjs`](../integrations/point-lio/inspect-webrtc.mjs).
Do not create a second handler or replace the application's callback without
forwarding messages to the existing consumer.

| Need | Subscribe to | Read from `msg.data` | Verified condition |
| --- | --- | --- | --- |
| Body gyro/acceleration | `rt/lf/sportmodestate` | `imu_state.gyroscope[3]`, `accelerometer[3]` | About 20 Hz idle delivery |
| Attitude | same | `imu_state.rpy[3]`, `quaternion[4]`, `temperature` | Body attitude, not a surveyed heading |
| Movement | same | `position[3]`, `velocity[3]`, `yaw_speed`, `body_height`, `mode`, `gait_type`, `stamp` | Fields received; dynamic accuracy not tested |
| LiDAR-associated pose | `rt/utlidar/robot_pose` | `header.stamp`, `header.frame_id`, `pose.position.{x,y,z}`, `pose.orientation.{x,y,z,w}` | About 19 Hz in `odom` |
| Nearby 3D geometry | `rt/utlidar/voxel_map_compressed` | `resolution`, `origin`, `width`, `frame_id`, binary `data` | About 8 Hz, 0.05 m cells |
| LiDAR diagnostics | `rt/utlidar/lidar_state` | `cloud_frequency`, `cloud_size`, `cloud_scan_num`, `imu_frequency`, `imu_rpy`, `error_state`, `dirty_percentage` | About 5 Hz |
| Joint angles and power | `rt/lf/lowstate` | `motor_state[].q`, temperature, `foot_force`, `bms_state`, `power_v`, `imu_state.rpy` | About 20 Hz; this IMU payload lacked gyro/acceleration |
| Device settings | `rt/multiplestate` | JSON-decode its string: `obstaclesAvoidSwitch`, `uwbSwitch`, brightness, volume | About 1 Hz; switch states are not sensor measurements |
| Mapping pose | `rt/uslam/frontend/odom` | `header`, `child_frame_id`, `pose.pose`, `twist.twist`, covariance arrays | Confirmed with mapping active |
| Mapping cloud | `rt/uslam/frontend/cloud_world_ds` | `xmin/xmax`, `ymin/ymax`, `zmin/zmax`, binary `data` | Confirmed with mapping active |
| Localized pose | `rt/uslam/localization/odom` | `header`, `child_frame_id`, `pose.pose` | Confirmed after localization initialization |
| Localized cloud | `rt/uslam/localization/cloud_world` | `width`, `height`, `fields`, `point_step`, `row_step`, `is_bigendian`, binary `data` | Confirmed with localization active |
| Navigation path | `rt/uslam/navigation/global_path` | No live payload verified | No goal was sent; service startup alone did not produce a path |
| Service events | `rt/uslam/server_log` | String success/failure, status and initialization events | Confirmed |

All rates are observed delivery rates in short tests, not guaranteed hardware
sample rates. Sport-state quaternions are unnamed arrays; do not assume array
ordering from the named XYZW fields of `robot_pose` without verifying it.
Timestamp construction for structured stamps is `sec + nanosec * 1e-9`.
Use robot timestamps for analysis and retain a host receive timestamp for latency
checks; do not claim the robot and Mac clocks are synchronized.

Position is a local estimate. `odom` is the received frame name; it is not a
GPS coordinate or a permanent room origin. Mapping startup can establish a new
reference. Do not mix stored anchors, live odometry and Point-LIO sessions without
checking frame transforms and map/session IDs.

## 3. Decode LiDAR data correctly

The WebRTC wrapper may send text JSON or binary-framed JSON plus a byte payload.
The app handles both in [`webrtc.ts`](../src/connection/webrtc.ts):

- Type-2 frame: little-endian uint16 values `2,0`, uint32 JSON length at byte 4,
  four padding bytes, JSON starting at byte 12, then binary bytes.
- Normal binary frame: uint16 JSON length, uint16 reserved, JSON at byte 4,
  followed by optional binary bytes.
- The parser attaches the remaining bytes as an `ArrayBuffer` at `msg.data.data`.

Do not treat that byte array as an ordinary JSON list of XYZ points.

**Voxel stream:** pass the packet to
[`VoxelMap.processCompressed`](../src/ui/scene/voxel-map.ts), which uses
[`voxel-worker.ts`](../src/workers/voxel-worker.ts) and `/libvoxel.wasm`.
It returns voxel surface geometry; render with scale `resolution` and translation
`origin`. The observed `[128,128,38]` grid at 0.05 m spans
6.4 x 6.4 x 1.9 m; this is a packet grid envelope, not the sensor's maximum range.

**Mapping cloud:** pass the bounds and binary bytes to
[`slam-worker.ts`](../src/workers/slam-worker.ts) with
`{type: 'newMap', data: msg.data}`. The existing worker uses `/libslam.wasm`,
6 bytes per encoded point, and maintains an accumulated point cloud.
This is processed geometry in the reported frame, not a timed raw scan.

**Localization cloud:** the sample was a PointCloud2-style message with 1,970
points, `height: 1`, `point_step: 32`, `row_step: 63040`, and little-endian float32
fields `x@0`, `y@4`, `z@8`, `intensity@16`. Read field names/offsets on every
schema; do not hardcode a 12-byte point stride. A decoder for the observed format:

```js
function decodeXYZI(cloud) {
  if (!(cloud.data instanceof ArrayBuffer)) throw Error('Missing cloud bytes');
  const fields = new Map(cloud.fields.map(f => [f.name, f]));
  for (const name of ['x', 'y', 'z', 'intensity']) {
    const f = fields.get(name);
    if (!f || f.datatype !== 7 || f.count !== 1 || f.offset < 0 ||
        f.offset + 4 > cloud.point_step) throw Error('Unsupported field schema');
  }
  if (cloud.row_step < cloud.width * cloud.point_step ||
      cloud.data.byteLength < cloud.height * cloud.row_step) {
    throw Error('Truncated cloud');
  }
  const view = new DataView(cloud.data);
  const points = [];
  for (let row = 0; row < cloud.height; row++) {
    for (let col = 0; col < cloud.width; col++) {
      const base = row * cloud.row_step + col * cloud.point_step;
      const p = ['x', 'y', 'z', 'intensity'].map(name =>
        view.getFloat32(base + fields.get(name).offset, !cloud.is_bigendian));
      if (p.every(Number.isFinite)) points.push(p);
    }
  }
  return points;
}
```

For recording, save each live binary buffer plus its JSON metadata and robot/host
timestamps before the probe's `snapshot()` conversion. The current report only
preserves schemas and byte counts. None of the confirmed cloud schemas contained
a per-point `time` field. Adding timestamps to voxel centers cannot recover the
original point acquisition times.

## 4. Start mapping/localization/navigation using app commands

**This section changes robot state. Mapping overwrites its one map slot; service
startup can cause the robot to stand up.** It is not required for an idle probe.
The previous test backed up the original map, created a short test map, localized
against it, tested navigation startup and stopped all services. No navigation
destination was sent. The robot's current slot contains the short test map; the
original was not restored.

Commands use topic `rt/uslam/client_command`, type `msg`, with a string `data`:

```json
{"type":"msg","topic":"rt/uslam/client_command","data":"mapping/get_status"}
```

Equivalent app call: `dc.publish('rt/uslam/client_command', 'mapping/get_status')`.
Subscribe to `rt/uslam/server_log` before commands; inspect acknowledgments and
subsequent status. A `success` acknowledgment alone is not proof of usable data.

| Stage | Exact command | Required evidence / effect |
| --- | --- | --- |
| Inspect | `mapping/get_status`, `localization/get_status`, `navigation/get_status` | `.../status/0` inactive, `.../status/1` active |
| Map identity | `common/get_map_id` | `common/get_map_id/map_id/<id>` |
| Build map | `mapping/start` | Start success, status 1 and frontend cloud/odom; can stand up |
| Save short/current map | `mapping/stop` | Stop success and status 0; map files updated |
| Localize | `localization/start` | Initialization succeed event, status 1 and localized pose/cloud |
| Help initialization | `localization/set_initial_pose/<x>/<y>/<yaw>` | Existing app command; not used in this successful test. Requires a known pose in the selected map, yaw in radians |
| Start planner | `navigation/start` | Start success, status 1, `WAITING`; can stand up |
| Stop planner | `navigation/stop` | Stop success and status 0 |
| Stop localization | `localization/stop` | Stop success and status 0 |

Never infer localization from `localization/start/success` alone. Wait for
`[Localization] initialization succeed!`; failure requires correcting the map or
initial pose. Do not invent coordinates from a different odometry session.
`navigation/set_goal_pose/<x>/<y>/<yaw>` is the app's movement-producing command;
it was **not** tested here and is not part of the diagnostic procedure.

Reproduce the bounded activation test only after backing up the map:

```sh
node integrations/point-lio/inspect-webrtc.mjs --backup
# Use the new directory printed by that command:
node integrations/point-lio/inspect-webrtc.mjs --activate <backup-directory>
```

The activation branch verifies initial idle statuses, starts mapping for a short
interval, stops/saves it, tries localization and starts navigation only if
initialization succeeds. It then sends stop commands and queries final statuses.
This is a diagnostic script, not a production navigation controller or a
guaranteed stop mechanism if the process/network fails. It does not drive a goal.
Reports can be overwritten: preserve the original backup and activation evidence.

## 5. Retrieve and preserve an existing map

Use `--backup` above. It requests `map.pcd`, `map.pgm`, `map.txt` sequentially via
`DataChannelHandler.requestFile()`. The exact WebRTC request envelope is:

```json
{
  "type": "rtc_inner_req",
  "topic": "",
  "data": {
    "req_type": "request_static_file",
    "req_uuid": "<unique-per-request>",
    "related_bussiness": "uslam_final_pcd",
    "file_md5": "null",
    "file_path": "map.pcd"
  }
}
```

The protocol spells `related_bussiness` that way. Responses use the matching UUID
in `info`, with base64 data in `info.file.data`; the app helper joins chunks and
uses `chunk_index`/`total_chunk_num` to detect completion. The callback returns
the joined base64 string or null after a timeout. Decode the base64 to bytes;
do not save the base64 text as a PCD. Requests must be sequential because the
current helper temporarily wraps a single response callback.

The successful original backup is in
`output/point-lio/inspection/map-backup-1793992090356/`:
PCD 32,877 bytes / 789 ASCII XYZ-intensity points; PGM 75,004 bytes;
metadata TXT 24 bytes. Its metadata describes a 142 x 132 grid, resolution 0.1,
origin `-7.1 -7.1`, final line `0`. Do not assume this small old map covered the room.

`mapping/get_cloud_map` returned success without a `rt/uslam/cloud_map` packet
in our idle window. **File download did work** through `request_static_file`;
these are separate retrieval routes. The app already supports bundle storage in
IndexedDB and upload with `pushFile`, documented in [slam.md](slam.md#map-storage).
Restore/upload was not exercised in these probes.

## 6. Limits, evidence and next work

- No messages on raw candidates `rt/utlidar/cloud`, `cloud_deskewed`, `imu`,
  `transformed_imu`, `transformed_raw_imu` (all under `rt/utlidar/`) during the
  probes. `rt/lowstate` and `rt/sportmodestate` were also silent; use the verified
  `rt/lf/*` topics instead. No tested raw candidate became active in the service test.
- `rt/mapping/grid_map`, `rt/lio_sam_ros2/mapping/odometry`, `rt/pctoimage_local`,
  `rt/qt_notice`, `rt/uwbstate`, `rt/servicestate`, `rt/selftest` and uncompressed
  `rt/utlidar/voxel_map` did not produce verified samples. Absence in a short test
  is not a universal firmware capability statement.
- Sport-state obstacle ranges, foot force and foot kinematics were zero in the
  sample. Low-state foot forces were nonzero. Do not treat zero placeholders as
  valid measurements. `error_code: 100` was observed without a verified decoding.
- Raw body IMU units, axis conventions, filtering, timestamps and sensor-to-LiDAR
  calibration need validation before inertial fusion. A reported internal IMU
  frequency near 246 Hz is not the 20 Hz WebRTC delivery frequency.
- The native Mac Point-LIO replay works on the official sample: 294 finite poses
  over 29.62 seconds and a 490,306-point map. Live Point-LIO remains blocked on
  suitable raw timed clouds and calibrated synchronized IMU; body sport-state
  data must not be substituted without validation.
- Onboard mapping/localization now provide a practical alternate implementation
  path for anchor A. It must be labeled as onboard USLAM, not Mac Point-LIO.
  Next tests must establish map coverage, map reload, frame consistency, pose
  freshness, obstacles, route generation and bounded stop behavior before return-to-A.

Private evidence paths: `output/point-lio/inspection/activation-report.json`,
`pre-activation-sensor-report.json`, and the map backup above. Reports contain
sample schemas/counts rather than a complete sensor log. No credentials belong
in checked-in documentation or the PDF.

Implementation references: [connector](../src/connection/local-connector.ts),
[validation](../src/protocol/validation.ts),
[data handler and file transfer](../src/protocol/data-channel.ts),
[topic constants](../src/protocol/topics.ts),
[mapping UI](../src/ui/components/mapping-page.ts),
[native Point-LIO](../integrations/point-lio/native/README.md).
External primary-code references and research links are collected in
[go2-pro-data.md](go2-pro-data.md#sources-and-scope).
