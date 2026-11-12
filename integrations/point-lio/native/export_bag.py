"""Convert timestamped raw UniLiDAR ROS1 recordings without a ROS installation."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from rosbags.highlevel import AnyReader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bag", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--seconds", type=float, default=30)
    args = parser.parse_args()
    events = []
    with AnyReader([args.bag]) as reader:
        connections = [c for c in reader.connections if c.topic in ["/unilidar/cloud", "/unilidar/imu"]]
        if len({c.topic for c in connections}) != 2:
            raise ValueError("Recording must contain raw /unilidar/cloud and /unilidar/imu")
        end = reader.start_time + int(args.seconds * 1e9)
        for connection, _, raw in reader.messages(connections=connections, stop=end):
            msg = reader.deserialize(raw, connection.msgtype)
            stamp = msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
            if connection.topic == "/unilidar/imu":
                event = {"type": "imu", "stamp": stamp,
                         "gyro": [msg.angular_velocity.x, msg.angular_velocity.y, msg.angular_velocity.z],
                         "accel": [msg.linear_acceleration.x, msg.linear_acceleration.y, msg.linear_acceleration.z]}
            else:
                fields = {f.name: f for f in msg.fields}
                names = ["x", "y", "z", "intensity", "time"]
                if any(name not in fields or fields[name].datatype != 7 or fields[name].count != 1 for name in names):
                    raise ValueError("Expected raw Float32 x/y/z/intensity/time fields")
                dtype = np.dtype({"names": names, "formats": [(">f4" if msg.is_bigendian else "<f4")] * 5,
                                  "offsets": [fields[name].offset for name in names], "itemsize": msg.point_step})
                # Respect padded row strides, not just the common height=1 layout.
                points = np.ndarray((msg.height, msg.width), dtype=dtype, buffer=msg.data, strides=(msg.row_step, msg.point_step))
                matrix = np.column_stack([points[name].ravel() for name in names])
                matrix = matrix[np.isfinite(matrix).all(axis=1)]
                if not len(matrix):
                    continue
                if np.any(matrix[:, 4] < 0) or np.any(matrix[:, 4] > 1):
                    raise ValueError("Point times must be offsets in seconds; verify your sensor configuration")
                event = {"type": "cloud", "stamp": stamp, "points": matrix.tolist()}
            if not math.isfinite(stamp) or stamp <= 0:
                raise ValueError("Invalid sensor timestamp")
            events.append(event)
    events.sort(key=lambda event: event["stamp"])
    last = {"imu": -1, "cloud": -1}
    counts = {"imu": 0, "cloud": 0, "duplicates_skipped": 0}
    with args.output.open("w") as output:
        for event in events:
            kind = event["type"]
            if event["stamp"] <= last[kind]:
                counts["duplicates_skipped"] += 1
                continue
            last[kind] = event["stamp"]
            output.write(json.dumps(event, allow_nan=False, separators=(",", ":")) + "\n")
            counts[kind] += 1
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
