# Remote field watcher implementation plan

Goal: automatically propose owner-feed placements without clicks, preserving physical instance IDs and the existing uncertainty and Undo contracts.

Architecture: detector-only callers initialize lazily; auto-detect prepares the resident full reader at startup. An adaptive watcher in `packages/vision` starts recognition after 400–600 ms of stable geometry and continues tracking, requiring a subsequent clean frame before publishing. A React hook owns lifecycle/preferences. A separate table companion supplies controls, anchored prompts and normal action proposals from one table integration point. The lab uses the same watcher.

- [x] Extend existing vision tests for placement, hand motion, sharpest-frame binding, tracking, disappearance, flip, uncertain results, calibration and lifecycle/budget guards; repair the existing generic-board fixture's accidental Yu-Gi-Oh filter dependency.
- [x] Extract reusable scene detection and defer embedding/index initialization until recognition; keep WebGPU/WASM fallback.
- [x] Add field geometry/calibration, motion sampling and watcher; native frame clones have bounded ownership, no overlapping inference, no automatic disappearance action.
- [x] Add `useFieldWatcher`, companion component outside `remote/ui`, and one small table mount. Use normal action endpoint (`source: auto`), five-second Undo and per-seat local calibration/settings.
- [x] Add lab Auto-detect tab with webcam, calibration, tracks, event log and timing/budget diagnostics.
- [x] Add fake-camera appearance e2e in the existing e2e suite. Measure real WASM-threaded worker CPU and placement latency with repeatable generated video including a hand-only negative; report synthetic-domain limits explicitly.
- [x] Run vision/web checks and browser checks, review, commit in small steps, push `feat/remote-autodetect` without a PR.

No changes to the main checkout or existing protected services. Reuse dependency/model cache without downloading a new index. Test on an unused port or an ephemeral listener.

## Coordinator follow-up: format and latency

Approved scope: two EMZ above the main row for Advanced/Domain, none for either
Genesys format; placement identification in 1–2 seconds and desktop clicks under
300 ms. Keep uncertainty, physical IDs, owner scope and Undo intact.

- [x] Add failing geometry/UI cases for both EMZ slots and all four table formats;
  pass table format through the watcher, calibration and virtual field. Verify
  keyboard navigation and ordinary placement/attack targeting, then commit.
- [x] Benchmark the existing full index. Cache row norms and card row lookup,
  scan flat vectors with bounded top-k selection, and retain prepared data in the
  worker. Preserve exact cosine/prior/alternate-art behavior in existing tests.
- [x] Start reads after 400–600 ms stable; continue pixel tracking during inference
  and require a subsequent clean detector frame before publishing. Test late
  results, motion, misses, cancellation and sharpest-frame ownership.
- [x] Explicitly prepare the full reader when auto-detect starts (detector-only
  callers remain lazy). Keep auto WebGPU selection and isolated threaded WASM.
  Remove avoidable click sampling/frame work and verify meaningful regressions.
- [x] Extend the real Chromium benchmark with full-catalog p50/p95, balanced
  with/without-deck placement trials, desktop clicks and cold-ready timing.
  Verify asset request counts prove resident index reuse. Run existing checks,
  document measured scope and target results, commit small, push; no PR.

Final 60-card/no-deck trial (20 per condition): placement p50/p95
1,283.0/1,552.7 ms and 1,149.5/1,548.6 ms; desktop click p50/p95
194.0/218.2 ms and 193.6/205.1 ms. Full-catalog search p50/p95 2.93/3.62 ms.
40/40 placements and 40/40 clicks correct, one index/model fetch per reader,
265 checks passing. Large AI source warping/encoding runs only on explicit
Ask AI, with six-source/64 MiB retention. Earlier outliers and synthetic timing
limits are recorded in `packages/vision/REPORT.md`.

## Coordinator follow-up: instant tracked-card popup

Approved behavior: owner and other viewers hit-test identified tracks before any
frame capture or inference; the owner broadcasts normalized quads over the existing
reliable LiveKit data channel. Explicit Wrong card bypasses the cache. Keep ordinary
untracked reads, physical refs, hidden-card privacy and existing action/Undo flows.

Architecture: a small typed cache outside `remote/ui` owns validation, convex-quad
hit testing, replacement snapshots and a three-second transport expiry. Only safe,
visible face-up tracks outside Deck are exported. `RemoteVideo` binds snapshots to
the signed sender seat; `VideoHub` exposes stable synchronous lookup/publish methods.
Feed adds one early cache branch and passes a cached hit through its existing
onSelect callback; Table opens the existing card popup without awaiting catalog,
network, placement or recognition. Wrong card explicitly requests a new read.

- [x] Add failing cases in existing recognition/video/vision tests for normalized
  quads, owner-bound broadcast, local hits, move/removal/hidden/expiry/disconnect,
  explicit reread and correct zone/slot/DEF proposals. Implement isolated cache and
  transport, then run focused tests and commit.
