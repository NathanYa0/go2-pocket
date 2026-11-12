"""Read-only ROS input preflight; never publishes movement or sensor commands."""
import json
import math
import threading
import time


def validate(clouds, imus, ros_now):
    errors = []
    required = {"x", "y", "z", "intensity", "time"}
    if len(clouds) < 2:
        errors.append("Need multiple raw PointCloud2 scans on /unilidar/cloud.")
    if len(imus) < 10:
        errors.append("Need an IMU stream on /unilidar/imu.")
    for sample in clouds:
        if not required.issubset(sample["fields"]) or sample["points"] <= 0:
            errors.append("Cloud needs nonempty raw x/y/z/intensity/time fields; display voxels are insufficient.")
            break
    for stream in [clouds, imus]:
        stamps = [sample["stamp"] for sample in stream]
        if any(not math.isfinite(stamp) or stamp <= 0 for stamp in stamps):
            errors.append("Sensor timestamps must be finite and nonzero.")
        if any(b <= a for a, b in zip(stamps, stamps[1:])):
            errors.append("Sensor timestamps must increase within each stream.")
        if stamps and not 0 <= ros_now - stamps[-1] <= 1:
            errors.append("Sensor timestamps are stale or ahead of the ROS clock.")
    if any(not all(math.isfinite(v) for v in sample["values"]) for sample in imus):
        errors.append("IMU angular velocity/acceleration must be finite.")
    if clouds and imus and abs(clouds[-1]["stamp"] - imus[-1]["stamp"]) > 0.2:
        errors.append("LiDAR and IMU timestamps do not overlap closely enough.")
    return errors


def main():
    import rospy
    from sensor_msgs.msg import Imu, PointCloud2
    rospy.init_node("go2_point_lio_input_check", anonymous=True, disable_signals=True)
    clouds, imus = [], []
    lock = threading.Lock()

    def cloud(message):
        with lock:
            clouds.append({"stamp": message.header.stamp.to_sec(), "fields": [f.name for f in message.fields], "points": message.width * message.height})

    def imu(message):
        with lock:
            imus.append({"stamp": message.header.stamp.to_sec(), "values": [message.angular_velocity.x, message.angular_velocity.y, message.angular_velocity.z,
                          message.linear_acceleration.x, message.linear_acceleration.y, message.linear_acceleration.z]})

    subscribers = [rospy.Subscriber("/unilidar/cloud", PointCloud2, cloud, queue_size=20),
                   rospy.Subscriber("/unilidar/imu", Imu, imu, queue_size=1000)]
    time.sleep(5)
    with lock:
        errors = validate(clouds, imus, rospy.Time.now().to_sec())
        print(json.dumps({"cloud_samples": len(clouds), "imu_samples": len(imus), "errors": errors,
                          "note": "Schema/timing preflight only. Verify per-point time units, raw values and sensor extrinsics before trusting localization."}, indent=2))
    for subscriber in subscribers:
        subscriber.unregister()
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
