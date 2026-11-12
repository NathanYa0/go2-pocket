"""Test input rejection without ROS or robot access."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
path = Path(__file__).resolve().parents[1] / "integrations/point-lio/check_inputs.py"
spec = importlib.util.spec_from_file_location("point_lio_inputs", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Inputs(unittest.TestCase):
    def samples(self):
        clouds = [{"fields": ["x", "y", "z", "intensity", "time"], "points": 100, "stamp": 9.8 + i * .1} for i in range(2)]
        imus = [{"values": [0, 0, 0, 0, 0, 9.81], "stamp": 9.8 + i * .01} for i in range(11)]
        return clouds, imus

    def test_expected_schema(self):
        clouds, imus = self.samples()
        self.assertEqual(module.validate(clouds, imus, 10), [])

    def test_display_voxels_rejected(self):
        clouds, imus = self.samples()
        clouds[0]["fields"] = ["x", "y", "z"]
        self.assertTrue(any("raw" in error for error in module.validate(clouds, imus, 10)))

    def test_missing_streams(self):
        self.assertEqual(len(module.validate([], [], 10)), 2)

    def test_bad_imu(self):
        clouds, imus = self.samples()
        imus[0]["values"][0] = float("nan")
        self.assertTrue(any("finite" in error for error in module.validate(clouds, imus, 10)))

    def test_old_data(self):
        clouds, imus = self.samples()
        self.assertTrue(any("stale" in error for error in module.validate(clouds, imus, 20)))

    def test_time_reversal(self):
        clouds, imus = self.samples()
        clouds.reverse()
        self.assertTrue(any("increase" in error for error in module.validate(clouds, imus, 10)))

    def test_clock_mismatch(self):
        clouds, imus = self.samples()
        for sample in imus:
            sample["stamp"] -= .5
        self.assertTrue(any("overlap" in error for error in module.validate(clouds, imus, 10)))


unittest.main()
