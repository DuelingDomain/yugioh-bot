# Replay load implementation plan

Goal: reduce replay open time without retaining idle engine workers or changing replay access and verification.

Measured baseline: isolated production stack, E2E_SLOT=7, own SQLite and prepared engine bundle. A real 240-command 1v1 takes 1,279 ms in the host (913 ms journal run including worker creation), serves 5,335,828 uncompressed bytes, and has a 1 ms source DB read. FFA3 and Tag use 120-command real journals. All fixtures exercise current-engine verification of a saved older bundle label. The existing replay cache already removes simulation on repeat opens.

Design: keep the existing source/version/resource/projection cache and access checks. Send a complete build to the detached engine worker. Reuse the same journal runner, answer validation, frame builder, byte caps and final board comparison. Encode each frame in that worker and return the bounded result once. The host verifies all returned final projections before caching or serving frames. Terminate the worker at completion or cancellation; do not retain warm engines. Defer crack geometry on healthy replay frames (the browser CPU profile attributed 0.6–3.0 seconds to the initial measure/generate layout effect); generate it on the first damaged seek. Mount heavy multi-seat replay fields after their first stage measurement, keeping camera refs and ring mounted. Stream gzip on the authenticated web response when the browser accepts it. Keep JSON and the existing client contract unchanged.

Alternatives: a warm-worker pool uses persistent RAM and still sends per-command messages. Progressive current-engine frames could display an invalid cross-version replay before final verification. The selected design removes transport work while keeping the verification boundary.

- [x] Trace page, API, host, journal runner, worker startup, resource hashing, cards/Lua/core, DB snapshots, wire payload and client first render.
- [x] Record baseline first/cached opens for real 1v1, FFA3 and Tag journals.
- [x] Add real-engine integration coverage for batched execution versus the existing transport path; no new unit tests.
- [x] Run the frame build inside its detached worker; preserve error codes, cancellation, timeouts, size caps and worker reservations.
- [x] Compress authenticated ordinary and owner replay responses without HTTP caching.
- [x] Repeat local and rate-limited browser measurements; verify private/owner/public projections, changed boards, overflow and cross-version replay with targeted integration/E2E suites.
Delivery: remove temporary instrumentation and engine build output, commit, push, open the PR with timings, wait for CI, and leave it unmerged. The PR checks and final report record delivery status.

## PR review follow-up

Keep the bounded result path if a real 12–16 MiB replay stays below 70% of the default worker heap and below 100 ms maximum host event-loop delay. Measure the worker at frame encoding, engine dispatch, final-view capture and after result posting. Preserve unexpected error causes for host reporting while keeping public messages fixed. Load replay modules only for replay requests. Latch field mounting after the first positive stage scale. Check the build deadline before final verification. Extend existing real-worker and browser integration cases; add no unit tests.

- [x] Measure a 420-command, 422-frame owner reveal replay near the cap.
- [x] Preserve original unexpected errors and load replay modules on demand.
- [x] Keep mounted fields through a zero-size stage; reject expired batches before verification.
- [x] Run targeted integration checks and browser checks: 45 server tests, 8 browser/auth checks, duel-server/E2E typechecks and production web build pass.

Delivery continues with push, green CI and the requested local-all port. The PR body and final report record those delivery results.
