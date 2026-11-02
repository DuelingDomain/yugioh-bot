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

## Review r1 remediation (coordinator authorized)

Read the full review at `data/briefs/remote-duels/review-remote-autodetect-r1.md`
from the main checkout, read-only. Starting point 7bea11bde includes auto departure
with Undo. Keep that behavior and preserve protected services/ports.

- [x] B1/B2: immutable identity appearance; immediate invalidation on same-place
  swaps; appearance gate on every move. Changed identities require a prompt.
- [x] B4/S4: zone-only restart candidates must read; adopt a known ref only after
  sure identity agreement. New auto placements require two independent clean
  reads agreeing and membership in a registered deck. Without a decklist,
  recognition prompts for explicit confirmation (latest coordinator instruction).
- [x] B3/S1/S2/S8: no new automatic pile placements, including GY; match a uniquely
  lost/removed identity for pile moves only. Detect fans/overlap/large held cards
  and outside-mat candidates; prompt once. Use absolute uncalibrated columns.
- [x] B3/S3: serialize all actions/prompt choices through one queue, carry returned
  room state, bind unowned matching manual twins instead of duplicating, and send
  only twin.place for a new card. Reject occupied field slots server-side.
- [x] S3/S5: publish only public current twin refs; receiver independently validates
  twin ref/face/card ID. Undo/manual removal suppress re-auto-placement and stale
  cache; explicit confirmation can rebind the same physical evidence.
- [x] S6/S7: body modal with focus/Esc/return, one accessible prompt at a time in
  unclipped layer, integrate controls into feed toolbar, transient notices.
- [x] N1–N8: bounded change/heartbeat publishing, once-per-outline appearance,
  status announcements/styles, live-ref removal offers, camera warmup recovery,
  CPU-status hysteresis, document native-frame memory limit.
- [x] Extend EXISTING tests with named probes A–F and race/restart/Undo cases.
  Run isolated e2e plus screenshots for 1v1 and 4 seats at 1920x1080, 2560x1440,
  1366x768, 390x844, calibration and bottom-edge prompt visible. Use 3449/7889
  only if free; do not touch 3000,3002,4002,4003,3417,4010,4020,7880–7882.
- [x] Review, relevant tests/typechecks/benchmarks, per-item report, small commits,
  push feat/remote-autodetect, no PR, no attribution trailers.

Review r1 result: **380 passing cases**, including all nine browser cases and
sixteen screenshots. A focused rerun verifies actual WebSocket twin delivery
before forty cached clicks: owner p50/p95 **14.200/19.515 ms**, observer
**14.160/16.870 ms**, zero extra recognition/actions. Registered-deck placement
p50/p95 **1,769.2/1,977.0 ms**; no-deck identification prompt
**1,011.7/1,320.0 ms** (20 trials each; no-deck never auto-places). Full-catalog
search p50/p95 **2.855/3.130 ms**, resident index fetched once. Ten follow trials:
move **1,016.3/2,163.2 ms**, removal **3,144.1/6,454.5 ms**; hand checks had zero
false removals in 60 seconds. The hard maximum speed targets are not guaranteed:
placement reached 2.85 s in the separate follow workload and one fresh click
306 ms. Per-item fixes, raw evidence, historical results and the unrelated broad
shared-typecheck limitation are recorded in `packages/vision/REPORT.md`.

Implementation and test commits pushed through `eae55a4bc`; report/plan follow in
a final documentation commit. Isolated web/WS/LiveKit services are stopped, their
ports are free, and protected services were untouched.

## Review round 2 remediation

The coordinator supplied the design and authorized these fixes on the existing
branch. Keep identity untrusted until a read/explicit confirmation succeeds, but
retain the reserved physical twin ref through prompts. Match a same-spot change
back to its existing track even after skipped detection. Explicit prompt choices
may update that slot's untracked twin; automatic copy binding may not steal a
different slot's temporarily hidden track. Bound all table requests/refreshes at
10 seconds and permit historical occupied-slot events only during trusted replay.

- [x] NB1/B4: failing same-spot light-tick and restart probes in existing vision
  tests; preserve bound refs and verify confirmation leaves one track/ref.
- [x] NB1/NS2: existing web tests cover one-click face-down/replacement prompt
  confirmation and two-copy ref safety; update the isolated apply path.
- [x] NS1: prove a hung request and failed-action refresh time out, report errors
  and let the shared action queue proceed; use AbortSignal.timeout(10_000).
