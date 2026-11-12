# Session handoff — 2026-11-06

User requested saving everything and pausing work. Do not start robot movement on resume without the user resuming the trial.

## Current outcome

Go2 Pro over authenticated local Wi-Fi WebRTC. Use legitimate APIs only: user explicitly prohibits jailbreak or firmware modification. Credentials remain in the local ignored `.env`; never print them.

Automatic mapping is Step 1 ONLY. Localization and return to A remain separate. Mapping/stop and partial map save completed after trial 6. Last read-only connection reported mapping/exploration inactive. Browser was subsequently closed; no new commands were sent.

**No autonomous walking success.** User observed a forward jolt without feet stepping during trial 6. The apparent 0.12 m position change is NOT verified physical travel. 35 Move(1008) requests at x=0.1 m/s, y=0, near-zero yaw were sent over ~1.7 seconds before a 750 ms LiDAR freshness stop. Do not count command transmission as execution.

## Changes saved

- Oriented body footprint and swept translation/rotation replace the requirement for an empty circular area. Forward 20–30 cm targets; turns only with checked sweep and forward corridor. Obstacles remain blocked.
- Operator checkbox verifies flat starting terrain, not absence of obstacles. User reports obstacle ~2 ft ahead, larger ~7 ft gap at 45 degrees left. Recheck current scene before using this information in a later trial.
- Scan-based floor plane fitting, sticky obstacles, fresh cloud/session checks, bounded movement, stop/save workflow.
- Battery reserve lowered to 10% at explicit user request. Start requires >10%; stop/save at <=10%. Last observed battery 31%.
- Initial stationary scan uses displacement/heading checks rather than raw velocity spikes. Raw 0.2 m/s speed check still applies before walking and while moving.
- Startup sends StopMove BEFORE two-second settling, avoiding a redundant stop immediately before scanning.
- Maps, anchor persistence, UI layout fixes, Parrot/audio, iOS changes and native Mac Point-LIO integration from earlier work remain in the working tree.

## Unresolved next work

Determine why movement requests cause a jolt without stepping: check active firmware motion mechanism, command acceptance/control ownership and readiness. Last stationary sport fields mode=0, gait_type=0, error_code=100, progress=0 are not proof of readiness. Capture mode/foot/joint state and command responses together in the next authorized trial. Do not increase speed, extend nonzero requests or change gait blindly. Also investigate intermittent cloud gaps; preserve stale-data stops.

## Evidence and validation

See `docs/exploration-mapping.md` for chronology and detailed design. Private ignored evidence: `output/point-lio/inspection/exploration-trial-1.json` through `exploration-trial-6.json` (trial 3 uses `exploration-trial-3-grid.json`), map backups and sensor reports. Actual current scan replay permits a forward step; it does not prove real-world clearance or walking.

Latest startup-sequence changes passed `npm run check:explore`, `node scripts/check-exploration-ui.mjs`, and `npm run build`. Full `npm run check` passed before the final startup-sequence adjustment. No subsequent hardware movement after the user's no-stepping report.

## Resume tools

Dev server uses `npm run dev` on http://127.0.0.1:5186/?desktop=1 . Ignored helper `output/point-lio/live-mapping.mjs` opens authenticated Chrome and supports diagnostics/capture/explicit UI commands; launching it connects but does not start motion. Keep it in a PTY if needed. Old session IDs should not be assumed usable. All work is saved locally, not committed or pushed.

## Opening preference (2026-11-07)

User wants the normal Drive screen (camera and movement/turn controls) when we open the app. Mapping is reached only by pressing the Maps navigation button. The local browser helper now opens Drive by default; `--mapping` explicitly opts into Maps. Do not automatically start mapping, exploration or a deferred Sit command.

## Desktop resizing fix (2026-11-07)

Desktop Drive no longer triggers the phone rotation prompt in narrow windows.
The control overlay scales to fit a 760x420 logical minimum, preserving bottom
alignment of both joysticks and actions. Native/phone preview orientation guards
remain. Joystick coordinates account for overlay scaling; resize releases held
input. `node scripts/check-drive-window.mjs` validates seven window sizes and
scaled pointer/knob alignment plus release on resize, without robot connection.
Screenshots in `output/drive-layout/` were visually checked. Build passed.

## UI restoration and map drawer (2026-11-07, latest)

