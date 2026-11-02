# Record, label and replay physical card sessions

This tool keeps video on the owner's machine. The browser writes WebM chunks
straight to a directory selected through Chrome/Edge's File System Access API.
There is no recording upload route, audio capture, remote inference or cloud
storage. The recorder stops at 300 seconds or approximately 150 MiB. At 3 Mbps,
five minutes is normally about 113 MB; actual camera dimensions are recorded.

## Record and label

1. In this worktree use Node 22 and prepared local vision assets. Start an
   isolated lab (3417 belongs to the feedback worker; leave it running):

   ```sh
   export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
   E2E_AUTH=1 E2E_AUTH_SECRET=vision-lab-local-only-633-not-a-real-key \
     npm run dev --workspace=@yugioh-discord-bot/web -- --hostname 127.0.0.1 --port 3437
   ```

   If this worktree's lab already runs on 3437, use it. On a new machine follow
   `packages/vision/README.md` to prepare local assets first. Opening the lab from
   the recording PC's Chrome requires localhost or HTTPS. On Windows with a WSL
   server, open `http://localhost:3437/dev/vision-lab` in **Windows Chrome**.
2. Select **Record session → Choose DATA folder**. Pick a local folder such as
   `D:\VisionData`, or its existing `vision-sessions` subfolder. The browser saves
   to `DATA/vision-sessions/`. Avoid a cloud-synced folder if footage must stay
   exclusively on this PC. Choose resolution, press **Start recording**, allow
   video access, perform the sequence, and **Stop & save**. **Mark moment** adds
   a lightweight timestamp marker. No recognition runs while recording.
3. The label editor opens automatically. To resume later, choose the same DATA
   folder, **Open local video**, then **Open session JSON**. Select the JSON's
   matching video filename. Reimporting a revised JSON replaces the editor state.
4. Enter the deck's catalog/passcode IDs, choose format, and **Calibrate mat** by
   clicking TL, TR, BR, BL on a paused frame. This records the app's calibration
   contract; it does not implement a competing zone mapper.
5. **Prefill with current pipeline** replays locally at 1x with the same app
   watcher/recognizer. Backend Auto prefers hardware WebGPU; WASM is selectable.
   It uses the declared deck and calibration, never label identities as feedback.
   Suggestions are drafts at the input-frame time, not ground truth. Confirm or
   correct every suggestion, delete false events, and add every missed event.
6. Scrub to the **first frame of each action**, draw the card's rectangle, press
   **Use current time**, choose kind/card/zone, and **Confirm label**. Use one
   physical ID through the whole life of a card, including disappearance and
   return; identical copies need distinct physical IDs. `moved` has a destination
   plus optional from-zone; `removed` has GY/DECK/HAND/etc as destination. `flipped`
   records face-down state; `defense` records ATK/DEF. For a removal rectangle,
   use its last visible source box. Correct prefill times to the physical action.
7. During steady holds, **Propose detector checkpoint at playhead**. Verify all
   visible cards (including backs). Teal outlines show checkpoint boxes; gold is
   the rectangle being drawn. Draw a corrected rectangle and **Use drawn
   rectangle for card N**, or edit numeric coordinates. Add missing cards,
   remove stale boxes, then check **All visible cards...**. For hand-only/empty
   checkpoints remove every box. These complete-frame annotations make detector
   precision measurable; sparse event boxes alone cannot do that.
8. Scrub to hand-only segment start/end and press **Mark hand-only start/end**.
   Review the complete video, check the final review declaration, then **Export
   labelled session JSON**. It saves beside recordings in the chosen folder.
   Without a directory handle export downloads JSON; move it beside the video.
   Opening an arbitrary existing video does not copy that video into DATA.

A useful gate session contains at least **50 events**, ten reviewed steady-frame
checkpoints, placements/moves/removals/flips/DEF, FIELD activation, Extra→EMZ,
removals to GY/deck/hand, and at least five seconds of hand-only activity. Hold
cards clearly for a few seconds between actions. Record several sessions across
mats, sleeves, lights, camera angles and cameras. Aim for 2,000–5,000 real crops
and 300 negative examples over 20–30 short sessions. Keep an untouched test
folder; split by whole session/camera, never neighboring frames.

## One-command benchmark

```sh
npx tsx scripts/vision/benchmark-sessions.ts \
  --sessions /mnt/d/VisionData/vision-sessions \
  --out /mnt/d/VisionData/benchmark
```

This command needs the repo's installed dependencies and Playwright Chromium
(`npx playwright install chromium` if absent), plus the already prepared models,
index and ONNX runtime in `VISION_DATA_DIR` (default `data/vision`). It builds
fresh temporary worker/replay bundles, starts an ephemeral **loopback-only** HTTP
server, blocks external browser requests, and streams video with HTTP ranges.
It never starts/stops the app or uses the reserved ports. Warm-up is separate;
playback runs at 1x with app scheduling/native-resolution frame buffer. All jobs
are sequential, including paired with/without-deck runs and available backends.
Expect about `video duration × 2 × available backends × variants`, plus warm-up.