- [x] Wire watcher snapshot publication and feed/table synchronous cached popup;
  test no recognition/capture/action on owner and observer clicks, including wrong
  card bypass and duplicate physical copies. Commit after focused checks.
- [x] Extend existing browser checks for cached owner and other-view clicks and
  physical EMZ/DEF auto placement. Measure cache click-to-popup and rerun balanced
  placement p50/p95; typecheck, review, update report, small commits and push.

Validation uses existing test files, Node22, cached models/index and an isolated
server on port3449 or ephemeral listeners. No protected services or port3000.

Final result: owner/viewer cached click p50/p95 **15.8/21.4 ms** and
**15.1/20.5 ms**, 20 clicks per view with zero additional recognition/actions.
Fresh placement p50/p95 **1,176.3/1,560.3 ms** with a 60-card decklist and
**1,182.3/1,496.5 ms** without, 20 trials each; all placements under two seconds.
Full-catalog search p50/p95 **2.875/3.305 ms**. One untracked click took 333 ms;
untracked click p95 was 288.4/260.3 ms. All 279 checks passed, including actual
EMZ1 DEF (−90°)→EMZ2 ATK with one physical ref. Repeated popup clicks exposed a
3.83-second publication gap; pixel-only refreshes now retain valid visible cards
during CPU pauses without inference and invalidate changed pixels safely.
Full numbers, scope and reproduction are in `packages/vision/REPORT.md`.

## Coordinator follow-up: camera follows moves and departures

The coordinator explicitly replaces suggestion-only removal with automatic
departure after roughly 2.5 seconds of clear absence. Reuse one reversible
`twin.move` into the destination pile (default GY for monsters, Extra Deck monsters,
spells and traps; retain an explicitly observed Extra Deck destination). Preserve
physical refs and show a named persistent log line and an owner toast with
GY/banish/hand/Extra Deck and Undo. No separate log action may displace removal Undo.
Only disappearance from field zones triggers this action; pile disappearances do
not. Existing one-level Undo reverses the latest action: removal Undo restores the
original field location; Undo after a destination correction restores the previous
pile. Keep the departed tracker tombstone so Undo during continued absence does
not immediately repeat removal. A verified reappearance can follow the same ref.

Design choice: reuse `twin.move` with optional bounded auto/name annotations rather
than add a new action or delete/recreate the twin. Keep the watcher and its UI
adapter isolated. Detector misses alone cannot prove departure: require at least
2.5 seconds and five consecutive full detector samples with low motion, an
unchanged surrounding halo, and pixels consistent with the surrounding mat.
Unknown/nonuniform background evidence abstains. Stationary hands, overlapping
outlines, flips, hidden tabs and CPU pauses reset absence. Light pixel checks never
count as absence. Short bounded detector bursts settle moves and verify absence.

- [x] Extend `packages/vision/src/board.test.ts` with red cases for strict timing,
  frozen hand occlusion, missing background evidence, flips and slow detector move
  settlement. Implement the conservative pixel evidence and watcher changes in
  `field-motion.ts` and `field-watcher.ts`; run vision tests/typecheck and commit.
- [x] Extend existing shared/web tests for one atomic automatic departure, owner
  authorization, persistent named log, destination correction and Undo. Add optional
  auto annotations to `packages/shared/src/remote/actions.ts`; reuse reducer and
  live deck-check move behavior. Add helper proposals in `field-proposals.ts` and
  owner removal/log toast in `components/remote/field-watcher.tsx`; update
  `ui/describe.ts`. Run focused checks, review and commit.
- [x] Extend `packages/e2e/tests/remote-ui.spec.ts` and the existing offline
  `scripts/vision/benchmark-field-watcher.ts` harness. Measure actual move→zone and
  removal→destination timing with real worker/camera frames. Run the cached hand
  clip both alone and over an already identified track, including a frozen hand;
  require zero false removals. Verify EMZ/DEF moves, no duplicate refs, named log,
  destination controls and Undo. No new unit-test files, downloads or port3000.
- [x] Run relevant regressions/typechecks, review, record numbers/scope in REPORT
  and README, commit small and push `feat/remote-autodetect`; no PR or attribution.

Final verification: 287 passing cases. Actual table move→EMZ update 1,290.8 ms;
clear departure→GY/toast 3,478.7 ms. Ten worker trials: move p50/p95
1,189.8/2,551.4 ms, removal p50/p95 3,284.7/6,042.4 ms; all same-ref and correct.
Hand-only clip 30 s: zero false removals; identified-track occlusion 30 s, including 8 s
frozen: zero false removals and no new placements/prompts. The 2.5 s clear window is
a minimum; slower guarded trials are retained in the report. Both actual table
and lab automatic removal/Undo pass; named log, four destination controls, Undo
while absent, verified return, injected 409/retry and cached clicks are covered.