User rejected the desktop control redesign. The desktop scaling experiment and
its test were removed; shell/joystick control behavior was restored from the
original committed layout. Default user launcher is now ignored helper
`output/point-lio/open-drive.mjs`, using the original automatically scaled phone
frame. Drive actions remain ALWAYS visible per the user's missing-buttons report;
Parrot work is preserved. The only new Drive control is Map. Earlier desktop
resizing notes above are superseded. `scripts/check-drive-restored.mjs` passed.

User then requested landscape Map with a full-width LiDAR canvas and a '<' side
drawer for directions. Implemented collapsed-by-default right drawer with a
chevron, inert hidden controls, Escape close, scrollable steps/saved maps/manual
controls and diagnostics inside details. Native and preview Map use landscape;
Drive layout unchanged. Reused the Drive VoxelMap decoder in an isolated display
layer to show the existing local processed LiDAR feed while idle; it is hidden
when SLAM/saved maps render and never enters exploration perception or poses.
Verified live visible LiDAR on Map without starting a mapping session or motion.
Current browser is open on Map for review (`open-drive.mjs --map`).

Latest validation: build, map-drawer test, exploration UI test, mapping UI test,
and saved-map layout tests pass. Screenshot `output/map-drawer/live-map.png` was
visually reviewed; open/closed fixture screenshots also reviewed. Mapping controls
now require clicking 'Open mapping directions' before interaction in UI tests.

User asked about Leash: code sends LeadFollow 2056 with data=true; no physical
Leash behavior has been tested. No Sit or Leash command was executed.

## Phone install (2026-11-07)

Latest web assets synced with Capacitor. User enabled Developer Mode on the wired
Alex's iPhone (iPhone 16 Pro Max). Generic signed build initially failed profile
validation; device-targeted Xcode build with provisioning updates and device
registration succeeded. `devicectl` confirmed installation and successful launch
of `com.mzhou.go2pocket`. Build output is under `output/ios-install`, with build
log `output/ios-build.log`. No robot actions were sent during installation.

## Connection audit + automatic discovery (2026-11-08)

Earlier attempts targeted saved IP 192.168.1.193 and used DOGID=Go2_6480 as a
serial. The IP's ports timed out/no-route and the targeted scans returned no
robot. Bluetooth scanning found advertisement Go2_64802, not the exact saved
name. Reading its manufacturer advertisement yielded full serial
GO2TEST000000001. A LAN query targeting that serial reported 192.0.2.20.
Bluetooth did NOT directly return an IP. `.env` now uses the discovered .197
address and the full serial in DOGID; AES key is unchanged and remains private.

The .197 service also temporarily timed out. A later probe showed port 9991
reachable and 8081 refusing connections; authenticated Drive then opened. The
available logs do not prove why reachability changed. Releasing the setup BLE
link occurred near the successful attempt; causation is NOT established.
Guest isolation, firmware readiness and local-network filtering are hypotheses,
not findings. I should have resolved the full identity earlier rather than
repeatedly using the display name for serial-targeted discovery.

Implemented automatic address resolution in `connection/auto-discovery.ts` and
`local-connector.ts`, validated-address caching, cancellation, ambiguity checks,
and two bounded rounds. Connect allows a blank local IP and shows progress.
Desktop scanning sessions are serialized to prevent multiple sockets on shared
UDP reply port from consuming each other's replies; this is a code issue fixed,
not proof that it caused every earlier failed scan. Connection UI also prevents
overlapping requests. Auth errors do not trigger blind discovery retries.

Tests: discovery unit checks, mocked actual-connector browser integration, full
npm check and build passed. Latest build includes the connection UI refinements.
Live recovery from deliberately entered old IP .193 is being checked separately;
only a saved automatic-discovery-live.json report confirms its outcome.

Live auto-discovery verification completed: `automatic-discovery-live.json`
records a start from old .193, serial-targeted resolution to .197, and successful
new-method service probing. No robot movement was requested. This report marks
`networkDiscoveryVerified=true`, `webRtcValidated=false`: it proves IP lookup,
not a completed WebRTC session. A full browser attempt after discovery reached
the WebRTC stage but reported connection failure. Authentication/connection must
remain distinct from discovery success. The final build and connector browser
integration test passed after cancellation callback guards were added.

