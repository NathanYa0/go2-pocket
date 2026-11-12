# Point-LIO tracking integration

See [Go2 Pro WebRTC data findings](../../docs/go2-pro-data.md) for the live
sensor inventory, research sources and confirmed sport-state gyro/acceleration access.
The [reproducible access guide](../../docs/go2-pro-data-access.md) gives exact
WebRTC topics, fields, cloud decoding, map backup and service-start procedures.

Target workflow: establish A at the start of a live mapping session, manually
drive while Point-LIO estimates motion and builds a map, then use a separate
planner/controller to return to A. The native Mac mapper now builds and replays
raw sensor recordings without ROS or a Linux VM. It does not enable robot motion.

Upstream source: https://github.com/unitreerobotics/point_lio_unilidar
Pinned revision: `18ed5976d8fab2bd8a5148c26a40692bd3c0dc91`.
Upstream's GPL-2.0 LICENSE remains in its checkout; no upstream implementation
has been copied into the application's MIT-licensed TypeScript sources.

## Prepare source on Mac or Linux

```sh
bash integrations/point-lio/run.sh prepare
```

The source goes into ignored `output/point-lio/ws/src/point_lio_unilidar`.
No credentials from `.env` are copied into this workspace.

## Native macOS build and replay

The adapter compiles the actual upstream estimator, preprocessing and incremental
KD-tree in C++17. `native/native.hpp` supplies only the messaging/configuration
interfaces used by the estimator and writes pose NDJSON. It does not implement
a replacement odometry algorithm. CMake patches a build-directory copy for
modern Eigen/Apple Clang struct alignment and adds a 2-million-map-point guard;
the original checkout remains unchanged apart from generated map/log files.

Install Homebrew dependencies and build:

```sh
brew install cmake pcl libomp yaml-cpp nlohmann-json
bash integrations/point-lio/native/build-mac.sh
```

To convert an existing UniLiDAR ROS bag on macOS, use an isolated Homebrew Python
environment (no ROS installation is needed):

```sh
python3 -m venv output/point-lio/python
output/point-lio/python/bin/pip install -r integrations/point-lio/native/requirements.txt
output/point-lio/python/bin/python integrations/point-lio/native/prepare_config.py \
  output/point-lio/ws/src/point_lio_unilidar L1 output/point-lio/native-l1.yaml
output/point-lio/python/bin/python integrations/point-lio/native/export_bag.py \
  path/to/recording.bag output/point-lio/input.ndjson --seconds 30
output/point-lio/native-build/pointlio-mac output/point-lio/native-l1.yaml \
  output/point-lio/input.ndjson output/point-lio/poses.ndjson
```

Use `L2` instead of `L1` only after confirming the actual sensor model and
calibration. The configuration generator merges the upstream sensor YAML with
its launch parameters and explicitly emits one pose per scan. ROS launch files
are not required at runtime. See `native/README.md` for streaming, schemas,
limits and validation evidence.

The official L1 sample bag linked by upstream was downloaded and converted here
as `output/point-lio/sample-30s.ndjson`. Regression command:

```sh
output/point-lio/python/bin/python scripts/check-native-point-lio.py
```

This Mac's 30-second sample replay produced 294 finite poses spanning 29.62
seconds and a 490,306-point PCD map. This confirms a working native replay, not
accuracy on this user's robot. No ground-truth accuracy comparison was made.

## Linux runtime and data prerequisites

Upstream documents Ubuntu 20.04 / ROS Noetic, Eigen, PCL and the appropriate
UniLiDAR SDK. Its README provides L1/L2 driver instructions and sample ROS bags.
Install those prerequisites in a Linux host/VM/container, then run from this repo:

```sh
bash integrations/point-lio/run.sh build
# Start the matching sensor driver/bridge or play a matching sample bag separately.
bash integrations/point-lio/run.sh check-inputs
bash integrations/point-lio/run.sh run L1  # or L2 after confirming the hardware
```

Keep the LiDAR stationary during initialization. Starting a new process creates
a new tracking frame; coordinates must not be mixed between sessions.

The checker subscribes only; it publishes no robot commands. It checks the
presence of nonempty raw clouds with `x/y/z/intensity/time`, IMU messages, and
basic timestamp freshness/order/overlap. Passing is not proof of correct sensor
calibration: inspect point-time units, scan frame, coordinate transforms and
LiDAR-to-IMU extrinsics. Upstream config expects point-time offsets in seconds.

The app currently receives `rt/utlidar/voxel_map_compressed` for visualization.
Its voxel geometry lacks the per-point timing needed by this Point-LIO input
path. A raw data connection to the robot/sensor still needs verification and a
driver/bridge. Renaming the voxel stream as a raw cloud is not a solution.

## Outputs and remaining work

Upstream publishes `/pointlio/odom`, `/pointlio/path`, and
`/pointlio/cloud_registered`. It can save `PCD/scans.pcd` in its source directory.
Those outputs must be bridged into Go2 Pocket with a session identifier, fresh
timestamps and a frame origin A. A return controller also needs traversability,
collision handling and a route planner. This repository's current Maps anchor
buttons still use the robot's onboard USLAM service; they are not connected to
Point-LIO and must not consume Point-LIO coordinates as USLAM map coordinates.

ROS remains an optional Linux route. Native macOS replay is implemented and
tested, but live access to this Go2's raw LiDAR/IMU data still needs verification.
The existing app's compressed voxel visualization is not enough to establish
that access. Validate live sensor timing and extrinsics before implementing
automated return.
