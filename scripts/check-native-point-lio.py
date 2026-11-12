"""Native adapter regressions. Uses sample replay when already downloaded; no hardware."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "output/point-lio/native-build/pointlio-mac"
CONFIG = ROOT / "output/point-lio/native-l1.yaml"
SAMPLE = ROOT / "output/point-lio/sample-30s.ndjson"


class NativeAdapter(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="go2-pointlio-test-")
        self.directory = Path(self.temporary.name)
        config = yaml.safe_load(CONFIG.read_text())
        config["pcd_save"]["pcd_save_en"] = False
        self.config = self.directory / "config.yaml"
        self.config.write_text(yaml.safe_dump(config))

    def tearDown(self):
        self.temporary.cleanup()

    def run_events(self, events, config=None):
        text = "\n".join(json.dumps(event) for event in events) + "\n"
        return subprocess.run([str(BINARY), str(config or self.config), "-", "-"], input=text,
                              text=True, capture_output=True, timeout=15)

    def test_help(self):
        result = subprocess.run([str(BINARY), "--help"], text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertIn("stdin/stdout", result.stdout)

    def test_missing_configuration(self):
        bad = self.directory / "bad.yaml"
        bad.write_text("mapping: {}\n")
        result = self.run_events([], bad)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Invalid required configuration", result.stderr)

    def test_duplicate_imu(self):
        imu = {"type": "imu", "stamp": 1, "gyro": [0, 0, 0], "accel": [0, 0, 9.81]}
        result = self.run_events([imu, imu])
        self.assertEqual(result.returncode, 2)
        self.assertIn("timestamps must increase", result.stderr)

    def test_missing_point_time(self):
        result = self.run_events([{"type": "cloud", "stamp": 1, "points": [[1, 2, 3, 4]]}])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Each point needs", result.stderr)

    def test_bad_point_time(self):
        result = self.run_events([{"type": "cloud", "stamp": 1, "points": [[1, 2, 3, 4, 99]]}])
        self.assertEqual(result.returncode, 2)
        self.assertIn("seconds offset", result.stderr)

    def test_input_output_alias_is_not_truncated(self):
        path = self.directory / "same.ndjson"
        path.write_text("original input\n")
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        result = subprocess.run([str(BINARY), str(self.config), str(path), str(path)], capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_no_data_is_not_success(self):
        result = self.run_events([])
        self.assertEqual(result.returncode, 3)
        self.assertIn("No position estimates", result.stderr)

    def test_session_limit(self):
        config = yaml.safe_load(self.config.read_text())
        config["native"] = {"max_seconds": 1}
        self.config.write_text(yaml.safe_dump(config))
        imu = {"type": "imu", "stamp": 1, "gyro": [0, 0, 0], "accel": [0, 0, 9.81]}
        result = self.run_events([imu, {**imu, "stamp": 3}])
        self.assertEqual(result.returncode, 4)
        self.assertIn("Session limit", result.stderr)

    @unittest.skipUnless(SAMPLE.exists(), "download/convert official sample to run replay validation")
    def test_official_recording_replay(self):
        with SAMPLE.open() as source:
            result = subprocess.run([str(BINARY), str(self.config), "-", "-"], stdin=source,
                                    text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        poses = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertGreater(len(poses), 200)
        self.assertEqual(len({pose["session"] for pose in poses}), 1)
        self.assertTrue(all(pose["frame"] == "camera_init" for pose in poses))
        for pose in poses:
            self.assertTrue(all(math.isfinite(v) for v in pose["position"] + pose["quaternion_xyzw"]))
            self.assertLess(abs(math.hypot(*pose["quaternion_xyzw"]) - 1), 1e-6)
        self.assertTrue(all(b["stamp"] >= a["stamp"] for a, b in zip(poses, poses[1:])))
        self.assertLess(max(math.dist(a["position"], b["position"]) for a, b in zip(poses, poses[1:])), 5)


if __name__ == "__main__":
    if not BINARY.exists() or not CONFIG.exists():
        raise SystemExit("Build pointlio-mac and prepare native-l1.yaml first; see integrations/point-lio/README.md")
    unittest.main()