Final browser connection check succeeded and opened Drive with the updated full
serial and .197 saved address. No robot motion commands were requested. The live
stale-IP discovery check and the successful final WebRTC connection are separate
runs; do not describe them as one uninterrupted run. Computer app is currently
connected. Latest changes have not been reinstalled on either iPhone.

## Speed control (2026-11-08)

Added Controls > Driving > Drive speed, 10%-100% in 5% steps, default 100%.
It persists locally and scales normal Go2 touchscreen/gamepad/Bluetooth relay
axes before wireless-controller publication. G1/R1 keep their original response.
Autonomous mapping/manual-map hold controls and actions/tricks are unchanged.
No hardware movement was used for testing. Browser mock transport tests verify
all three input paths, persistence, key bits and zero release. `npm run build`
and `node scripts/check-drive-speed.mjs` pass. The Controls screenshot under
`output/drive-speed/controls.png` was visually inspected. Phone app has not been
reinstalled with these latest changes.

## Supervised mapping + display (2026-11-09)

User confirmed Go2 at A on flat floor with supervision and remote stop. Connected
with 98% battery. Short automatic mapping trial received code=0 responses for
Move(1008); sample mode=0, gait=0, error_code=100. Foot position/speed fields were
all zero and must be treated as possibly unsupported, not proof of stillness.
Latest foot-force samples remained supported. Trial was stopped/saved before
further testing; diagnostics confirmed mapping=false, explorer inactive. Report:
`output/point-lio/inspection/trial-1794261190279.json`. User has not yet confirmed
whether feet actually stepped in this attempt. Do not claim walking success.

User then requested a larger phone preview and selected a 140% maximum after
seeing fit-to-window (~160%). `device-preview.ts` now caps the phone-frame scale
at 1.4 while shrinking when needed. Inner phone dimensions and Drive layout are
unchanged. Build and visual fit checks passed; 1440x1000 reports 140%.
Current diagnostic helper: `output/point-lio/mapping-trial.mjs --map`; it respects
the phone frame and only starts exploration after an explicit 'explore' command.

User requested removal of the 8-second no-progress cutoff on 2026-11-09.
Removed that independent cutoff and its progress bookkeeping. The per-target
25-second timeout remains. Exploration tests include holding the same pose past
8 seconds and verifying continued operation, then stop at 25 seconds. Build and
exploration checks pass. Sensor freshness checks remain enabled: user also asked
to remove the 0.75-second stop, but this was explicitly not implemented because
frozen pose would permit continued forward commands past a target. Discuss a
more tolerant sensor-pause/watchdog design rather than silently removing it.

## Latest attempt and 40% manual test (2026-11-09)

After removing the 8-second no-progress cutoff, a supervised run issued 500
Move requests (~25 seconds), acknowledged code=0, then stopped at the retained
25-second target timeout. User explicitly reported only leaning/jolting, no
stepping. The 0.18 m displayed travel is an estimator value, not physical walking.
Report: `output/point-lio/inspection/trial-1794262102779.json`. Stop Explore & Save
completed; diagnostics confirmed mapping=false, explorer inactive.

User requested 40% and clarified via the question tool: NORMAL DRIVE at 40%,
not automatic mapping at 0.4 m/s. No autonomous speed limit was increased.
Browser helper `open-drive.mjs --speed40` opens Controls, sets the normal Drive
slider to 40%, then closes Controls to leave the joysticks ready. User will test
normal driving. This does not establish automatic mapping works.

User now confirms normal Drive at 40% physically takes steps. This establishes
manual wireless-controller driving works; it does not establish speed alone
caused the difference from Move(1008), because both transport and input changed.
An instrumented normal Drive session is connected for a short manual repeat,
recording wireless input, sport telemetry, and low-state history. Mapping remains
stopped; no autonomous speed or motion was changed.

### Manual Drive measurement confirmed (2026-11-09)

User confirms physical stepping and proper stopping on joystick release. Captured
`output/point-lio/inspection/trial-1794263247833.json`: normal Drive published
`rt/wirelesscontroller` at ~20 Hz, with forward ly about 0.4 and near-zero lx
for roughly 0.5 seconds. No sport Move requests were sent in this manual test.
Measured horizontal speed peaked at ~0.387 m/s; following the first zero-input
packet it fell below 0.03 m/s at ~0.31 seconds and reported zero at ~0.45 seconds.
These are robot telemetry measurements for this trial, not a guaranteed braking
bound. Several other joystick directions were also used; this is not a full
calibration. Sport mode=0/gait=0/error_code=100 persisted during confirmed walking,
so those fields cannot by themselves distinguish walking from the previous lean.

