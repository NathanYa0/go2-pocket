# Go2 Pro data access over WebRTC

For exact setup, wire messages, field paths, decoding and service sequencing,
see [the reproducible access guide](go2-pro-data-access.md).
For a short overview, see [the PDF summary](../output/pdf/go2-pro-data-summary.pdf).

Research date: 2026-11-06. Robot: Go2 Pro, observed firmware 1.1.15,
LiDAR software 1.0.0.38. Our connection is authenticated WebRTC over local Wi-Fi.
No Ethernet, SSH, or SDK2 connection is required for the existing app connection.
Credentials stay in `.env`; do not copy them into reports.

## Main finding: gyroscope and acceleration confirmed over WebRTC

The previous inspection received only `imu_state.rpy` (roll, pitch, yaw) from
`rt/lf/lowstate`. It did not subscribe to sport-state topics. Therefore that
inspection does **not** establish that gyroscope or acceleration data is
unavailable over WebRTC.

The WebRTC driver's own [sport-state example][sport] subscribes to
`rt/lf/sportmodestate` and reads `imu_state.gyroscope`,
`imu_state.accelerometer`, `quaternion`, `rpy`, and `temperature`.
Its [low-state example][low] reads only RPY, matching our observed low-state
payload. These are different topics and may expose different IMU fields.

A subsequent read-only retry succeeded on this robot. It received **200 messages
in approximately ten seconds** on `rt/lf/sportmodestate` (about 20 Hz delivery).
Each sampled payload includes a `stamp` with seconds/nanoseconds and
`imu_state.gyroscope`, `accelerometer`, `quaternion`, `rpy`, and `temperature`.
Example measured vectors:

```json
{
  "gyroscope": [0.010653, 0.002131, 0.006392],
  "accelerometer": [-0.107739, -0.177171, 9.330204]
}
```

These are actual received values, not simulated values. Units, axis conventions,
measurement filtering and clock synchronization have not been independently
validated. Delivery frequency is not necessarily the internal IMU sample rate.
The app already subscribes to this topic in `src/ui/app.ts`.
No messages arrived on `rt/sportmodestate` during the same window.

An earlier retry timed out during validation; the later successful retry resolves
the question of whether gyro/acceleration fields can be received. That read-only run sent no motion commands. The later activation evidence is
stored separately in `activation-report.json` and includes internal stand-up events.

## Data inventory

| Data | WebRTC source | Evidence and limits |
| --- | --- | --- |
| 3D surroundings | `rt/utlidar/voxel_map_compressed` | Received locally: compressed occupancy geometry, 0.05 m resolution, `odom` frame. Useful for visualization; not a raw timed LiDAR scan. |
| Robot position and orientation | `rt/utlidar/robot_pose` | Received locally: timestamp, XYZ position, XYZW quaternion in `odom`. An onboard estimate; drift and reset behavior require testing. |
| Body attitude | `rt/lf/lowstate` → `imu_state.rpy` | Received locally. Attitude angles are not angular velocity or acceleration. |
| Gyroscope and acceleration | `rt/lf/sportmodestate` → `imu_state` | Confirmed locally: three-axis gyro and acceleration, plus message timestamp; about 20 Hz delivery in the successful retry. Calibration/units remain to be validated. |
| Joint telemetry | `rt/lf/lowstate` → `motor_state` | Received joint angle `q`, temperature, `lost`, reserve fields. Full SDK schemas must not be assumed to match this compact payload. |
| Battery and power | `rt/lf/lowstate` | Received charge percentage, current, cycle count, battery temperatures and `power_v`. |
| Foot-force estimates | `rt/lf/lowstate` → `foot_force` | Four values received; interpretation/calibration not independently verified. |
| Motion status | `rt/lf/sportmodestate` | Received mode, gait, position, velocity, yaw speed, body height, foot positions/speeds and obstacle ranges. Several fields were zero in this sample; field presence does not establish valid measurements. |
| LiDAR health | `rt/utlidar/lidar_state` | Received error state, dirty percentage, scan statistics, IMU frequency statistic and IMU RPY. A frequency statistic is not a stream of IMU measurements. |
| Camera and microphone | WebRTC media tracks | Already used by this app. The driver documents Go2 video receive and audio send/receive. Media is separate from sensor pub/sub messages. |
| Saved audio and playback status | AudioHub RPC / `rt/audiohub/player/state` | Used by the app's audio/Parrot workflow. Not a raw IMU or LiDAR interface. |
| Mapping/localization/navigation | `rt/uslam/*` | Status queries responded locally. Topic constants include map cloud, odometry and navigation paths. Mapping and localization activated successfully in the later bounded test; navigation reached WAITING without a goal. Persistent relocalization remains untested. |
| UWB, controller, service/self-test data | Topics listed in driver constants | Candidate interfaces only; no proof of live payloads or fitted hardware on this unit. Topic names do not guarantee access. |

## What our earlier live inspection actually established

