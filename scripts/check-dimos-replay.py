"""Exercise the actual mapping bridge with a recorded database, never hardware."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
recording = Path(sys.argv[1]).resolve()
assert recording.is_file(), "Supply a local DimOS Go2 recording database"
run_id = "replay-test-" + uuid.uuid4().hex
messages = queue.Queue()
env = dict(os.environ, ZENOH_DOMAIN=run_id, ROBOT_IP="", ZENOH_CONNECT="", ZENOH_SCOUTING="false", PYTHONUNBUFFERED="1")
p = subprocess.Popen([str(ROOT / "vendor/dimos/.venv/bin/python"), str(ROOT / "integrations/dimos/bridge.py"), run_id, "--replay", str(recording)],
                     cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def read():
    for line in p.stdout:
        try:
            messages.put(json.loads(line))
        except ValueError:
            pass

threading.Thread(target=read, daemon=True).start()
threading.Thread(target=lambda: [None for _ in p.stderr], daemon=True).start()
cloud = None
final = None
try:
    deadline = time.monotonic() + 110
    while time.monotonic() < deadline:
        try:
            m = messages.get(timeout=1)
        except queue.Empty:
            if p.poll() is not None:
                break
            continue
        if "state" in m:
            print(m["state"], m.get("message", ""), flush=True)
        if m.get("cloud", {}).get("points"):
            cloud = m["cloud"]
            break
        assert m.get("state") != "error", m
    assert cloud, "No live map cloud arrived through the bridge"
    p.stdin.write('{"command":"stop"}\n');p.stdin.flush()
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            m = messages.get(timeout=1)
            if m.get("state") == "stopped":
                final = m
                break
        except queue.Empty:
            if p.poll() is not None:
                break
    assert final and final["saved"], final
    assert final["stopConfirmed"], final
    p.wait(timeout=10)
    assert p.returncode == 0
    print(f"PASS: actual vendored engine → bridge → {len(cloud['points'])} preview points → validated saved map. No real robot connection.")
finally:
    if p.poll() is None:
        p.stdin.close();p.terminate()
        try:
            p.wait(timeout=40)
        except subprocess.TimeoutExpired:
            p.kill()