Manual wireless control works, whereas prior autonomous sport Move x=0.1 did not
produce observed steps. Transport and input differ, so causation remains unproven.
The measured 40% speed exceeds the current autonomous 0.2 m/s guard. Do not simply
map 40% to 0.4 m/s or raise that guard without revisiting stopping distance and
clearance. No autonomous transport or speed changes were made during this test.

### Requested automatic mapping speed change (2026-11-09)

User explicitly requested automatic mapping at the approximately 0.4 m/s speed
seen in manual Drive. Updated the sport Move actuator cap and forward planner
request to 0.4 m/s (constant while advancing; stop rather than taper into the
previous low-speed lean). This is an SDK speed request, not a guarantee that
manual 40% and Move x=0.4 produce identical physical behavior. Manual slider,
yaw limit (0.25 rad/s), sensor freshness and footprint rules remain unchanged.
Measured overspeed cutoff is now 0.5 m/s to permit the requested speed.

Forward targets are 40–50 cm, with early braking at remaining distance below
0.08 + measuredSpeed*0.5 metres. Wait at least 600 ms and speed <=0.03 before
another target. Check a 0.73 m forward centre-path corridor, including full body,
for watchdog/control/braking allowance; select another heading if unavailable.
This conservative stopping allowance still requires physical validation.

Updated `exploration-motion.ts`, `mapping-explorer.ts`, `exploration-grid.ts`,
the exploration tests and `docs/exploration-mapping.md`. Build, check:explore,
and simulated browser Explore/start/stop/partial map+anchor save checks pass.
The new speed has NOT yet been physically tested. Instrumented Map helper
reopened for the next supervised trial; opening does not start mapping/motion.

### First attempt after speed change: unknown starting floor (2026-11-09)

Report `output/point-lio/inspection/trial-1794263603164.json`: zero Move requests,
zero travel, ended "Current body footprint is blocked or floor support is
unknown." Reconstructed the oriented body footprint from saved grid/pose:
45 cells total, 2 supported, 43 missing/unknown; no blocked obstacle cells in
that footprint. No verified-start cells were present. Floor plane was fitted
with 699 supporting points, so floor calibration succeeded but the LiDAR blind
area under the body lacked evidence. This failed before forward speed or the
new stopping-corridor check was used. Mapping stopped and saved a partial map.

### Explicit LiDAR timeout override (2026-11-09)

User rejected pausing as well as terminating on short LiDAR gaps and explicitly
requested five minutes without new LiDAR before stopping. Implemented a
300000 ms cloud timeout in MappingExplorer, with NO pause for shorter gaps.
Existing map cells remain in use; this means new obstacles during a cloud outage
are not detected until scans resume. Initial scan, floor/obstacle checks,
pose/motion freshness, 25-second goal and 120-second total budgets remain.
The total budget normally expires before the LiDAR timeout. No pause/resume
implementation was applied. Tests explicitly assert forward requests continue
through 751 ms, 1500 ms and 5000 ms cloud gaps and fresh scans are accepted again.
check:explore passed; production build being checked. Latest live attempt had
33 Move requests and 0.60 m estimated travel, then the old LiDAR timeout fired;
no physical stepping confirmation yet. Captured
`output/point-lio/inspection/trial-1794263748728.json` before reload.

### Supervised run with flat-floor enabled (2026-11-09)

User requested starting Explore with flat-floor confirmation. Cleared the previous
onboard mapping state using Stop & Save, then started new map
`0MmP6SVyR6839K-b_mJbWA`. Live telemetry reached ~0.322 m/s, 17 Move requests;
controller ended at ~0.30 m estimated travel and saved partial map+anchor.
No physical foot-step confirmation yet. Stop was body-footprint occupancy, NOT
LiDAR age: report `output/point-lio/inspection/trial-1794264143792.json` has
277 verified starting floor cells; final footprint has 52 clear cells and one
blocked cell. Its centre is ~20 cm forward, ~15 cm right of final pose. Latest
scan includes point (0.508,-0.107,0.026), ~7.5 cm above fitted floor, within that
cell; obstacle rule is >5 cm above floor. Could be object/body/noisy return;
source not established. Obstacles are sticky, so a single classified return can
block this cell even when other scans in it show floor. Do not erase it or claim
it is definitely the robot's leg without evidence.

