# Explore & Map: Step 1 only

An experimental controller now automates short mapping trials on a flat floor.
It uses the existing authenticated Go2 WebRTC connection and onboard mapping
service. It never starts localization, navigation, patrol, charging or return to A.
No jailbreak, firmware changes or robot-side installation are involved.

## Controls

Open Maps, then Step 1: Mapping. With Go2 at the desired A:

- **Explore & Map (experimental)** backs up the robot's current map, starts a
  new mapping session and captures A. It waits for fresh pose, battery and motion
  telemetry, then requests a stop and observes the room for five seconds.
  Mapping startup can stand the robot up. After the scan, the controller may
  automatically issue walking/turning commands.
- **Stop Explore & Save** stops exploration and saves the map in place. It does
  not return to A. A new map is saved with a name beginning `Explore - partial map`.
- Manual Drive cancels autonomous exploration before taking control; mapping can
  continue manually. Page close, app suspension, blur and visibility loss cancel
  exploration. These interruptions stop its commands but do not automatically
  finish the mapping service; use Stop & Save after recovering control.

Initial trials require supervision and a flat floor without steps or holes. A one-metre empty circle is not required; each proposed movement needs enough space for the body and its swept path. The controller has been tested with simulated sensor/transport input and
live trials on this user's dog. Previous 0.1 m/s requests only caused leaning;
manual Drive at 40% produced confirmed steps. The new 0.4 m/s autonomous request
still needs physical validation.
It is not ready for unattended room exploration or stairs.

## Implemented limits

| Limit | Current behavior |
| --- | --- |
| Requested forward speed | 0.40 m/s while walking, zero to brake; no autonomous reverse or strafe |
| Requested yaw rate | In-place turns: 0.40–0.60 rad/s (about 23–34°/s); stop within 0.08 rad of target. Walking steering remains proportional |
| Measured speed | Stop above 1.00 m/s |
| Startup | Must be nearly stationary (at most 0.03 m/s); stop if moving during initial scan |
| Time budget | 10 minutes, including scanning and route search |
| Travel budget | 30 m of accumulated position changes, filtering changes below 2 cm |
| Battery reserve | Stop and save at 10%; startup requires more than 10% |
| Tilt / height | Stop above 0.2 rad roll or pitch, or outside 0.2-0.5 m body height |
| Position / motion age | Stop after 750 ms without a fresh accepted pose or motion sample |
| Battery age | Stop after 2 seconds without a battery update |
| Cloud age | Continue using the last map without pausing during gaps; timeout after 5 minutes without a usable cloud. A first usable scan is still required |
| Floor evidence | Observed floor persists during the bounded session; existing observed cells remain usable during LiDAR gaps. Explicitly verified starting terrain expires after 10 minutes |
| Position discontinuity | Stop for a single accepted XY step above 25 cm or yaw step above 0.35 rad |
| Target timeout | Stop after 25 seconds on one goal; the separate 8-second no-progress cutoff was removed at user request |
| Planning work | Bounded searches; stop if a goal computation exceeds a 250 ms freshness budget |

The controller checks a 73 cm forward stopping corridor from the body centre,
including the full body footprint along it. This distance is configured separately
from the 1.0 m/s measured-speed cutoff, as explicitly requested by the user.
It is a planning margin, not a guaranteed stopping bound at that cutoff.
Unknown floor and obstacles still block it. The planner considers other headings
if that corridor is blocked. It sends stop when remaining target distance is below
8 cm plus half a second of measured speed, then waits at least 600 ms and for
speed to fall to 0.03 m/s before the next step. The manual Drive slider does not
change automatic mapping speed.

The speed values are requested limits and telemetry checks, not verified physical
speed guarantees. A client stop needs a functioning client, network and robot.
The controller cannot guarantee a physical halt after network/process failure.
Keep the physical remote available during trials.

## Perception and exploration

[`exploration-grid.ts`](../src/ui/exploration-grid.ts) builds a bounded 10 cm grid
around the exploration origin. Input is the decoded **current scan**, not the
accumulated rendering cloud. This avoids refreshing old map points as if they
were newly observed.

