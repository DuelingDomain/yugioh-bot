# Local vision sessions and event benchmark

User-approved scope: the supplied owner brief (2026-11-01). Work is isolated on
feat/remote-vision-bench; existing recognition and remote-table behavior stays with
the other worker. Only the lab tab selector needs a small existing-file edit.

## Design

1. A Record session tab streams MediaRecorder WebM chunks to a user-selected
   DATA/vision-sessions directory through the browser File System Access API.
   No HTTP video endpoint. Five-minute and 150 MiB limits; video-only camera.
   Sidecar JSON holds actual capture settings and a lightweight local log.
2. The same tab opens a local video, scrubs, and edits timestamped physical-card
   events with instance IDs, catalog IDs, zones, destination, orientation and
   optional normalized card rectangle. Negative hand intervals are explicit.
   Offline replay prefills suggestions; every suggestion requires review.
   Labels must be exhaustive before the owner marks the session reviewed.
3. A shared browser replay imports the app's recognizer and field watcher. Warm
   models before playing at 1x. Record observation time, input frame time,
   detector samples, candidates and events. Never inject ground-truth identities
   into recognition. Compare with/without deck; explicit CPU baseline and
   experimental motion/ROI/cache/tracker variants. Hardware WebGPU is optional;
   absent/fallback adapters are reported rather than relabelled as GPU results.
4. A standalone Node CLI bundles the shared browser code and worker, serves only
   local assets on an ephemeral loopback port, blocks external browser requests,
   replays sessions sequentially, and measures aggregate Chromium process CPU via
   CDP. Writes one JSON and one Markdown report. Events use one-to-one temporal
   and spatial matching, independently of identity; misses remain in denominators.
   Gate: real, reviewed, complete labels, >=50 events spanning every requested
   lifecycle and hand negatives, >90% recall/precision/top1/zone, no wrong sure,
   <=1 prompt per physical instance, bounded placement/move/removal p95.
5. CPU experiments stay in bench: two-stage confidence association with velocity
   prediction and embedding re-ID; per-session crop cache with ambiguity rejection;
   frame-difference gate with periodic full sweeps; motion ROI plus cached outside
   detections; lower-resolution detection, original full-resolution ID crops.
   Detection model adapters accept externally supplied ONNX weights; no accuracy
   comparisons are invented when weights/labels are missing.
6. A deterministic Python synthetic generator writes YOLO segmentation labels,
   train/validation splits by artwork, perspective/sleeves/glare/blur/hand scenes.
   GPU training/export and real-crop embedder fine-tuning instructions/scripts
   include dry-run inputs and a priced budget. No rental or paid action.

## Implementation / validation

- Contract + scoring: one lean feature test proving unmatched events, wrong ID,
  duplicate predictions, latency, negatives, prompts and fail-closed gate.
- CPU options: one scenario proving move/re-ID continuity and ambiguous copies;
  motion gate test proves still-scene skips and periodic sweep.
- Recorder/labels: a real Chromium fake-camera smoke streams a short WebM to a
  temporary directory, reads it back, edits/exports labels and checks no uploads.
- Runner: replay a tiny synthetic session with actual models on WASM and write
  both reports; report failure of accuracy/speed gates honestly. Save only small
  fixtures/reports under ignored data. Syntax-check and tiny generator run.
- Typecheck affected packages; request independent code review; fix material
  findings; commit in small units and push branch, no PR or attribution trailers.

## Review clarifications

Scoring is unassisted: no label-derived confirm/dismiss/getKnownCards calls.
The browser owns the same native camera buffer and watcher scheduling as the
app, at video playbackRate=1 and monotonic wall time. Model warm-up precedes
playback. Startup and actual backend/runtime configuration are retained.
Placement/move/removal p95 bounds are 2000/1000/4500 ms. Event matching tolerates
100 ms early and at most 5000/3000/7000 ms late (flip/DEF 3000 ms), requires
box IoU >= .2 when a box exists, and never matches on predicted identity or zone.
Visible event boxes are mandatory for gate eligibility; detector recall uses
IoU >= .5 within 1500 ms. Recall/identity/zone denominators include misses;
precision includes every unmatched/duplicate event. Missing/nonfinite timing,
backend fallback, runtime errors, inadequate coverage and unreviewed labels
fail the gate. Suggested labels cannot pass without exhaustive human review.

Files: bench/{session,score,replay,tracker,efficient,tracked-watcher}.ts;
scripts/vision/{benchmark-sessions,check-session-lab}.ts and session/* training,
fixture and server helpers; web/app/dev/vision-lab/session/* new UI/hooks/style.
Existing-file edit: vision-lab.tsx tab selector/import only. Reports retain git
commit, SHA256 hashes for model/index/worker/video/labels, actual backend and
thread settings, raw events/detections, per-event decisions, excluded warm-up and
CPU methodology. No existing worker artifacts are overwritten during replay.