### Obstacle evidence threshold (2026-11-09)

User requested more than one point before marking an obstacle, suspecting the
front-right return was a foot. Changed above-floor obstacle confirmation to
three distinct 5 cm voxel returns in the same 10 cm XY cell in ONE scan. Same
voxel duplicates/jitter count once; evidence does not accumulate across scans.
Confirmed cells remain sticky, floor stays unknown without evidence, and a
possible below-floor drop still blocks immediately. Height band remains >5 cm
and <1.2 m; no blanket exclusion of the robot footprint or real obstacles.
Density filtering can miss sparse objects and does not identify robot legs.

Build and check:explore pass, including noise/duplicates/repeated lone returns,
two-versus-three distinct points, sticky clusters, unknown floor and drop checks.
Replayed the latest recorded cloud with the same floor plane, grid origin and
verified starting terrain: prior failing cell (5,-1) is no longer blocked and
final body footprint is clear. This is a single-scan replay, not proof that all
previous scans or physical exploration will pass. No new movement was started.

### Five-return threshold and requested live run (2026-11-09)

User requested "5 in 10 then run it": raised threshold to FIVE distinct 5 cm
voxel returns within the same 10 cm cell in a single scan. Updated fixtures and
tests: four points do not block, five block; duplicates, lone noise, drops and
sticky confirmed obstacles still covered. Build and check:explore pass.
Reconnected and started Explore with flat-floor confirmation enabled from the
current position, map ID `NdHxwcSLChhxZrvMKlUAsw`. Initial floor calibration
succeeded. Awaiting live outcome; no physical walking claim yet.

Five-return live run outcome: ten sport Move requests at x=0.4, then measured
horizontal velocity peaked at 0.5171 m/s, tripping unchanged 0.5 m/s guard.
UI travel at stop ~0.09 m (not physically verified). Occupancy/density and
LiDAR timeout did not cause this stop. Report:
`output/point-lio/inspection/trial-1794264813540.json`. Issued Stop Explore & Save
to finish the stationary mapping session. No further speed-limit changes made.

### Doubled overspeed cutoff (2026-11-09)

User requested doubling the speed limit after the 0.517 m/s stop. Changed
EXPLORE_MEASURED_SPEED_LIMIT from 0.5 to 1.0 m/s; requested forward speed remains
0.4 m/s. Existing stopping-corridor formula now yields 1.38 m from body centre;
expanded bounded sweep support to 1.5 m so that corridor can actually be checked.
This requires more observed clear floor ahead and can change available routes.
No physical guarantee of stopping within that envelope is claimed. Build and
check:explore pass, including allowed 0.52 and exact 1.0 samples, stop above
1.0, unchanged 0.4 request, and updated corridor. No new live run started.

### Corridor correction requested (2026-11-09)

User explicitly rejected increasing required clear distance to 1.38 m when the
speed cutoff changed. Restored EXPLORE_STOP_CORRIDOR to an independent fixed
0.73 m, and sweep cap to its previous 1.0 m. Measured-speed cutoff remains
1.0 m/s; forward request remains 0.4 m/s; five-return density and five-minute
LiDAR timeout remain. Corridor no longer scales with the measured-speed cutoff.
Docs clarify it is not a guaranteed stopping bound at that cutoff. Updated
regression asserts 0.73 corridor alongside 1.0 cutoff and unchanged .4 request.
check:explore passed. No movement started.

### Latest run: below-floor return (2026-11-09)

User requested run with 1.0 m/s cutoff and 0.73 m corridor. Cleared a prior active
onboard session with Stop & Save, then started flat-floor-confirmed map
`oOt0wOd7LVSwz54IT5XawA`. Issued 33 Move requests; estimated travel 0.55 m.
Controller stopped/saved partial map due to current footprint. Report:
`output/point-lio/inspection/trial-1794265694020.json`.
Final footprint: 53 clear cells, one blocked cell, centre ~36 cm ahead and
12 cm LEFT, cell (9,2). Latest cloud in that cell has heights -0.084 and -0.048 m
relative to fitted plane. The -8.4 cm return triggers the separate immediate
possible-drop rule (<-8 cm); the five-point rule only applies ABOVE floor.
Since obstacles are sticky and intermediate clouds were not all captured, do
not claim that this latest return proves the original trigger or a real hole.
No actual drop or physical stepping confirmation established. No thresholds
changed after this run.