The approximately ten-second high-bandwidth inspection received 188 robot-pose,
200 low-state, 78 compressed voxel and 50 LiDAR-status messages. These are observed
counts for one session, not guaranteed sensor rates.

The voxel packet included resolution 0.05, frame `odom`, origin, grid dimensions
and compressed binary data. It did not expose per-point acquisition times or
intensity. LiDAR status reported roughly 246 Hz IMU processing, but no corresponding
raw IMU messages were received on the tested LiDAR topics.

No messages arrived on `rt/utlidar/cloud`, `rt/utlidar/cloud_deskewed`,
`rt/utlidar/imu`, `rt/utlidar/transformed_imu`,
`rt/utlidar/transformed_raw_imu` or `rt/lowstate` in that window.
That is a negative observation under tested conditions, not proof these topics
can never be exposed.

Separate earlier probes found SSH port 22 refused and no DDS publications during
a short Wi-Fi/domain-0 discovery. Neither finding prevents our working WebRTC
connection or establishes the behavior of other interfaces/configurations.

Reproduce the read-only inspection with the dev server on port 5186:

```sh
node integrations/point-lio/inspect-webrtc.mjs
```

It uses local `.env` credentials, subscribes to telemetry, disables WebRTC traffic
saving for the session, queries mapping status information and closes the
connection. It sends no motion commands. Its private report is
`output/point-lio/inspection/sensor-report.json` (overwritten on each success).

## Implications for mapping and Point-LIO

### Expanded read-only probe: position, motion and mapping

A broader WebRTC subscription probe on the research date confirmed:

| Stream | Observed delivery | Useful fields |
| --- | --- | --- |
| `rt/utlidar/robot_pose` | ~18.8 Hz | Timestamp, `odom` frame, XYZ position, orientation quaternion |
| `rt/lf/sportmodestate` | ~20 Hz | XYZ position, XYZ velocity, yaw speed, body height, IMU, mode and gait |
| `rt/utlidar/voxel_map_compressed` | ~7.8 Hz | 5 cm voxel geometry, origin, grid dimensions, `odom` frame |
| `rt/utlidar/lidar_state` | ~5 Hz | Sensor health and internal scan/IMU statistics |
| `rt/lf/lowstate` | ~20 Hz | Joint angles, foot forces, battery/power and body attitude |
| `rt/multiplestate` | ~1 Hz | JSON string with obstacle-avoidance switch, UWB switch, brightness and volume |

Rates are measured message-arrival rates in one ten-second session, not hardware
sampling guarantees. Example robot pose was approximately
`[0.012707, -0.042774, 0.312083]`; sport-state position was
`[0.012695, -0.042780, 0.312087]` at a nearby timestamp. Their close agreement is
an observation, not proof of independent pose sensors or guaranteed frame alignment.
Neither coordinate is a surveyed location in the room. Frame origins/reset and
drift still need testing. Motion was not commanded for this probe.

The voxel grid dimensions in the sample were `[128,128,38]` at 0.05 m per cell:
a 6.4 × 6.4 × 1.9 m grid envelope. This is the transmitted grid size, **not**
the LiDAR's maximum range, complete room coverage, or evidence of a persistent map.
The received binary packet can be decoded by the existing voxel worker.

Read-only `get_status` queries succeeded for mapping, localization, navigation,
frontend, control, patrol and autocharge; all returned status `0` (inactive).
`common/get_map_id` returned a nonempty ID. A map ID alone does not establish
that a valid saved map is present or that localization works.
An additional `mapping/get_cloud_map` query was acknowledged as successful,
but no `rt/uslam/cloud_map` payload arrived in the following ten-second window.
At that stage, topic-based map retrieval was unconfirmed; command acknowledgment
alone was insufficient. Later, static-file download successfully backed up the
map (see the activation test below). The idle probe started none of these services.

No messages arrived on the following additional topics during that idle window:
`rt/uslam/frontend/cloud_world_ds`, `rt/uslam/frontend/odom`,
`rt/uslam/cloud_map`, `rt/uslam/localization/odom`,
`rt/uslam/localization/cloud_world`, `rt/uslam/navigation/global_path`,
`rt/mapping/grid_map`, `rt/lio_sam_ros2/mapping/odometry`,
`rt/pctoimage_local`, `rt/qt_notice`, `rt/utlidar/voxel_map`,
`rt/uwbstate`, `rt/servicestate` and `rt/selftest`.
Several are expected to depend on active services; idle silence does not prove
unsupported hardware. `uwbSwitch: true` is a setting, not a measured UWB position.

Sport-state obstacle ranges and foot kinematics were all zero in the sample;
do not treat those zeros as reliable clear-space or foot-location measurements.
Low-state foot forces were populated separately. The sport payload also carried
`error_code: 100`; its meaning was not established and must not be guessed.

We can visualize received voxel geometry and use the robot's existing pose to
track an anchor within a session. This does not establish accurate relocalization
after a restart, physical displacement, or map reset.

