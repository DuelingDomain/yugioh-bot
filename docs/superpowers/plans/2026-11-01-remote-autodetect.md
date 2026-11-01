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