### Half-foot possible-drop threshold (2026-11-09)

User requested a drop must be half a foot rather than 8 cm. Updated the separate
DROP_MIN_DEPTH_METRES constant to 0.1524 m (15.24 cm), inclusive depth cutoff.
Smaller negative returns are ignored as drop evidence, not reclassified as free
floor. Existing floor/verified terrain is still necessary. Tests cover 8.4 cm,
10 cm, just below cutoff and just above cutoff; build/check:explore pass.
Replay of latest captured scan using original plane/origin and verified start:
previous failure cell (9,2) is unblocked and final body footprint clear. Does not
prove earlier clouds or a new physical trial will pass. Other limits unchanged;
no new automatic motion started.

### Faster turns plus five-second drop recheck (2026-11-09)

User requested turning "like 40%" and, while working, added that suspected drops
should wait five seconds and be checked again before ending. Implemented SDK
yaw cap 0.4 rad/s (~23 deg/s), previously 0.25. Explained this is a turn-rate
request, not calibrated joystick percentage. Shared EXPLORE_YAW_RATE is used
by planner and actuator; taper near target retained. Forward speed unchanged.

Drop candidates are separate from sticky occupied cells. A relevant pending
candidate stops movement immediately while mapping continues. Same-cell fresh
scan evidence at least 5000 ms after first detection confirms (still >=15.24 cm
below floor -> stop/save partial map) or clears (floor/shallower return -> settle
and replan). Missing cloud or a cloud elsewhere never authorizes resume. Original
turn sweep is remembered when pausing resets the movement goal. Total budget and
other safety checks remain. Above-floor obstacle density stays five per cell.

Build and check:explore pass; tests cover early floor scans before five seconds,
cleared resume, persistent confirmation/save, no-cloud and unrelated-cell waits,
retained rotational sweep, faster yaw cap and target taper. No new live test of
these two changes has been started. Prior browser run had timed out at25 seconds,
~1.15m estimated travel; captured
`output/point-lio/inspection/trial-1794266103067.json`. Stopped existing mapping
and closed live browser before code changes; no physical movement claim made.

### Turn cap 0.5 rad/s and requested run (2026-11-09)

User requested 0.5 rad/s turning and running on confirmed good floor. Updated
shared yaw cap from .4 to .5 in planner+actuator; regression/JSON boundary tests
and build pass. Cleared previous onboard mapping session, reconnected, enabled
flat-floor confirmation and started map `1U46d4j_9efI8Va3CcrZkg`.
Run emitted 123 Move requests and estimated 2.23m travel, then stopped with
"Forward stopping corridor is blocked or unknown." No full-room coverage or
physical step/turn confirmation claimed. Captured
`output/point-lio/inspection/trial-1794266746933.json`; requested Stop Explore &
Save to finish stationary mapping. Forward speed .4, measured speed cutoff1.0,
clear corridor .73, five-point occupancy, half-foot drop and five-second fresh
recheck behavior remain unchanged.

### Five-inch objects, five-second recheck, keep exploring (2026-11-09)

User clarified obstacle height is FIVE INCHES (12.7 cm), and requested a five-second
motion pause plus fresh recheck, then exploration of other unvisited parts of the
room even when an obstacle remains. Implemented OBSTACLE_MIN_HEIGHT_METRES=.127
with existing five-distinct-returns/10 cm cell density. Cells below this height
are not promoted as above-floor obstacles; they are not manufactured free floor.

Above-floor candidates now have independent pending/confirmed evidence, sharing
geometry/recheck behavior with drops. Relevant pending hazards immediately send
StopMove; a full five seconds from first movement pause must pass, then a fresh
same-cell scan confirms or clears. Missing scans or scans elsewhere do not clear.
Confirmed above-floor obstacles become sticky map cells, and the controller
settles/replans to another checked unvisited view rather than ending the run.
Changed forward corridors (including unknown terrain) now stop/replan instead of
immediate termination. No checked alternative for three seconds still ends/saves;
a blocked current footprint or disrupted checked return connectivity can also end.
Confirmed drops retain the previously requested stop/save behavior.