Our native Mac Point-LIO port works on the official recorded sample. Live
Point-LIO still needs timed raw clouds and suitable synchronized IMU measurements.
The confirmed sport-state gyro/acceleration is not automatically the
LiDAR's IMU: frame transforms, measurement times, units, filtering and sample rate
must be verified. The [official L1 configuration][lio] explicitly includes IMU
timing and LiDAR-to-IMU extrinsics. The compressed voxel map remains insufficient
for this raw-input integration.

## Sources and scope

- [Unitree's Go2 product page][product]: hardware/app mapping context, not a
  developer API guarantee. The current page advertises L2; this does not identify
  the sensor fitted to an older robot. Do not assign L1/L2 from software version alone.
- [WebRTC driver README][driver]: explicitly lists Go2 Air/Pro/EDU and media,
  data-channel and LiDAR support; community implementation, not an official SDK promise.
- [Driver topic constants][topics]: candidate topic names, not a capability probe.
- [Official Unitree IMU message definition][imu]: quaternion, gyro, acceleration,
  RPY and temperature fields. This defines a schema; it does not prove a Pro
  exposes the complete message over WebRTC.
- Local evidence: inspection script and private report described above.

[sport]: https://github.com/legion1581/unitree_webrtc_connect/blob/master/examples/go2/data_channel/sportmodestate/sportmodestate.py
[low]: https://github.com/legion1581/unitree_webrtc_connect/blob/master/examples/go2/data_channel/lowstate/lowstate.py
[topics]: https://github.com/legion1581/unitree_webrtc_connect/blob/master/unitree_webrtc_connect/constants.py
[driver]: https://github.com/legion1581/unitree_webrtc_connect
[product]: https://www.unitree.com/go2/
[imu]: https://github.com/unitreerobotics/unitree_ros2/blob/master/cyclonedds_ws/src/unitree/unitree_go/msg/IMUState.msg
[lio]: https://github.com/unitreerobotics/point_lio_unilidar/blob/main/config/unilidar_l1.yaml


## Service activation test: confirmed working on this Pro

A later bounded WebRTC test successfully ran the following sequence:

1. Backed up the existing map through `request_static_file`:
   `map.pcd` (32,877 bytes; ASCII PCD with 789 XYZ/intensity points),
   `map.pgm` (75,004 bytes), and `map.txt` (24 bytes).
   Local backup: `output/point-lio/inspection/map-backup-1793992090356/`.
2. `mapping/start` succeeded and `mapping/get_status` returned `1`.
3. `mapping/stop` succeeded and status returned `0`, saving the short test map
   into the robot's map slot. The previous map is preserved in the local backup;
   it was not restored to the robot during this test.
4. `localization/start` succeeded, emitted
   `[Localization] initialization succeed!`, and status returned `1`.
5. `navigation/start` succeeded, emitted `navigation/state_transition/WAITING`,
   and status returned `1`. No goal, patrol or velocity command was sent.
6. Stopped navigation, localization and mapping. Final status was `0` for all three.

**Service startup can change posture:** the server emitted
`control/recv_cmd/STAND_UP` and `control/state_transition/STAND_UP` while starting
mapping and navigation. Do not describe service-start tests as motion-free.
No jailbreak, firmware changes, SSH access, or robot-side installation was used.
The commands are part of the app's authenticated WebRTC mapping flow; this is
observed compatibility, not a claim of official Pro developer support.

Newly confirmed streams during this test:

| Topic | Observed messages | Schema |
| --- | --- | --- |
| `rt/uslam/frontend/odom` | 1,213 | Timestamped `odom` → `base_link` pose, covariance and twist envelope |
| `rt/uslam/frontend/cloud_world_ds` | 13 | Compressed world cloud with XYZ bounds and binary payload |
| `rt/uslam/localization/odom` | 230 | Timestamped `odom` → `base_link` localized pose |
| `rt/uslam/localization/cloud_world` | 20 | PointCloud2-style XYZ/intensity binary point cloud |

Counts cover different active intervals and must not be divided by the whole
session duration to claim sensor sample rates. Twist values were zero in the
sample; covariance arrays are present but not validated uncertainty estimates.
The localization cloud sample had 1,970 points, 32-byte point stride, little-endian
float32 `x`, `y`, `z`, and `intensity` fields, and 63,040 binary bytes.
**There was no per-point time field**, so this is a processed world cloud, not
confirmation of the timed raw LiDAR input needed by our Point-LIO integration.

Navigation service startup is confirmed; driving to a goal, collision avoidance,
path generation, kidnapped-robot recovery and localization across restarts remain
untested. The short stationary map does not establish complete room coverage.

Private evidence: `output/point-lio/inspection/activation-report.json`.
The inspector's default remains read-only. `--backup` downloads the map;
`--activate <backup-directory>` performs the bounded service-start test and
requires nonempty PCD/PGM/TXT backup files. Activation overwrites the robot map
slot and can command stand-up internally, so do not rerun casually.