The input path is `rt/uslam/frontend/cloud_world_ds` -> the existing SLAM WASM
worker -> `directOutput` Float32 XYZ positions. Worker results carry the mapping
session ID, the packet's host receipt time and its frame. Only the current
session's `odom` cloud is admitted; automatic poses also require `odom`,
`base_link`, and advancing structured robot timestamps. Pose timestamps are used
for liveness, not a claim of synchronized clocks.

The controller fits a near-horizontal floor plane to current scan points below
Go2. It requires broad spatial support around the robot and rejects unsupported
planes; sport-state body height alone is not treated as the floor reference.

- Actual returns within 5 cm of the plane mark floor. Missing cells stay unknown.
  The optional starting-floor checkbox supplies operator evidence of flat terrain
  within one metre of A for this trial only; it does not declare that area empty.
  Detected obstacles always take precedence over that floor evidence.
- A possible drop is a return at least 15.24 cm (half a foot) below floor.
- An above-floor obstacle needs at least five distinct 5 cm voxel returns at or
  above 12.7 cm (five inches), and below 1.2 m, in the same 10 cm column in one
  scan. Duplicates and isolated returns accumulated across scans do not count.
- A suspected obstacle or drop first tries an already checked turn with a checked
  forward corridor, treating all pending hazards as blocked. If such a turn
  exists it brakes briefly, then turns without the two-second wait. Otherwise
  a suspected obstacle or drop along the movement sweep pauses for two seconds. A fresh observation of the same cell after that wait must
  confirm or clear it. Missing scans or scans elsewhere cannot clear it.
  Confirmed drops end the run and save a partial map. Confirmed obstacles remain
  blocked, and the planner tries another checked, unvisited direction. A cleared
  suspicion lets it settle and plan again. A blocked current body footprint or
  no checked alternative can still end the run. Lower returns are not silently
  reclassified as free floor. Density filtering can miss sparse obstacles; this
  is not a robot-leg identification filter.
- Movement uses an oriented rectangular footprint: 70 by 31 cm body dimensions,
  plus 5 cm clearance on every side and 7.1 cm grid-cell uncertainty. A forward
  step requires its translated footprint to fit; it does not require a free
  turning circle. Turning requires the complete rotated body sweep to fit.
- The planner prefers checked straight targets 40-50 cm ahead. Otherwise it
  considers turns of 45, 90 or 180 degrees with a checked forward corridor after
  the turn. It samples sweeps every 2.5 cm or 5 degrees. Unknown terrain blocks
  movement; it never moves merely to discover whether a gap is clear.
- A sequence of checked poses maintains a connection toward A without assuming
  room for a full rotation at every point. This does not command return to A.

This is a frontier heuristic over processed point clouds, not a certified
traversability map. Thin/low obstacles, reflective surfaces, occlusion, floor
misclassification, pose drift and moving objects can still defeat it. Sparse
floor returns can make it stop immediately. Unknown space and no reachable
frontier are not proof that the entire room has been mapped.

## Stop and save outcomes

Normal budget exhaustion, a user stop, or no further sufficiently observed floor
ends with a zero/StopMove command, a short settling interval and `mapping/stop`.
The existing map-ID confirmation flow then saves PCD/PGM/TXT and A in the Mac's
browser storage without a naming prompt. Coverage is always labeled partial.
File-transfer or map-ID failure still needs recovery; the controller must not
claim that a failed transfer produced a reusable saved map.

Pose/session changes, stale position/motion telemetry, tilt, overspeed, a blocked corridor, transport
failure or the 25-second target timeout interrupt exploration and leave mapping stationary for
inspection. They do not automatically advance to Step 2. If startup is cancelled
while a backup is pending, late completion cannot arm exploration or start a new
mapping process afterward.