Changes: exploration-grid.ts, mapping-explorer.ts, tests and exploration docs.
Build/check:explore/browser Explore+save integration pass. Regression cases cover
height just below/above five inches; full five-second hold even for a prior sighting;
confirmation/clearance; no blind resume; turn away from wall then resume forward;
unknown forward floor -> checked side turn; all routes blocked -> partial save.
Walking .4 m/s, yaw .5 rad/s, measured-speed cutoff1.0, corridor .73m unchanged.
Previous run stopped/saved and idle confirmed before edits. These new behaviors
have not been tried on the physical robot; no new movement was started.

### Turn stopped near 30 degrees: taper stall and timeout (2026-11-09)

User physically observed a turn of about30 degrees then a stop. Live diagnostics
for map `LEe97CzchXJ4trUgSHV-4g` report "Movement target timed out (25 seconds)"
with 500 Move requests, all x=0. Captured
`output/point-lio/inspection/trial-1794267383387.json`.
First turn request z=.5; ~2.5s z=.273; by5s z~.198; commands then stayed~.20 for
remaining20s. Sport IMU yaw initially2.77rad, then wrapped to~-2.925 at5s and
stayed~-2.922 through25s. Map yaw ended~.568rad and remaining turn command~.204rad
(~12deg). Evidence supports slowing into an ineffective turn range and stalling
short of the intended~45deg target, then actual shutdown by25-second goal timeout.
IMU/global yaw and map yaw use different origins; do not mix them directly.
No obstacle/drop/LiDAR stop was recorded. Do not claim a30degree hard limit.
No turn-control change made in response to the diagnosis yet; likely needs
minimum effective turning input plus measured angular braking, not merely a
longer timeout or higher max cap. No new motion started.

### Minimum turn rate (2026-11-09)

User suggested min0.3or0.4. Selected 0.3 rad/s minimum for in-place turns, retaining
max0.5 and existing stop at heading error<0.08rad. Small forward heading corrections
remain proportional. Shared EXPLORE_MIN_TURN_RATE=.3; only planner uses lower bound
because transport must still allow zero/StopMove and small walking steering.
check:explore passes including both signed45deg turns with a simulated low-input
deadband, target stop, and unchanged small walking steering. Actual physical
minimum and overshoot remain unverified. Prior timed-out mapping was stopped/saved
and idle confirmed before edits. No new automatic motion started.

### Removed accumulated translation stop during turns (2026-11-09)

User requested not stopping for "Go2 translated unexpectedly while turning."
Removed the independent >8 cm translation guard. Update active turn target XY
to current pose before body/sweep checks; preserve original heading and goalAt.
No forward velocity is requested to undo drift. Other guards, including per-sample
pose jump, body/sweep validity and target timeout, remain. No live run started.

check:explore passes, with regression accumulating20cm drift in4cm increments,
continuing turn to heading tolerance, retaining target/timer, and still pausing
for an obstacle at the shifted pivot. Prior failed run was captured as
`output/point-lio/inspection/trial-1794267726433.json`, then stopped/saved and
idle confirmed before source edits. Build checked separately.

### Completed supervised run and faster turn bounds (2026-11-09)

Run `6tS5SvA7MjPPJ7EEh_QEdw` continued through turns and forward steps, including
replanning after a changed forward corridor. User stopped it via UI; controller
recorded 4.50m estimated travel and saved partial map+anchor. Capture:
`output/point-lio/inspection/trial-1794268069580.json`. This is not a claim of
full-room coverage or calibrated physical travel.

User then explicitly requested min yaw .4 and max yaw .6 rad/s. Updated shared
constants, tests and current documentation; walking remains .4m/s and corridor
.73m. Simulated signed-turn/deadband, drift, small forward steering and actuator
boundary/JSON regressions pass. Build checked separately. Browser reopened with
updated code; no new live movement started under the new yaw settings.

### 30 m budget, bypass rechecks, and map-wide exploration (2026-11-09)

User says the latest trial reached five-metre cap and requests 30m, no five-second
rescan wait when a turn is available, and searching mapped empty areas when local
choices are exhausted. Confirmed latest report (`u7G-PGoCVTggd8ynwOX5qg`) ended
"Exploration budget reached" at5.03m estimated travel; stopped/saved. Captured
`output/point-lio/inspection/trial-1794268584087.json` before edits.

Implemented shared exploration-limits.ts: cumulative travel30m, total600000ms
(ten minutes, explicitly explained because two minutes constrains longer travel).
Starting-terrain evidence expiry and UI limit text updated to same time budget.
No walking/yaw/speed-cutoff/corridor/density/height/depth changes in this turn.

