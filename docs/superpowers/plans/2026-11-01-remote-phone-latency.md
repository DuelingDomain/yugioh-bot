# Phone recognition latency implementation plan

> Execute inline with the executing-plans skill. The coordinator's five requested changes are the approved design. Keep all code in this worktree; no new unit test files, PR, attribution trailers, or changes to protected services.

**Goal:** Reduce phone-to-desktop reads toward warm <1200 ms and cold <3000 ms, measuring all stages honestly at 4× CPU throttle.

**Architecture:** Initialize the desktop worker, index and models when the table opens and when a phone pairs. Keep a bounded one-second native-resolution ring on the phone; score downscaled crops at the requested normalized video point, encode only the winning native-resolution crop plus context, and remap that point into the JPEG. Begin reads at pointerdown, bypassing redundant desktop detection of the live phone feed. Report durations on each device without assuming synchronized wall clocks.

**Tech stack:** React/Next, LiveKit data, Canvas/ImageBitmap, ONNX worker, Playwright/CDP.

- [x] Inspect and merge `origin/feat/remote-vision-feedback` for early exit/deck-first, preserving existing recognition behavior.
- [x] Extend `packages/e2e/tests/remote-phone.spec.ts` with real-camera-fixture coverage for prewarm, buffered crop and coordinate mapping, pointerdown, per-step metrics, and cold/warm timings. Run first to demonstrate missing behavior. Use an isolated SFU on unprotected ports; shared 7880 remains read-only.
- [x] Add public worker warmup in `packages/vision/src/client.ts` and desktop startup in `packages/web/src/components/remote/ui/recognizer.ts` and `video-hub.tsx`.
- [x] Update `phone-protocol.ts`, `phone-capture.ts`, and `phone-desktop.ts`: bounded crop metadata, one-second ring, sharpest-point JPEG, coordinate remapping, timing diagnostics, cancellation and cleanup. Scan mode captures on demand when the camera was stopped; do not hide its cold-camera cost.
- [x] Start live phone reads on pointerdown in `feed.tsx`, `lobby-preview.tsx`, and the phone scan control; retain keyboard activation and avoid duplicate click reads.
- [x] Run targeted existing recognition/protocol tests, vision typechecks, web typecheck, and phone integration tests. Inspect timings and fix measured bottlenecks as evidence warrants.
- [x] Update `docs/remote-duels/contract.md` and the requested `data/briefs/remote-duels/phone-shots/timings.json` with measurements, environment, cold definition, target outcomes and limitations. Review, commit and push `feat/remote-phone` without a PR.

Measured: field DOM first 635 ms, warm 441–977 ms; scan confirmation first 1354 ms, warm 929–1025 ms. Startup is reported separately (12.85 s), so an uninitialized read under 3 s is not claimed. Review fixed held-pointer/dwell duplication and drag-outside hover recovery. All authorized work completes with the branch push.
