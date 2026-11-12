"""Session-local operator controls; planners and teleoperation never drive together."""
import math
import time

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3


def stop_motion(app):
    ok = True
    for call in (app.WavefrontFrontierExplorer.end_exploration,
                 app.ReplanningAStarPlanner.cancel_goal, app.GO2Connection.stop_movement):
        try:
            call()
        except Exception:
            ok = False
    return ok


class OperatorControls:
    def __init__(self, app):
        self.app = app
        self.mode = "mapping"
        self.note = "Mapping stationary. Explore, drive manually, or place a destination flag."
        self.manual_until = 0

    def pause(self):
        if not stop_motion(self.app):
            raise RuntimeError("Movement stop unconfirmed")
        self.manual_until = 0
        self.mode = "mapping"
        self.note = "Movement paused. Mapping continues."

    def command(self, message, pose, cloud, now=None):
        realtime = now is None
        now = time.time() if now is None else now
        command = message["command"]
        if command in ("pause", "manual-stop"):
            self.pause()
        elif command == "explore":
            self.pause()
            self.app.WavefrontFrontierExplorer.begin_exploration()
            self.mode = "exploring"
            self.note = "Exploring reachable frontiers."
        elif command == "manual":
            if message.get("validUntil", 0) < now * 1000:
                return
            forward, yaw = message.get("forward"), message.get("yawRate")
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (forward, yaw)):
                raise ValueError("Invalid manual velocity")
            if abs(forward) > 0.4 or abs(yaw) > 0.6:
                raise ValueError("Manual velocity exceeds limit")
            if self.mode != "manual":
                self.pause()
                self.mode = "manual"
                self.manual_until = time.time() + 0.35 if realtime else now + 0.35
            # Cancellation may take time: never revive an expired button hold.
            if message.get("validUntil", 0) < time.time() * 1000 and realtime:
                return
            sent = self.app.GO2Connection.move(Twist(linear=Vector3(forward, 0, 0), angular=Vector3(0, 0, yaw)))
            if sent is False:
                raise RuntimeError("Robot rejected manual movement")
            self.manual_until = min(message["validUntil"] / 1000, now + 0.4)
            self.mode = "manual"
            self.note = "Manual drive. Release the button to stop; the map keeps updating."
        elif command == "goal":
            if not pose or not cloud or pose["frame"] != "world" or cloud["frame"] != "world":
                raise ValueError("Live world-frame map and robot pose required")
            if now * 1000 - pose["receivedAt"] > 2000 or now * 1000 - cloud["capturedAt"] > 5000:
                raise ValueError("Wait for fresh map and position data")
            x, y = message.get("x"), message.get("y")
            if not all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 100 for v in (x, y)):
                raise ValueError("Invalid map destination")
            self.pause()
            self.app.ReplanningAStarPlanner.set_goal(PoseStamped(position=Vector3(x, y, 0), frame_id="world"))
            self.mode = "navigating"
            self.note = "Planning a checked route to the flag."

    def tick(self, planner, exploring, now=None):
        now = time.time() if now is None else now
        if self.mode == "manual" and now >= self.manual_until:
            self.app.GO2Connection.stop_movement()
            self.mode = "mapping"
            self.note = "Manual drive released. Mapping continues."
        elif self.mode == "navigating":
            if planner.endswith("IDLE"):
                arrived = self.app.ReplanningAStarPlanner.is_goal_reached()
                self.mode = "mapping"
                self.note = "Destination reached. Mapping continues." if arrived else "No usable route to that flag. Choose another point or drive manually."
            else:
                self.note = "Following the checked route to your flag. Pause movement cancels it."
        elif self.mode == "exploring" and not exploring:
            self.mode = "mapping"
            self.note = "Exploration ended. You can place a flag or drive manually to cover remaining areas."
