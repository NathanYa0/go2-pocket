# Automatic mapping in Go2 Pocket

The working Mac DimOS mapper is integrated into this repository and the app.
There is no dependency on a sibling `../dimos` checkout or separately launched
Rerun window. The pinned Apache-2.0 source is in `vendor/dimos`; see its
`POCKET-UPSTREAM.md` and `LICENSE`. Python/npm dependencies still install normally.

## Install once on an Apple Silicon Mac

```sh
brew install uv portaudio libsndfile git-lfs
npm ci
npm run mapping:setup
```

The installer uses Python 3.12, uv 0.13.7, the vendored lockfile, and the `unitree`
and `cpu` extras. The local environment is approximately 3 GB and is Git-ignored.
The Go2 Pro must be on the same reachable Wi-Fi network as the Mac. Put its current
`IP_ADDRESS` and `UNITREE_AES_KEY` in the root `.env`; values never enter the UI.
Bluetooth provisions Wi-Fi; mapping sensor data travels over WebRTC.

## Use the app

```sh
npm run dev
```

Open http://127.0.0.1:5186/ and choose **Maps** on Home, or **Automatic mapping**
in Tools. From the existing robot mapping screen choose **Automatic mapping
(DimOS)**. The app closes its direct Drive/WebRTC connection before handing control
to the Mac mapper.

1. Supervise Go2 with its remote stop available on a floor without stairs/drops.
2. Check the supervision box and press **Start new map**. This may make Go2 stand.
3. Wait for **Mapping is ready**, then press **Explore** to start walking.
4. **Pause movement** stops exploration while mapping stays active; **Explore** resumes.
5. **Stop & Save** stops exploration, cancels navigation, sends StopMove, shuts down
   the mapper and verifies that the saved database has keyframes.
6. To fill missed areas, hold a **Drive to missed areas** button. Release to stop.
   This cancels exploration/navigation but keeps the same mapping session running.
   Holds are limited to ten seconds; manual packets expire after 350 ms and the
   robot adapter's existing velocity deadman remains enabled.
7. Drag **⚑ Drag flag to map** onto the live map (or click it, then click the map).
   Use **Top view** for easier floor placement. Press **Go to flag** to send it to
   the existing A* planner. It can choose a nearby safe goal or reject the route;
   dragging alone never moves the robot. Pause movement cancels the route.
8. After shutdown, **View** shows a saved 3D map; **Download** exports its `.map.db`.
   **Back** returns to Home, where normal Drive can reconnect.

The controls drawer can collapse to leave the map full width. Drag to orbit,
pinch/scroll to zoom, or use Fit map. The display samples at most 300,000 points;
the database retains the mapper's full saved graph. Live clouds retain DimOS's
robot-anchored `world` frame, matching its odometry and navigation planner. Saved
clouds use `map` and cannot issue motion targets. Height colors use the upstream
Turbo palette. The live robot marker and yellow planned route use the same frame.

Keep this app tab open. Only its session can start/resume exploration; another
local tab can stop it. Losing app heartbeats for 15 seconds requests a stop and
save. This is a control-connection watchdog, not a timeout for reaching a frontier.
The former DimOS 15-second target deadline is removed; navigation failure still
allows the explorer to select another reachable frontier. No footprint or collision
checks were relaxed by this integration.

## What runs where

- `src/ui/components/automatic-mapping-page.ts`: controls, live/saved 3D viewer.
- `scripts/mapping-service.mjs`: one owned process, local API, session lease,
  map library/downloads. Mounted by `src/mapping-plugin.ts` in Vite dev and preview.
- `integrations/dimos/bridge.py`: official WebRTC adapter configuration, DimOS
  lifecycle/RPC, cloud preview, graceful stop, validated save.
- `vendor/dimos`: mapping, loop closure, costmap, frontier selection, planning,
  movement control and their dependencies' lockfile.
- `output/mapping`: private local databases, previews, validation metadata and logs.

This screen currently controls mapping **on the Mac**. A standalone iPhone/Android
installation does not contain Python and cannot launch it. The service is loopback
only; publishing the frontend or using `vite --host` does not expose robot control.
Regular native Drive, camera, actions and robot-side mapping remain available.
The Maps tab, Home Maps card and Drive Map button all open this combined screen.
The older experimental browser explorer and robot USLAM workflow remain under
Robot maps & navigation in Tools. Return-to-anchor is not wired to DimOS maps. Saved maps can be viewed/exported; automatic resume in
an old map is not exposed because relocalization was unreliable in prior tests.

The app refuses movement in `?preview=1`. Starting the server, opening the page,
and viewing a saved map do not connect to or move the robot. App-managed sessions
use an isolated local Zenoh domain, so RPCs cannot attach to another DimOS stack.
Do not run a separate manual controller or DimOS robot stack at the same time.

## Import an earlier map

```sh
vendor/dimos/.venv/bin/python integrations/dimos/import_map.py /path/to/map.map.db
```

It validates keyframes and makes a copy and preview in the app's library. It does
not change the original. Map files and all logs remain private and are excluded
from Git. Do not upload raw session logs without reviewing them for network details.

## Verification

```sh
npm run check
npm run check:mapping-service
npm run build
# With npm run dev running (mock service, no robot):
node scripts/check-automatic-mapping-ui.mjs
node scripts/check-drive-restored.mjs
# No hardware: pass a local DimOS Go2 recording, such as upstream go2_short.db.
python3 scripts/check-dimos-replay.py /path/to/go2_short.db
vendor/dimos/.venv/bin/python -m pytest -o addopts='' --noconftest \
  vendor/dimos/dimos/navigation/experimental/frontier_exploration/test_goal_wait.py -q
```

The integrated engine was exercised on recorded Go2 data through cloud generation
and validated save. A new live supervised run is still needed to validate the
new app-to-engine handoff with hardware. Earlier standalone DimOS trials did walk
and turn on this Go2 Pro; those are not a substitute for testing this integration.

## Operator control implementation

`controls.py` switches between exploration, manual drive and flag navigation by
first stopping exploration and canceling the old planner goal. The service rejects
wrong-session targets, stale/released drive gestures, non-finite coordinates and
out-of-range speeds. Flags require fresh live world-frame cloud and pose data.
Saved-map viewing cannot issue destinations. The UI's world-to-Three conversion
is `(x, y, z) -> (x, z, -y)`; floor flags invert it to `(scene.x, -scene.z)`.
Map sampling affects display only, never the costmap or obstacle checks.

`vendor/dimos/.venv/bin/python -m pytest integrations/dimos/test_controls.py` tests transitions, stop expiry,
coordinate frame validation and map detail. The service tests cover released
packets, session mismatches and invalid targets. The browser test drags a flag,
presses Go, and exercises held/released driving with intercepted requests; no real
robot is used. The replay test also sends a real planner goal on the replay-only
connection. These new controls still need a supervised physical test.