- [x] NS3: historical duplicate-slot replay probes; live writes remain rejected.
- [x] Run relevant suites/typechecks, review the changes, record per-item numbers,
  commit small and push without a PR or attribution trailers. Protected ports stay
  untouched; use only the existing ignored fixture data for any browser check.

Round 2 result: **401 passing cases**, with **21 new probes** in existing files
(four watcher, eight component, three timeout, six replay). One explicit choice
resolves restart/replacement prompts with one twin, including cards moved while
the prompt waits. Two-copy probes produce zero moves of the hidden first copy.
Timeout is 10 seconds per request, at most 20 seconds for a hung action followed
by a hung recovery; subsequent actions continue. Six legacy conflict replays pass
while new live conflicts remain rejected. Scoped code review has no outstanding
findings. Vision/web/e2e typechecks, shared build and worker bundle pass.

The full nine-case browser rerun passed in 2.0 minutes and regenerated all sixteen
requested screenshots. Cached owner p50/p95 **16.60/34.21 ms**, observer
**17.58/23.81 ms**; forty clicks, zero extra recognition/actions. Actual table
move/removal samples **1,073.7/3,218.0 ms**. Full numbers and the 3,029 ms observer
snapshot sample are retained in REPORT and ignored `field-watcher/round2.json`.
No new placement/hand benchmark is claimed. Implementation pushed through
`779767c36`; final report follows as documentation. Isolated services are stopped
and their ports are free; protected services were untouched.

## Owner camera feedback: type, prompt stability and fast movement

The coordinator supplied the expected design: physical x chooses the column;
identified type chooses the legal row. Keep the existing queue/ref/Undo contracts.
Full catalog facts (including Spell subtype) must reach the adapter; unknown types
abstain. Prompt choices show their legal destination and manual moves warn.

- [x] Existing web probes reproduce Solemn Judgment in M4, nearest-free S/T,
  Field Spell, monster/EMZ/Pendulum legality, prompt annotation and manual warnings.
  Implement a small shared projection and metadata wiring, then adapter moves.
- [x] Existing vision pipeline/client probes request a copied local embedding
  without feedback/crops or extra inference. Never broadcast/upload the embedding.
- [x] Existing watcher probes reproduce repeated prompts after choice/dismiss,
  exposure/angle/hand jitter, sustained true swaps and fast same-ref moves.
  Use multi-frame strong-change evidence, reference embedding hysteresis and a
  five-second resolved-prompt cooldown; no prompts for identity-preserving changes.
- [x] Sample tracked motion cheaply every 100 ms and settle verified moves over
  two clean frames/~100 ms, preserving conservative identity and removal guards.
- [x] Run existing suites/typechecks, real-worker browser e2e and ten-trial move
  benchmark; retain p50/p95/outliers, review, commit small and push. No PR,
  attribution lines, protected services or model/index rebuilds/downloads.

Owner-feedback closeout: **164 vision, 192 targeted web, 139 shared integration
tests pass**; vision/web/e2e typechecks, shared build and worker bundle pass.
Coordinator requested immediate completion: final browser run stopped by PID
with **7 passed, 1 interrupted (manual-read race), 2 not run (screenshots)**.
The earlier full run passed those last three and produced sixteen requested
screenshots; its rotation failure is now covered by a passing focused lifecycle
and the final run. No final all-ten success is claimed.

Final browser Solemn slides: **583.2 ms with deck / 740.0 ms without**, no illegal
zones or repeated prompts in 24 seconds of jitter. Cached owner/viewer p95:
**27.05/17.89 ms** over forty clicks, zero new reads/actions. Rotated EMZ move
**1,177.8 ms**, clear departure **2,964.9 ms**, same ref and Undo. Earlier ten-trial
move p50/p95 **770.3/960.5 ms** precedes the last burst/reconnect changes; no new
benchmark started after the cutoff. Earlier hand-only/occlusion tests: zero false
events/removals over 30 seconds each.

Remaining limits are recorded rather than extended in this round: placement
p95 **2.75 s with deck / 1.36 s without**, one fresh click **308 ms**, rotated
move over one second, ambiguous-copy/occlusion prompts, conservative patterned-mat
removal, and unmeasured physical webcam/WebGPU hardware. The updated ignored
worker bundle must be generated when merging. All owned isolated services were
stopped by PID; protected ports were untouched. Code pushed through `d4208d92a`;
closing report is a separate documentation commit, no PR or attribution lines.
