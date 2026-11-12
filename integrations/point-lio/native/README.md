# Native Mac Point-LIO adapter

This GPL-2.0 adapter builds Unitree's original Point-LIO estimator on macOS
without ROS. Upstream: <https://github.com/unitreerobotics/point_lio_unilidar>,
revision `18ed5976d8fab2bd8a5148c26a40692bd3c0dc91`. The upstream GPL-2.0 license
is preserved in `LICENSE` here and in the source checkout. These adapter files
are also GPL-2.0; they are separate from the app's MIT TypeScript source.

## Commands

```sh
bash integrations/point-lio/native/build-mac.sh
output/point-lio/native-build/pointlio-mac CONFIG.yaml INPUT.ndjson OUTPUT.ndjson
```

Build needs Homebrew `cmake`, `pcl`, `libomp`, `yaml-cpp`, and `nlohmann-json`.
The Mac-specific CMake adapter generates lightweight ROS-shaped type/config
headers. Transform broadcasting and ROS visualization publishers are omitted.
The estimator, scan preprocessing, IMU processing and KD-tree remain upstream.
A build-directory copy moves the UniLiDAR struct alignment annotation to syntax
accepted by current Apple Clang/Eigen. Another patch stops map insertion if the
incremental KD-tree exceeds two million points.

Use `prepare_config.py SOURCE L1 OUTPUT.yaml` (or L2) to merge the upstream
sensor configuration and launch settings. `--live` additionally disables
accumulating path history, saves PCD chunks every 100 scans, and bounds the local
map to a 100 m sliding cube with a 30 m detection range. These are initial
resource limits, not evidence that the sensor/extrinsic settings fit your Go2.

## Streaming and coordinate frame

`-` selects stdin or stdout:

```sh
output/point-lio/native-build/pointlio-mac CONFIG.yaml - - < INPUT.ndjson
```

Each emitted pose line is flushed immediately; ordinary upstream diagnostics
go to stderr when stdout is selected. There is no network listener and no
movement-command output. Input ends on EOF, then queued scans with sufficient
IMU coverage are drained. Remaining unmatched scans are reported to stderr.

Output example (numbers illustrative):

```json
{"session":"unique-per-process","stamp":1695357725.5,"frame":"camera_init","position":[0.1,0.2,0.0],"quaternion_xyzw":[0.0,0.0,0.0,1.0]}
```

The pose tracks the LiDAR/IMU frame, not an independently calibrated robot base
frame. `camera_init` is a session-local frame with gravity alignment according to
the supplied configuration. A later bridge must establish anchor A in this same
session and account for the LiDAR-to-robot-base transform. Never pass these
coordinates into Go2's onboard USLAM navigation as if the frames were identical.

Input schema, one JSON event per line:

```json
{"type":"imu","stamp":1.001,"gyro":[0,0,0],"accel":[0,0,9.81]}
{"type":"cloud","stamp":1.01,"points":[[1.0,2.0,0.5,20.0,0.001]]}
```

Times are seconds in one shared sensor clock. Gyro is radians/second,
acceleration is m/s², XYZ are metres. Each cloud point has five values:
`[x,y,z,intensity,time_offset_seconds]`; the time offset is relative to its scan
start, must lie in [0,1], and must come from actual raw sensor timing. Timestamps
must increase within each input stream. Raw scans must contain 1–90,000 points.
The UniLiDAR preprocessing path does not use the ring field, so it is filled
with zero by the adapter. Other LiDAR layouts are not supported by this schema.

`export_bag.py` uses embedded ROS message definitions via `rosbags`, respects
point strides/endian fields, removes nonfinite points, orders events by sensor
timestamp, and reports skipped duplicate timestamps. The converter currently
buffers the selected interval in memory; use its `--seconds` limit for large bags.

## Limits and artifacts

Sessions stop after 600 sensor-seconds by default or 200,000 input events.
`native/max_seconds` can be set in the YAML between 0 and 3600. Input lines are
limited to 16 MB. For streamed runs use the `--live` configuration preset to
bound path/map accumulation. The algorithm still needs correctly synchronized
raw data, a stationary initialization, and correct sensor calibration.

Exit codes: 0 produced estimates; 2 input/config/output failure; 3 no estimates;
4 session limit reached. A finite estimate is not itself a confidence guarantee.

Upstream map/log output currently goes to its checkout's `PCD/` and `Log/`
directories. A normal replay writes `PCD/scans.pcd`; live presets write chunks
`PCD/scans_N.pcd`. Copy artifacts to a session-specific location before the next
run. Do not run simultaneous mapper processes sharing the same source checkout.

## Validation on this Mac

The official upstream L1 sample was used, not live Go2 data. For a 30-second
interval: 7,492 IMU messages and 297 scans produced 294 per-scan poses spanning
29.62 seconds and a 490,306-point map. Pose quaternions were unit length to
floating-point tolerance and the largest consecutive position increment was
about 6.7 cm. These are sanity checks; no ground-truth accuracy was measured.

`scripts/check-native-point-lio.py` tests native streaming, duplicate timestamps,
missing point times, invalid time offsets, invalid configuration, input/output
alias protection, empty input and session timeout, and replays the official
sample if already downloaded. It requires the built binary and prepared L1
configuration. It never connects to the robot.

Live Go2 raw sensor input and automatic return are not implemented by this
adapter. The app's existing anchor feature still uses onboard USLAM. A complete
native Point-LIO return feature needs a verified raw sensor bridge, session/frame
handling, traversability/route planning, and a movement controller.

Read-only inspection on 2026-11-06 confirmed that this Go2's current Wi-Fi
WebRTC connection supplies robot poses and low-state messages, but no raw
responses were observed on the probed cloud/IMU topics. SSH refused the
connection. Native DDS discovery on Wi-Fi domain 0 also observed no published
topics during the test. These observations do not prove the robot can never
provide raw data; they leave its wired DDS/sensor interface and model-specific
access to be verified. The compiled mapper cannot reconstruct missing raw
point timestamps from the existing compressed voxel stream.