Motion uses the Go2 sport API's `Move` request (1008, JSON `{x,y,z}` for forward,
sideways, yaw rate) and `StopMove` (1003). No motion-mode switching is performed.
Stop requests use the existing priority option. See the primary implementations:
[Unitree sport client](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/go2/sport/sport_client.py)
and [WebRTC movement example](https://github.com/legion1581/unitree_webrtc_connect/blob/master/examples/go2/data_channel/sportmode/sportmode.py).
Actual behavior in the active Go2 Pro motion mode remains to be tested.

## Verification and files

- [`mapping-explorer.ts`](../src/ui/mapping-explorer.ts): controller, budgets,
  pose/telemetry checks, movement commands and stop outcomes.
- [`mapping-page.ts`](../src/ui/components/mapping-page.ts): Step 1 controls,
  backup/start cancellation, worker provenance, manual takeover and auto-save.
- [`app.ts`](../src/ui/app.ts): fresh sport/battery telemetry and Go2-only connection gate.
- [`exploration-motion.ts`](../src/ui/exploration-motion.ts): actuator bounds,
  emergency-stop/connection checks, Move encoding and priority stop requests.
- [`slam-worker.ts`](../src/workers/slam-worker.ts): provenance propagation and
  cloud-size/bounds validation before decoding into fixed WASM buffers.

```sh
npm run check:explore
npm run check
npm run build
# With npm run dev already running:
node scripts/check-exploration-ui.mjs
node scripts/check-mapping-ui.mjs
node scripts/check-map-layout.mjs
```

Tests use synthetic floor/obstacle data and simulated transport. They cover a
closed-loop moving robot model, unknown floor, clearance, drops, obstacles,
freshness, session isolation, pose jumps, budgets, command failure, stop/save,
pending-start cancellation, map+anchor persistence and Step-1-only commands.
Desktop and phone screenshots are inspected separately from logic assertions.


## First live trials (2026-11-06)

The user confirmed Go2 was at A on a clear, flat floor, with supervision and
physical stop available. Existing localization/navigation services were stopped
before the trials. Normal map backup and A capture succeeded.

- Trial 1 stopped during its initial scan on the reported-speed limit. The
  user observed only stand-up/no walking. Recorded sport requests contained
  zero Move (1008) requests and two StopMove requests. A partial map was saved.
- A two-second continuous posture/speed settling gate was added and tested before
  the initial scan; runtime limits were kept. Trial 2 passed that gate but stopped
  on the tighter stationary-scan speed check. Again, zero Move requests were
  recorded; stop/save completed.
- Trial 2 captured 1,169 sport-state samples: median horizontal reported speed
  approximately 0.0075 m/s, 95th percentile 0.0161 m/s, peak 0.0745 m/s. These
  are estimator values during a user-observed stationary trial, not measured
  ground-truth movement. Single-sample stationary gating needs further work.
- An offline check of one captured 1,896-point decoded cloud found 809 points
  within the configured floor band. Nevertheless, around the current body
  footprint only four grid columns were floor, 15 were blocked and 70 unknown;
  no checked next viewpoint was found. This was a single-packet replay using
  the captured pose/body-height estimate, not a full accumulated live grid.
  Self-returns, occlusion, floor-height assumptions and actual nearby obstacles
  still need to be distinguished. Do not clear these cells or widen thresholds
  merely to force movement.

The real robot therefore has **not** autonomously explored a room. Next work is
stationary-state estimation and perception validation using captured data, before
another supervised motion trial. The partial maps do not establish room coverage.
Private evidence: `output/point-lio/inspection/exploration-trial-1.json` and
`exploration-trial-2.json`. The latter includes decoded XYZ points and motion
samples. No device credentials are included.

## Directional clearance correction (2026-11-06)

Trial 3 passed the stationary scan but the former circular clearance check stopped
it before any walking command. The accumulated grid contained two blocked cells
behind/to the side; the user confirmed an immovable nearby object. Those cells
were preserved. Replaying the same captured grid with the oriented body footprint
allows a 30 cm forward target. Synthetic tests cover forward travel beside an
object, an unsafe turn there, a safe turn after moving clear, and an obstacle
ahead blocking travel. Replay and simulated tests do not establish live walking
success or complete room coverage.

After the directional-clearance change, the live WebRTC connection was restored.
Go2 reported 35% battery, exactly the reserve configured at that time. Mapping and exploration
remained stopped; no new movement trial was started. The next physical test
requires charging above the reserve. Full `npm run check`, `npm run build`, and
`node scripts/check-exploration-ui.mjs` passed. The updated geometry remains
physically unvalidated; its captured-grid replay is not a walking result.

The user subsequently requested a 10% reserve. Startup now requires more than
10%; running exploration stops and saves at 10% or below. The UI and boundary
tests use this updated threshold. This is an app limit, not a robot firmware change.

Trial 4 used the updated 10% reserve and directional planner. Mapping started at
34% battery, but a sport-state velocity sample reported approximately 0.2535 m/s
about 110 ms after the initial StopMove. The controller stopped before receiving
its first accepted floor grid and before any Move (1008) request. Two StopMove
requests were recorded. Stop Explore & Save then completed and services became
idle. Physical motion during this event was not yet confirmed by the user;
there is no verified autonomous walking result. Private evidence is
`output/point-lio/inspection/exploration-trial-4.json`. Do not infer physical
motion solely from that reported velocity, or disable the speed guard to force
progress.

The user confirmed no physical movement during trial 4. Around the 0.253 m/s
spike, sport-state position changed approximately 0.54 mm across a 49 ms robot
timestamp interval. This supports an estimator transient, rather than proof of
real travel at that speed. Offline replay of trial 4's last scan established a
supported floor plane and a checked 30 cm forward target with obstacles retained.
The initial five-second stationary scan now uses its existing 5 cm displacement
and 0.1 rad heading-change checks rather than the raw 0.2 m/s velocity threshold.
That raw speed threshold remains mandatory after the scan, including before the
first walking command. Startup still requires the two-second settling gate.
Tests cover the captured spike magnitude, scan displacement, and rejection of
the same speed before walking; build and exploration checks pass.

Trial 5 established a floor grid and its replay permits a short forward target,
but the stationary scan stopped for a 5 cm pose change before any Move request.
Stop/save completed. Evidence: `exploration-trial-5.json`. Inspection found the
startup sequence sent StopMove *after* waiting for stability. Startup now sends
its stop before the two-second settling gate and avoids a redundant stop when
the scan begins. Standalone controller callers still send an initial stop by
default. Exploration tests, UI tests, and build pass after the sequence change.
The transient's exact robot-side cause is not established; this is a sequencing
correction, not evidence that walking now works.

Trial 6 passed startup and emitted 35 Move (1008) requests. Its mapping position
estimate accumulated approximately 0.12 m before the live-cloud freshness guard
stopped exploration. The subsequent latest cloud was fresh again; this does not
undo the intervening stale-data stop. Physical steps still require user
confirmation. Stop Explore & Save was requested and the report retained as
`exploration-trial-6.json`. Do not equate command emission or pose change with
verified physical walking or a completed autonomous map.

The user confirmed trial 6 produced only a forward jolt, with no feet stepping.
It is NOT a successful walking trial. The 0.12 m estimate must not be described
as physical travel. Requests were 1008 with x=0.1, y=0, near-zero yaw at 20 Hz for
approximately 1.7 seconds, followed by StopMove. A subsequent stationary,
read-only telemetry check reported mode=0, gait_type=0, error_code=100,
progress=0; this is not a verified command-readiness signal or the state during
the failed attempt. Walking command acceptance, active control ownership and
firmware behavior remain unresolved. Do not raise speed, extend nonzero requests
or switch locomotion modes merely to force movement.

Unitree SDK source defines Move separately from SwitchGait; a command being sent
must not be equated with stepping. Related unverified user reports discuss a
StandUp-to-Move delay: https://github.com/unitreerobotics/unitree_sdk2_python/issues/175 .
This is corroborating troubleshooting context, not confirmation of the cause on
this Go2 Pro. No additional movement was attempted following the user's report.

## LiDAR gap behavior (2026-11-09)

At the user's explicit request, the former 750 ms LiDAR abort is now a five-minute
timeout. There is no pause or automatic stop solely for shorter cloud gaps;
existing observed floor and obstacles remain in use. Changes to obstacles during
such gaps cannot be detected until a new usable cloud arrives. Position and
motion telemetry still require updates within 750 ms. An initial accepted cloud
and supported starting footprint remain prerequisites. The trial budget is now ten minutes; the five-minute LiDAR-loss timeout can
therefore be reached during a run. Individual goals still have a 25-second timeout.

## Drop recheck and turn speed (2026-11-09)

A drop candidate along the current body or planned movement sweep first tries
a checked turn that avoids the candidate. If no bypass fits, it pauses actuation
for the recheck. It is separate from a permanently blocked obstacle until
a fresh observation of the same cell at least two seconds after the movement pause starts.
Persistent returns at least half a foot below floor confirm the drop and stop/save
the run; shallower or floor returns clear the suspicion without manufacturing
new floor evidence. The total time budget and other telemetry/tilt limits remain
active while waiting. No observations of the suspect cell means it keeps waiting,
not that the path is safe. The original turn sweep is retained during this wait.

Automatic yaw requests are capped independently at 0.6 rad/s in the controller
and actuator. This is not a calibrated 40% joystick-to-turn conversion. Forward
requests remain 0.4 m/s and the stopping corridor remains 0.73 m.

## Obstacle recheck and alternate directions (2026-11-09)

A confirmed wall ahead no longer ends exploration simply because the current
forward corridor is blocked. The controller stops, waits for the same-cell
two-second recheck when it is a new suspicion, and replans using the existing
unvisited-view heuristic. It can turn only if the body sweep and forward corridor
in the new direction are checked. Unknown changes in a forward corridor also
stop actuation and trigger replanning rather than immediately terminating.
If local views are exhausted, it searches the accumulated map for a checked route
to a farther unvisited area. If that bounded search also finds no route, it stops
and saves the partial map. It cannot promise full coverage or move through a blocked body footprint.

## Minimum effective turn request (2026-11-09)

A live turn stalled while proportional yaw requests fell to about 0.2 rad/s,
then hit the 25-second goal timeout. At the user's request, in-place turns now
request at least 0.4 rad/s in the direction of the remaining heading error,
capped at 0.6 rad/s. Within the existing 0.08 rad (~4.6°) target tolerance they
still send StopMove. Forward steering corrections do not use the minimum.
Tests include both turn directions with simulated low-input deadband; actual
minimum effective speed and stopping overshoot still need a supervised trial.

## Position shift during turns (2026-11-09)

At the user's request, accumulated translation beyond 8 cm during a turn no
longer independently stops exploration. Each turn keeps its original heading
target and 25-second goal timeout, but updates its pivot to the current estimated
XY before checking the remaining body sweep. It still requests zero forward
velocity during a turn. Current-footprint/obstacle/drop checks, pose discontinuity,
telemetry freshness, tilt and speed limits remain active.

## Larger travel budget and mapped-area search (2026-11-09)

The travel cap is now 30 m. The time cap is ten minutes so the longer travel
budget is usable with scanning, braking and turns. Starting-terrain confirmation
expires with that time budget. Speed, corridor and battery settings are unchanged.

When local forward targets and turns have been visited, an incremental map search
can cross previously visited floor to reach a physically unvisited location.
Position visits and viewing-direction visits are tracked separately. It searches
position plus eight orientations at 30 cm spacing, checks translation/rotation
sweeps and the forward stopping corridor, and excludes pending/confirmed hazards.
Targets prefer observed free floor near unknown space; unvisited free areas are
a fallback. Blank/unknown map space is never considered traversable. Search work
is sliced across control ticks while movement is stopped, bounded to 2500 expanded
states per search, and restarted if the estimated start position changes too far.
The destination is retained between short actions and routes are recomputed from
the updated pose; each actual action is checked again before publishing movement.

This is bounded exploration planning, not proof that every reachable room area
will be found. It may miss narrow passages at its search resolution or exhaust
the node/time budget; map size is still bounded around A. Full coverage is not
claimed. No route, unsupported current body footprint or the independent drop,
telemetry, pose, battery and speed conditions can still stop the run.