Pending obstacle OR drop: first seek a checked turn and checked exit corridor
that exclude ALL pending/confirmed hazards, allowing a previously visited heading
for escape. If found, short brake/600ms settle then turn, skipping five-second
rescan. If no such turn exists, existing five-second fresh same-cell recheck stays.
Confirmed relevant drops still stop/save. Candidate under body blocks all turn
sweeps, so is not ignored to force motion.

Added exploration-frontier.ts: bounded incremental orientation-aware map search
through known clear floor.30cm lattice/eight headings, checked translational/
rotational sweeps and forward corridor,2500 expanded-state cap,~8ms per control
slice. Unknown cells never treated as free. Prefers physically unvisited places
near unknown map edges; unvisited known free locations and novel views fallback.
Search can cross visited space; target retained across short actions and replanned
from updated pose. Search restarts if its start pose drifts>8cm/0.08rad. Movement
is stopped during search; actual first action rechecked before publishing.

Controller falls back to this search when local views exhausted; only saves for
no route after bounded global search too. Still cannot promise full coverage,
resolve incorrect pose/floor estimates, or fit all narrow passages at lattice
resolution. Existing ±10m grid bound unchanged (30m is cumulative travel).

Build/check:explore/browser mapping-save integration PASS. Added tests:30m vsold5m
and10min limit, full five-second wait fallback when no bypass, immediate checked
obstacle/drop bypass, global route through visited floor, L-shaped passage and
closed-loop arrival around corner, wall separating unreachable target, unknown
floor blocked, physically unvisited target preference, search pose consistency,
user cancellation. No new physical trial of these features started; browser
reopened with new code for next supervised trial.

### Nearby live display plus accumulated room map (2026-11-09)

User approved combining the live display for nearby surroundings with accumulated
room map planning. Implemented a separate lower-left Nearby LiDAR pane rather
than an unverified coordinate overlay: both feeds may call their frame `odom`
but can reset origins independently. Explained this UI choice during work.

New MappingLiveView component lazily imports/reuses Drive's Scene3D+VoxelMap,
consumes compressed local voxel data and local robot_pose (actual PoseStamped
shape confirmed in sensor-report.json; also accepts nested Odometry), and never
passes local data/pose into explorer or main SlamScene. App caches receive times
and local pose across navigation, clears caches on disconnect, and seeds new Map
views without falsely refreshing old timestamps. Current movement settings and
mapping perception remain unchanged.

Pane shows when mapping/loaded map is active; idle Map without a saved map keeps
its existing full live view without duplication. Collapse and directions drawer
suspend rendering. Stale after2s dims/labels last display, with no motion effect.
Reuses same scene code with compact camera framing (no joystick padding) only
for this pane. Default Drive camera framing preserved. New scene.setActive
supports rendering suspension; destroyed pane releases renderer/worker/timer.

Build, existing map-drawer check, camera-framing regressions and new browser
check pass (final app-feed assertions checked separately). Added npm script
check:map-live, requires dev server. Synthetic geometry screenshots at
output/mapping-live-view/{1440,852,667}.png visually inspected: pane/header,
legend and drawer fit phone and desktop. New browser check validates app feed
routing, map/local pose isolation, only SLAM scan reaching explorer, PoseStamped
and nested pose parsing, collapse/drawer pause, stale display and cleanup.
No automatic run was started for this UI change. Live browser had been closed
by user before work; helper exited. Native iPhone app not reinstalled.

Publication note: robot identifiers and the current local IP above have been replaced with test values. Runtime credentials remain in the ignored `.env`.

## Unified automatic mapping (2026-11-11)

The working DimOS source is now pinned under `vendor/dimos` in this repository,
including the no-target-deadline frontier fix. `npm run mapping:setup` installs
its isolated Python environment. `npm run dev` serves the app and the owned local
mapping process API. Home → Maps opens the integrated controls and Three.js viewer.
See `integrations/dimos/README.md` for the exact workflow and limitations.

The last 46-keyframe live map was copied into the ignored `output/mapping` library
and can be viewed/downloaded in the app. Original recordings/maps remain intact.
The integration was verified using replay, not a new physical robot trial.
Native iPhone mapping-engine execution and DimOS return-to-anchor are not implemented.
