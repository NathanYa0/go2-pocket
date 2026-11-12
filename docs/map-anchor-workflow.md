# Map a room and return to A on Go2 Pro

For the experimental automatic Step 1 option, see
[Explore & Map](exploration-mapping.md). Localization and return remain separate.

This workflow uses the Go2's onboard USLAM services over authenticated local
WebRTC. It runs in the Mac browser without modifying the robot firmware.
It is separate from the native Mac Point-LIO experiment; timed raw LiDAR inputs
for live Point-LIO remain unconfirmed.

## Use it

1. Start the dev server with `npm run dev`. Open
   `http://127.0.0.1:5186/?desktop=1` for the full desktop layout, connect over
   Local Network and open Maps.
2. Place Go2 at your desired A. **New Map + Anchor A** first downloads all three
   current map files into a local backup, then starts mapping. Startup can cause
   Go2 to stand up. Wait for **A captured** before driving. The first live
   frontend pose supplies A's position and heading; the app does not assume zero.
3. Use **Manual Drive** while keeping Go2 in sight. Hold Forward, Back, Turn left
   or Turn right; release to send neutral input and StopMove. The buttons publish
   at 20 Hz, use 0.15 normalized controller input, stop on stale position, blur,
   hidden document or page cleanup, and limit each hold to ten seconds. This is
   a normalized input limit, not a measured speed in metres per second.
4. Cover accessible parts of the room from multiple viewpoints. The live map is
   visual evidence, not an automated coverage guarantee. Stop somewhere away
   from A, click **Stop & Save**, and name the map. The robot saves its map;
   the app confirms a new map ID and retains A under that robot/map identity.
   It then caches PCD, PGM, TXT and A locally.
5. Click **Start Localization**. Wait for successful initialization and a live
   localized pose. The status remains an estimate until you check the robot marker
   and live scan alignment and click **Position on map is correct**. Navigation
   stays locked until that confirmation. Adjust Initial Pose on the map only if automatic initialization
   fails and you know the actual map position and heading.
6. With a clear supervised route, click **Return to Anchor**. The controller
   confirms the same map, live localization and inactive mapping/patrol/autocharge,
   starts the onboard navigator, confirms it is active and sends A as the goal.
   **Stop Return** cancels the return. A navigation error, stale pose, lost
   localization or map change stops it; the return is bounded to sixty seconds.
7. Arrival is reported as verified only when the navigator reports REACHED and
   the localized pose is within 30 cm and 15 degrees of A. These tolerances are
   software checks, not a claim of measured positioning accuracy.

Manual Drive cancels an active return before publishing user input. Leaving the
page or suspending the app cancels the return and releases manual drive.
These client-side stops require a working process/connection; they are not a
hardware safety controller. Keep the robot's physical remote available.

## Reuse and export

Saved Maps lives in browser localStorage plus IndexedDB on this Mac/browser
profile. Keep the same browser profile or export the map. A ZIP contains
`metadata.json`, `map.pcd`, `map.pgm`, `map.txt` and optional `anchor.json`.
The anchor includes robot ID, map ID, x, y and yaw. Import restores the anchor
only for the matching robot; an anchor for a different map is rejected.

On a later session, Load uploads the complete cached map bundle before setting
the robot's map ID. Localization must succeed again before Return is enabled.
A metadata entry without its map files cannot activate navigation; the app no
longer relabels arbitrary robot-slot contents as that saved map.

The robot has one map slot; New Map overwrites it after backup. Saved maps can
coexist in the Mac browser. Import/export preserves A across browser profiles;
merely clearing browser data loses local maps and anchors unless exported.

## Validation status

Automated checks cover map/robot identity, origin capture, archive persistence,
localization freshness, navigation readiness, cancellation, no-path, timeout and
arrival tolerance. A Chrome test with mocked robot transport covers backup,
origin capture, hold/release driving, save, localization, sending A as a goal,
stop, and refusal to activate a map with missing files:

```sh
npm run check:anchor
# With npm run dev running separately:
node scripts/check-mapping-ui.mjs
```

The repository checks and production build passed during implementation.
Live on the user's Go2 Pro: WebRTC connection, pre-map backup, mapping start,
cloud display and capture of A were confirmed. A supervised room drive, actual
return, and map reuse after restarting remain to be completed. Do not describe
mocked goal tests as successful real-robot navigation.

Related: [data access guide](go2-pro-data-access.md),
[probe findings](go2-pro-data.md), [SLAM protocol](slam.md).


## Localization handover display fix

The original viewer appended frontend mapping poses and localization poses to
one continuous red trail, and continued rendering frontend odometry after mapping
stopped. A localization reset or changed estimate could therefore draw a straight
red segment even while the physical robot stayed stationary.

The viewer now renders frontend poses only during active mapping, renders
localization poses only while localization is active, and resets the trace and
marker smoothing at source/session transitions. The first pose starts a new
segment rather than connecting from the previous estimate or `(0,0)`.
Repeated/non-increasing localization timestamps do not refresh the position.

Initialization success alone no longer unlocks Return. Check the marker and
current scan against the room, then confirm its position in Step 2. A shift over
0.5 m from the last mapping position in the same map is highlighted for checking;
this is a heuristic notice, not a calibrated localization quality metric.
False matching, drift or map-frame differences still need diagnosis/correction;
clearing the rendered trail does not repair the estimated position.

A regression in `scripts/check-mapping-ui.mjs` reproduces a large stationary
handover jump, checks that no connecting segment is drawn, rejects late frontend
positions and verifies that unconfirmed localization cannot send a return goal.