Outputs: **results.json** (raw events, detections, matches, errors, hashes, runtime
and per-event metrics) and **summary.md**. Default exit 1 means the gate failed;
`--no-gate` still reports FAIL but exits 0 for exploratory/synthetic jobs.

- Event recall/precision use one-to-one kind/time/spatial matching, independent
  of identity or predicted zone. Boxless removals need an established track
  binding. Matching windows: placement 5s, move/flip/DEF 3s, removal 7s, with at
  most 100ms early tolerance and IoU≥.2. Misses stay in every denominator.
- Identity top-1/top-5 uses the emitted candidate list with and without deck;
  misses count as wrong. Automatic recall additionally requires correct ID,
  zone and annotated orientation. Wrong-sure and unmatched sure events are explicit.
- Placement latency means identified correctly, not merely prompted. Movement
  and removal observation latency, zone/destination correctness and per-event
  decisions are reported separately. Absence alone cannot tell an off-camera
  hand from an off-camera deck; destination remains UNKNOWN, which fails zones.
- Detector precision/recall uses nearest samples within 750ms of reviewed,
  complete checkpoints, one-to-one IoU≥.5. An unsampled checkpoint is a miss.
  This is checkpoint coverage, **not all-frame AP**. Label steady holds to avoid
  timing ambiguity, include negative checkpoints and actual pile outlines.
- Every prompt counts; prompt totals span track changes. Unassigned prompts,
  repeated prompts for one physical instance, hand false events and wrong sure
  fail. This is an **unassisted** replay: no label-derived confirmations or
  dismissals. It does not simulate a person answering a prompt or measure the
  remote socket/reducer/UI render latency.
- CPU s/s sums Chromium process CPU (including decoder and worker threads),
  excludes warm-up, and is not percentage GPU utilization. Thread/isolation and
  actual backend are recorded. GPU absence is an explicit skip; fallback is
  never presented as a GPU measurement. CPU includes sampling/replay overhead.

The strict gate requires real exhaustive labels, coverage above, >90% event
recall/precision/automatic recall, identity top-1, zones and detector checkpoint
recall/precision; zero wrong sure/hand false events/repeated or unassigned prompts;
placement/move/removal p95 ≤2000/1000/4500ms; complete runtime/timing evidence.
No real footage means no real accuracy claim and no passing >90% gate.

For change comparisons keep the same sessions/options and add
`--compare /path/to/previous/results.json`. Missing run keys or changed label/video
hashes fail comparison. Top-1/top-5 cannot decrease, wrong sure and prompts cannot
increase, and p95 cannot rise >20%. Use the same hardware/browser/thermal state.

```sh
# Bench-only CPU experiment, keeping the production watcher unchanged:
npx tsx scripts/vision/benchmark-sessions.ts --sessions /path/to/sessions \
  --variants baseline,efficient --backends wasm --out /path/to/comparison
# Hardware GPU measurement when installed browser/OS exposes it:
npx tsx scripts/vision/benchmark-sessions.ts --sessions /path/to/sessions \
  --channel chrome --headed --backends wasm,webgpu --out /path/to/gpu-check
```

`efficient` wraps the recognizer with frame differences, motion ROI/cached outer
outlines, periodic full sweeps (1.5s), and 640px detector long side instead of
960px. Identity still receives original full-resolution frames. It is a **bench
experiment**, not an accuracy-approved production change. The current production
watcher already gates motion and schedules work; compare both before adoption.
No tracker/gallery replacement is included.

## Check the owner's browser GPU

In Windows Chrome, **Record session → Check WebGPU** reports adapter/device
availability and rejects recognized software/fallback adapters. If unavailable,
look at `chrome://gpu` → WebGPU and Chrome **Settings → System → Use graphics
acceleration when available**, then restart Chrome. An API existing is not proof
of accelerated recognition: run Prefill with WebGPU and read **Actual backend**
and runtime thread count in the final status. ONNX can fall back to WASM even
when adapter creation works. Record both results with the benchmark. A headless
WSL result does not determine Windows Chrome support. ROCm training support and
browser WebGPU support are independent.

## Lean verification

```sh
npx tsx --test packages/vision/bench/*.test.ts
VISION_LAB_ORIGIN=http://127.0.0.1:3437 npx tsx scripts/vision/check-session-lab.ts
# Existing full-card cache only; not the square artwork thumbnails:
VISION_WEBCAM_CARDS=/path/to/card-images npx tsx scripts/vision/session/make-fixture.ts
npx tsx scripts/vision/benchmark-sessions.ts --sessions data/vision-session-fixture --no-gate
```

The camera smoke uses Chromium's fake camera and origin-private filesystem as the
picker substitute. It verifies actual WebM, marker, editor/checkpoint/export and
zero writes over HTTP; it does not exercise a physical camera or real OS picker.
The lifecycle fixture explicitly remains `source: synthetic`. See
[LOCAL-TRAINING.md](LOCAL-TRAINING.md) for local Radeon setup and training.
