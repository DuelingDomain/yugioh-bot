# Remote field watcher implementation plan

Goal: automatically propose owner-feed placements without clicks, preserving physical instance IDs and the existing uncertainty and Undo contracts.

Architecture: detector-only worker initialization; an adaptive, serial watcher in `packages/vision` tracks normalized quads and gates recognition on one second of stillness, motion and confidence. A React hook owns lifecycle/preferences. A separate table companion supplies controls, anchored prompts and normal action proposals from one table integration point. The lab uses the same watcher.

- [x] Extend existing vision tests for placement, hand motion, sharpest-frame binding, tracking, disappearance, flip, uncertain results, calibration and lifecycle/budget guards; repair the existing generic-board fixture's accidental Yu-Gi-Oh filter dependency.
- [x] Extract reusable scene detection and defer embedding/index initialization until recognition; keep WebGPU/WASM fallback.
- [x] Add field geometry/calibration, motion sampling and watcher; native frame clones have bounded ownership, no overlapping inference, no automatic disappearance action.
- [x] Add `useFieldWatcher`, companion component outside `remote/ui`, and one small table mount. Use normal action endpoint (`source: auto`), five-second Undo and per-seat local calibration/settings.
- [x] Add lab Auto-detect tab with webcam, calibration, tracks, event log and timing/budget diagnostics.
- [x] Add fake-camera appearance e2e in the existing e2e suite. Measure real WASM-threaded worker CPU and placement latency with repeatable generated video including a hand-only negative; report synthetic-domain limits explicitly.
- [x] Run vision/web checks and browser checks, review, commit in small steps, push `feat/remote-autodetect` without a PR.

No changes to the main checkout or existing protected services. Reuse dependency/model cache without downloading a new index. Test on an unused port or an ephemeral listener.
