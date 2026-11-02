# Remote vision measurements — 2026-11-01

## Round 2 review fixes and verification

Read the appended review of `2d1e67f7d` in full. B1–B3 remain closed; the
remaining B4 confirmation flow and NB1/NS1–NS3 are now fixed. No item was skipped.

| Item | Change | New regression evidence |
| --- | --- | --- |
| NB1 / B4 | Same-spot changed pixels retain the track/ref after light ticks. Restart and face-down prompts retain `bindRef` without trusting the old identity. Explicit confirmation reuses the reserved twin, or the untracked twin occupying the slot. A reserved card may move while its prompt waits; confirmation updates and moves that same ref, checking other visible ownership first. | **4 watcher probes** cover different-card restart, face-down restart, busy/hand light ticks and CPU-budget skips. **6 component probes** click the actual confirmation UI and use the real reducer/queue: face-down restart, required flip, different-card restart, both faces moving before confirmation, and unbound same-spot replacement. Each leaves **one twin** and closes the prompt with one confirmation. |
| NS1 | `remoteApi` uses `AbortSignal.timeout(10_000)` for fetch and response body. Failed-action recovery makes a separate bounded request instead of waiting on an outstanding SWR revalidation, then retains the returned sequence/state. Errors remain visible and later actions continue. | **3 fake-clock probes**: hung action, hung recovery, both hung. Deadline **10 s per request**, up to **20 s** if both consecutive requests hang; the next action succeeds and uses the refreshed sequence when available. |
| NS2 | An existing track owns its copy even while hidden. Card-only adoption requires no track at all, or the same physical slot. | **2 component probes**, prompt and automatic settlement: a second copy beside a hidden first track creates its own twin/ref with **zero moves of the first copy**. |
| NS3 | Only trusted replay bypasses the occupied-slot assertion for already accepted historical events. Live writes retain slot validation and rejection. | **6 service probes**: legacy placement/move conflicts in Main Monster, EMZ and Field. Replay keeps both refs and Undo works; a subsequent live conflicting placement still rejects. |

All probes extend existing test files. Each defect was reproduced before its fix.
Final scoped review found the moving-prompt variant, which was reproduced in both
faces and fixed before the browser run; no actionable findings remain in scope.

Verification: **136 vision + 117 targeted web + 139 shared remote integration +
9 browser = 401 passing cases**, including **21 new regression cases**. Vision,
web and e2e typechecks, shared source build and worker bundle pass. The existing
unrelated broad shared-typecheck limitation documented below is unchanged.

The complete browser rerun passed **9/9 in 2.0 minutes** on the isolated native
camera/WASM/LiveKit/WebSocket stack. It verifies actual format-dependent EMZ and
DEF→ATK following, automatic departure/log/destinations/Undo/retry, the manual-read
race, forty cached popup clicks and both authenticated real-time snapshots.
The screenshot matrix was regenerated: **16 PNGs**, two/four-seat layouts at
1920×1080, 2560×1440, 1366×768 and 390×844 with prompt/calibration. Dimensions are
checked and the four-seat mobile calibration image was visually inspected again.

| Current full browser run, cached click → popup DOM | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Owner | 20 | **16.60 ms** | **34.21 ms** | 34.32 ms |
| Observer | 20 | **17.58 ms** | **23.81 ms** | 27.04 ms |

All forty clicks caused **zero additional recognition or table actions**. These
DOM timings exclude card-image download/decode/paint. Single actual table samples:
move→updated EMZ **1,073.7 ms**, removal→GY/toast **3,218.0 ms**, physical
appearance→WebSocket twin **3,020 ms owner / 3,029 ms observer**. The latter is
one full-stack development-server sample, not a local identification distribution.
No new balanced placement or hand-clip benchmark was run in this round; the
earlier measured distributions and hard-maximum limitations remain below.

Local raw evidence: `data/vision/benchmark/field-watcher/round2.json` (source
`779767c36`, all forty click samples, real-time receipts and follow samples),
`round2-e2e.log`, and the regenerated `r1-shots/` screenshot directory. Earlier
round-one timing JSON records remain available. Reproduction uses the same test
commands below and the existing isolated fixture stack. No models/index were
rebuilt or downloaded. Isolated services on 3449, 3349/4349 and 7889 are stopped;
the coordinator's protected services/ports were untouched.

## Review r1 remediation and current measurements

The coordinator's review of `511ea54fb` was read in full. All four blockers,
all eight should-fix items and all eight small follow-ups are addressed. This
section supersedes the older measurements below. Source changes remain on
`feat/remote-autodetect`; no model/index rebuild or download was needed.

| Review item | Result and regression evidence |
| --- | --- |
| B1: same-position replacement | Identity appearance is immutable between confirmed reads. Changed pixels immediately hide the old identity, including during another read, and require a fresh **Card changed?** confirmation. Probe A also covers a replacement hidden by a face-down flip. |
| B2: adjacent replacement | Every spatial move checks identity appearance, even without a detector miss. A different neighboring card becomes a new candidate; the original retains its absence checks. Probe B forbids a false move. |
| B3: duplicate physical twins | Lost/retired matching cards move with their existing ref. Unbound matching manual twins are adopted. Manual reads, watcher actions, prompt choices, Undo and destination corrections share one queue using returned room state. Server rejects occupied numbered slots and Field placement/movement. Probe E and the browser manual-read race retain one twin. |
| B4: restart identity | A zone-only reservation must read and agree before adopting a known ref; reservations cannot claim the same ref twice. Stored matching quads retain the existing fast path. A known-X/physical-Y probe produces a prompt, never cached X. |
| S1: pile placement | New automatic placement is disabled in Deck, Extra, GY and Banished, for both faces. Existing verified cards may move there; unmatched outlines require confirmation. Probes C/D/E cover piles and ref reuse. |
| S2: deck spreads | Three new outlines in 1.5 seconds, positive overlap, outside-mat corners or an oversized held card prevent automatic placement. A 1.5-second scene window includes staggered spreads and unverified restart reservations. Five-card fan probes produce no placement. |
| S3: Undo | New placement is one atomic `twin.place`, including its sighting. One Undo removes both. Forget/suppression stops rebroadcast and automatic reapplication for unchanged physical evidence; manual removal has the same effect. |
| S4: automatic confidence | New face-up placement requires membership in the registered deck **and two sure reads agreeing on distinct decoded clean frames**. No decklist means an identification prompt, not automatic placement. Face-down new cards require explicit confirmation and never invoke embedding. |
| S5: receiver validation | Both sender and receiver require a current public face-up twin ref. Popup identity comes from that twin; stale/missing/hidden refs fall through to a fresh read. Owner-bound normalized snapshots contain no pixels. |
| S6: clipped dialog/prompts | Calibration is a body modal with focus, Tab/Esc and focus return. One measured, viewport-clamped prompt is shown with a remaining-count indicator and status/zone announcements. All 16 requested screenshot combinations pass. |
| S7: feed controls | Watcher controls share the feed footer; the status chip sits beside the camera tag. Frozen-frame controls remain accessible. Normal notices expire after five seconds; actionable failed rollback recovery persists. |
| S8: uncalibrated columns | Absolute frame columns replace left-to-right ranks. Probe F maps physical M2/M4 correctly; calibration guidance appears once. |
| N1 | Publish only changes plus a one-second heartbeat; receiver expires after three seconds. |
| N2 | Compute appearance once per outline, then reuse across matching pairs. |
| N3 | Prompt status and zone description are announced. |
| N4 | Prompt buttons use table tokens and fonts. |
| N5 | Departure offers require a current twin; retries revalidate the ref. |
| N6 | Temporary missing camera frames show Starting rather than an error. |
| N7 | CPU guard has 650/450 ms hysteresis. |
| N8 | README documents six shared native frames, two transient copies and lower-resolution guidance for mobile. |

Asynchronous evidence has an explicit revision. A queued result rechecks current
pixels, identity and visibility before mutation. If evidence changes while the
HTTP request is in flight, the new placement is undone. If a concurrent action
prevents that rollback, a persistent recovery offers removal of the exact created
ref after revalidation. This prevents a silent stale placement while preserving
intervening player actions. Current prompt choices and manual verdicts also use
the shared queue and current evidence.

Advanced/Domain retain two EMZ above the main row; both Genesys formats have none.
Rendering, calibration and mapping use the table format. Real-worker browser tests
verify EMZ1 DEF (**−90°**) → EMZ2 ATK with the same physical ref. Departure still
requires **2,500 ms of continuous clear absence plus five full detector samples**,
low motion, an unchanged halo and footprint pixels matching the saved uniform mat.
Hands, unknown/patterned backgrounds, face-down flips, hidden tabs and CPU pauses
abstain/reset absence. Verified departure moves the twin to GY, including Extra
Deck monsters, with a named persistent log, five-second Undo and one-tap
GY/Banish/Hand/Extra Deck corrections. There is no second automatic pile instance.

### Identification, fresh clicks and catalog search

Warm desktop trials use a native 1280×720 synthetic canvas camera, one existing
indexed card on a plain mat, Node **22.23.3**, Chromium **153.0.8010.12**, an AMD
Ryzen 7 9800X3D host and eight exposed logical CPUs. GPU is disabled for repeatable
CPU measurements: actual runtime is cross-origin-isolated SIMD **WASM, four
threads**. Production still prefers WebGPU when available. These results do not
measure WebGPU hardware, mobile devices or physical webcam accuracy. Percentiles
use nearest rank; timing ends at the local watcher result, before table transport.

| Workload | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Placement → identified, 60-card registered deck | 20 | **1,769.2 ms** | **1,977.0 ms** | 2,754.2 ms |
| Placement → identification prompt, no decklist | 20 | **1,011.7 ms** | **1,320.0 ms** | 1,393.9 ms |
| Fresh untracked click, registered deck | 20 | 179.0 ms | 260.3 ms | 293.2 ms |
| Fresh untracked click, no decklist | 20 | 161.4 ms | 284.1 ms | 306.2 ms |
| Resident full-catalog top-10 search | 120 | **2.855 ms** | **3.130 ms** | 5.625 ms |
| Resident 60-card search | 120 | 0.025 ms | 0.055 ms | 0.320 ms |

All **40/40** identifications and **40/40** fresh clicks were correct sure results.
The registered-deck condition auto-placed **20/20**; no-deck auto-placed **0/20**
and instead offered the correct identification for confirmation. The full catalog
has **14,652 int8 vectors, 14,488 cards and 384 dimensions**. Resident flat dot
products, precomputed norms and bounded top-k reduced full-scan p50/p95 from
**6.745/7.725 ms** to **2.855/3.130 ms**, with **zero mismatched top-10 lists**
and maximum score delta **1.11e−16**. Index, metadata, detector and embedder each
loaded **once**, never per read. Reader ready time was **785.3 ms**. Browser errors:
**zero**. One explicit AI crop request was mocked after timing; no provider call.

Recognition begins after 400–600 ms of stability while tracking continues. Cheap
empty-mat motion sampling wakes detection promptly; active settling samples and
on-demand fresh native frames use a 100 ms budget, with passive capture at 200 ms.
The spread guard and independent-read requirements remain enabled during timing.

The primary p95 goals passed, but the requested hard upper bounds are **not
guaranteed**: one primary placement took **2.75 s**, one fresh click **306 ms**,
and the separate follow workload below reached **2.85 s** for placement. Earlier
slow/failed runs remain in the latency directory (`review-r1-priors-error.log`,
`review-r1-before-cue.*`, `review-r1-cue150.*`, `review-r1-capture100.*`). They
record the absent-priors fix and capture/settling tradeoffs rather than being
silently discarded. No physical-camera false-identification rate is established.

### Cached clicks, camera following and removal safety

The final focused two-player browser run verified authenticated `remote:changed`
WebSocket snapshots containing the real placed twin in **both** pages before
timing cached clicks. Actual field-track quads travel over the authenticated
LiveKit data channel and are hit-tested locally. One placement-to-WebSocket-twin
sample was **1,999 ms owner / 1,998 ms observer**; this is not a distribution.

| Click → popup DOM contains cached card name | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Owner feed | 20 | **14.200 ms** | **19.515 ms** | 29.030 ms |
| Other player's view | 20 | **14.160 ms** | **16.870 ms** | 19.620 ms |

All **40/40** cached clicks resolved correctly with **zero additional recognition
calls or table actions**. Explicit Wrong card invokes a fresh read. Image download,
decode and paint are outside the popup-DOM timing. The full nine-case run is also
retained: owner p50/p95 **14.395/19.905 ms**, observer **15.035/17.740 ms**.

| Camera change → watcher event, separate follow workload | n | p50 | p95 / max |
| --- | ---: | ---: | ---: |
| Initial placement → identified | 10 | 1,785.2 ms | **2,851.6 ms** |
| Move → same-ref updated zone | 10 | **1,016.3 ms** | **2,163.2 ms** |
| Clear removal → departed | 10 | **3,144.1 ms** | **6,454.5 ms** |

All ten follow trials identified correctly and retained the same ref for move and
departure. With n=10, p95 is the maximum; two initial placements exceeded two
seconds. The actual table integration, including action/network/rendering, measured
**1,043.4 ms** move→EMZ update and **3,283.2 ms** removal→GY/toast (one sample each).
It verifies named log, all four correction destinations, Undo, continued absence
without repeated removal, verified return, injected 409/retry and the manual-read
race. The 2.5-second clear window is a minimum, not a removal deadline.

| Real hand-clip condition | Duration | False removals |
| --- | ---: | ---: |
| Original hand-only scene, 125 detector samples | 30 s | **0** |
| Covers an identified card; 22 s moving then 8 s frozen | 30 s | **0** |

The occlusion condition produced only its initial control placement and no further
placements, prompts or removals. Total: **zero false removals in 60 seconds**.
This replays the same cached 3.4-second
[IPN Hand sample](https://gibranbenitez.github.io/IPN_Hand/), CC BY 4.0, and a
synthetic composite; it is not a general webcam false-removal rate. Full-scene
browser CPU was **6.60% of the eight-core machine**. No uncaught browser errors.

### Verification and artifacts

**132 vision + 106 targeted web + 133 shared remote integration + 9 browser cases
= 380 passing cases.** Vision, web and e2e typechecks, shared source build and
worker bundling pass. The final WebSocket assertion was rerun in the existing
cached-click case and e2e typechecked. A broad shared-project typecheck still has
pre-existing `vision-feedback`/`scripts/vision/feedback.ts` root-directory and
extension-resolution errors; the remote integration suite and shared build pass.
Probe-style cases extend the existing files, with no new unit-test files.

The isolated stack used web **3449**, WS **3349/4349** and LiveKit **7889** with
an ignored fixture database. Those services are stopped and their ports are free;
protected services were untouched. Screenshot matrix:
**1v1 and four seats × 1920×1080, 2560×1440, 1366×768, 390×844 × bottom-edge
prompt and calibration = 16 PNGs**. Native dimensions and modal/prompt bounds are
asserted; representative desktop/mobile images were also inspected visually.

Raw local artifacts (ignored generated data, retained in this worktree):

- `data/vision/benchmark/latency/review-r1.json` and `.log`: 20+20 placements,
  20+20 fresh clicks, full raw samples and resident catalog comparison.
- `data/vision/benchmark/field-watcher/review-r1.json` and `.log`: ten
  placement/move/removal trials, both 30-second hand checks and CPU data.
- `data/vision/benchmark/field-watcher/r1-performance-suite-timings.json`:
  nine-case run and actual table move/removal evidence.
- `data/vision/benchmark/field-watcher/r1-realtime-timings.json` and
  `data/vision/benchmark/cache/clicks.json`: final forty cached clicks and real
  WebSocket arrival evidence. Earlier `r1-suite-timings.json` and
  `r1-clean-timings.json` remain available, including slower samples.
- `data/vision/benchmark/field-watcher/r1-shots/`: all sixteen screenshots,
  named `{1v1|4seat}-{width}x{height}-{prompt|calibration}.png`.

Reproduce against an isolated authenticated table/WS/LiveKit stack:

```bash
LATENCY_LABEL=review-r1 LATENCY_TRIALS=20 npx tsx scripts/vision/benchmark-latency.ts
FIELD_LABEL=review-r1 FIELD_TRIALS=10 FIELD_NEGATIVE_SECONDS=30 \
  npx tsx scripts/vision/benchmark-field-watcher.ts
VISION_LAB_ORIGIN=http://127.0.0.1:3449 \
  npx playwright test -c packages/e2e/playwright.vision.config.ts
```

## Earlier measurements (before review r1)

The following sections retain prior evidence and describe the corresponding older
revisions. In particular, their one-read/no-deck automatic-placement timings do
not describe the current stricter confirmation policy.

## Camera follows moves and departures

This follow-up explicitly replaces suggestion-only removal. Stable moves update
the same physical ref's zone/slot/ATK/DEF automatically. A field card missing for
**at least 2,500 ms from its first clear miss and five consecutive full detector
samples** automatically moves into **GY**, including Extra Deck monsters and
spells/traps. An explicitly observed move into Extra Deck uses that zone. Pile
disappearance never triggers another automatic departure.

One normal reversible `twin.move` carries the public name and `source: auto`, so
the persistent log says **“Card left the field → GY · auto”** without an extra action
overwriting Undo. The owner toast offers **GY / Banish / Hand / Extra Deck** and the
usual five-second **Undo**. After a destination correction, one-level Undo restores
the previous pile. A rejected update exposes a revalidated retry. The diagnostic
lab also removes verified departures automatically with local Undo.

Removal requires motion energy **≤ .01**, no overlapping detector outline, no more
than **8%** of halo channels changing by **>.06**, and **≥95%** of footprint samples
matching the saved sufficiently uniform mat surround. Static hands cannot become
absence merely by stopping. Missing/unknown background evidence and patterned mats
can abstain. Hidden tabs, CPU pressure and flips reset absence. Sparse/slow detector
evidence backs off after a bounded verification window; pixel-only cache heartbeats
never count as absence. Retired records are bounded separately from live capacity.
Undo during continued absence does not repeat removal. A return only reuses a
departed ref for an unambiguous face-up appearance match; face-down returns cannot
inherit the old identity.

The final end-to-end table check, with actual native camera frames, actual worker
inference and the normal action endpoint, measured **move → updated virtual EMZ
1,290.8 ms** and **removal → GY/toast 3,478.7 ms** (one integration sample each).
It verifies EMZ1 DEF (**−90°**) → EMZ2 ATK, one physical ref, disappearance to GY,
named persisted log, immediate Undo restoring the original slot, **3.2 seconds** of
continued absence without another removal, verified return, an injected **409**
with successful explicit retry, all four destination buttons, and correction Undo.
The lab's automatic removal/Undo case also passes.

The offline final-code Chromium/WASM harness measured **10** native 1280×720
synthetic camera trials, each identifying the existing indexed fixture, moving it
to another zone, then clearing it. Endpoints below are watcher events and exclude
the table action/network/rendering measured separately above. Percentiles use
nearest rank; with ten trials p95 is the maximum. GPU was disabled; actual runtime
was SIMD WASM with **four threads**, Node **22.23.3**, Chromium **153.0.8010.12**,
and eight exposed logical CPUs on the same Ryzen 7 9800X3D host.

| Camera change → watcher event | n | p50 | p95 / maximum |
| --- | ---: | ---: | ---: |
| Move → same-ref updated zone | 10 | **1,189.8 ms** | **2,551.4 ms** |
| Clear removal → departed | 10 | **3,284.7 ms** | **6,042.4 ms** |

All **10/10** moves and departures retained the identified physical ref and all
ten initial identifications were correct `sure` results. These timings do not make
2.5 seconds an upper bound: continuous safe evidence and normal scheduling can
delay the action, and the slow tail is retained. The broader hand checks used the
existing cached **3.4-second IPN Hand clip**, looped without new downloads:

| Real hand-clip condition | Duration | False removals |
| --- | ---: | ---: |
| Full original hand-only scene | 30 s | **0** |
| Clip covers an already identified card footprint, mat halo unchanged | 30 s | **0** |

The second condition plays for **22 s**, then freezes the same clip for **8 s**;
the control card was identified before coverage. It produced only that initial
placement, with **zero additional placements, prompts or removals**. The full-scene
negative had **119 detector samples and zero events**. There were **zero uncaught
browser errors**. This is one real hand clip and synthetic positive/composite
scenes, not a held-out overhead-playmat corpus or a general hand-removal error rate.

Verification: **92 vision + 95 targeted web + 94 shared remote + 6 browser cases =
287 passing cases**. Vision/web/e2e typechecks and worker bundling pass. The final
two changed browser cases were rerun after the full six-case suite. All **40 cached
owner/viewer clicks** still caused **zero additional recognition or table actions**.
Review found and fixed ambiguous face-down resurrection, exhausted tracking slots,
unbounded slow-model bursts, expired returns after hidden tabs, failed updates,
and post-await toast races. Temporary table/LiveKit services were stopped;
port3000 and the main checkout were untouched.

Raw integration evidence: `data/vision/benchmark/field-watcher/table-follow.json`,
`e2e-follow-final.log`, `e2e-follow-last.log`; conservative timing/occlusion unit
cases extend `packages/vision/src/board.test.ts`. Repeated timing/clip evidence is
`data/vision/benchmark/field-watcher/camera-follow.json` and its matching log:

```bash
FIELD_LABEL=camera-follow FIELD_TRIALS=10 FIELD_NEGATIVE_SECONDS=30 \
  npx tsx scripts/vision/benchmark-field-watcher.ts
```

A development-server log initially caused a watched-file reload loop;
moving it into ignored `.next/` resolved that
test-infrastructure failure. No model/index downloads or real AI calls occurred.

## Cached feed popup follow-up

Owner and other-player clicks now hit-test the identified physical tracks' convex
quads locally and open the existing popup from cached card ID/name/ref. This path
does not capture frames, invoke recognition, request owner recognition or write a
table action. The owner publishes normalized replacement snapshots on a separate
reliable LiveKit topic; authenticated sender metadata binds them to that seat.
Invalid/ambiguous geometry is rejected. Missing, covered, face-down and Deck cards
are excluded; disconnects clear the cache and unrefreshed snapshots expire in
three seconds. Frozen views retain the snapshot belonging to their frozen pixels.

Repeated popup clicks exposed a real expiry bug: CPU pressure deferred owner
publications for **3.83 seconds**. Already identified tracks now receive pixel-only
checks scheduled up to **750 ms** apart, including during CPU pauses, while full
detection retains its CPU budget. Motion or changed appearance invalidates the
outline; only a detector match with appearance continuity restores it. Regression
tests cover busy periods beyond the transport TTL, stationary card replacement,
and same-ref movement settlement between slow detector samples.

The final two-player browser test uses actual Chromium **153** pages and a local
LiveKit **1.13.11** server, with a synthetic 1280×720 camera fixture. Twenty clicks
per view alternate across the owner and observer pages. Timing starts immediately
before dispatching the feed click and ends when the popup DOM contains the known
card name; remote image download/decode/paint is outside this measurement.

| Cached click → popup | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Owner feed | 20 | **15.8 ms** | **21.4 ms** | 23.6 ms |
| Other player's view | 20 | **15.1 ms** | **20.5 ms** | 27.5 ms |

All **40/40 cached clicks** opened the correct popup, with **zero additional
recognition calls and zero additional table actions**. A separate explicit
**Wrong card?** click invoked recognition and retained one physical twin. Corrections
use the displayed frozen pixels or reacquire that physical ref's current quad;
public corrections override the watcher's previous cached identity. Unit/component
checks also cover owner-bound broadcast, force-reread routing, duplicate copies,
canonical Token IDs, frozen snapshots, privacy, removal and reconnect expiry.

Fresh final-code placement trials alternate a **60-card decklist** with no decklist
in the offline Chromium harness, reusing the existing catalog/model/fixture. These
are warm desktop synthetic timings on the Ryzen 7 9800X3D, actual SIMD **WASM / four
threads**, eight exposed logical CPUs, and GPU disabled. Placement ends at the local
identified event; table/network rendering is covered separately by the browser test.
Percentiles use nearest rank.

| Final-code workload | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Placement → identified, 60-card decklist | 20 | **1,176.3 ms** | **1,560.3 ms** | 1,803.0 ms |
| Placement → identified, no decklist | 20 | **1,182.3 ms** | **1,496.5 ms** | 1,860.5 ms |
| Untracked desktop click, 60-card decklist | 20 | 201.1 ms | 288.4 ms | 333.0 ms |
| Untracked desktop click, no decklist | 20 | 197.5 ms | 260.3 ms | 277.5 ms |
| Resident full-catalog top-10 search | 120 | **2.875 ms** | **3.305 ms** | 6.095 ms |

**40/40 placements and 40/40 untracked clicks were correct sure results.** All
placements were under two seconds. Untracked click p95 met 300 ms in both conditions;
**one of 40 clicks took 333 ms**, exceeding that target. Cached clicks above all
remained under 28 ms. Catalog results matched the original scan in **150/150**
comparisons. Reader preparation took **755.9 ms**; index, metadata, detector and
embedder were fetched **once each**, with **zero browser errors**. No real AI provider
call occurred. These measurements do not establish physical webcam accuracy or
WebGPU/mobile latency.

The final real-worker browser suite passed **6/6** cases. It verifies actual
automatic placement into **EMZ1 in DEF** (computed virtual rotation **−90°**), then
movement to **EMZ2 in ATK**, retaining the same ref and one twin; main/spell/EMZ
slot proposals and all four table formats also pass. Overall verification is
**86 vision + 94 targeted web + 93 shared remote + 6 browser = 279 passing cases**;
vision/web/e2e typechecks and worker bundling pass. Final review has no remaining
actionable findings. Temporary local camera/table/LiveKit services were stopped.

Raw cache evidence: `data/vision/benchmark/cache/clicks.json` and
`e2e-final-all.log`; fresh placement/search evidence:
`data/vision/benchmark/latency/cache-followup.json` and its matching log.
Earlier intermittent failure logs and packet traces are
retained locally. Reproduce with the isolated table/LiveKit test stack configured:

```bash
E2E_AUTH_SECRET="$E2E_AUTH_SECRET" VISION_LAB_ORIGIN=http://127.0.0.1:3449 \
  npx playwright test -c packages/e2e/playwright.vision.config.ts
LATENCY_LABEL=cache-followup LATENCY_TRIALS=20 \
  npx tsx scripts/vision/benchmark-latency.ts
```

## Format and latency follow-up

Implemented on `feat/remote-autodetect` in `.worktrees/remote-autodetect`.
Advanced (`normal`) and Domain tables have **two interactive Extra Monster
Zones**, left above M2 and right above M4. Both Genesys formats have **zero**.
The actual table format controls rendering, mapping and calibration instructions;
keyboard movement and attack targeting include both EMZ slots.

Recognition begins after **400–600 ms** of stable geometry (default 400 ms,
at least three clean observations). New candidates receive bounded 200 ms
sampling bursts. Pixel tracking continues during inference, and identification
requires a subsequent clean detector frame matching the read's geometry and
appearance. Motion, cancellation, confirmation, dismissal and recalibration
invalidate pending work, including asynchronous frame clones. Auto-detect prepares
the full reader before reporting ready. Default execution prefers **WebGPU** and
falls back to isolated, threaded SIMD **WASM**; GPU selection/failure paths have
regression coverage, while the measurements below use actual CPU inference.

Measured with Node **22.23.3**, Chromium **153.0.8010.12**, GPU disabled, an AMD
Ryzen 7 9800X3D host with **8 exposed logical CPUs**, cross-origin isolation,
SIMD and **4 actual WASM threads**. The existing physical catalog contains
**14,652 int8 vectors**, **14,488 distinct cards**, **384 dimensions**. The worker
retains the index, precomputed row norms and per-card row lookup across reads;
flat dot products and bounded top-k selection avoid whole-catalog sorting.
Repeated clean searches within a recognition reuse their visual evidence.

Final run: **20 placements and 20 clicks per condition**, alternating a
**60-card decklist** with no decklist. Every positive uses one existing indexed
standard card at varying positions on a synthetic plain mat, through 1280×720
canvas `captureStream` and the native camera frame buffer. All distributions use
nearest-rank percentiles. Reader preparation is outside warm trial timing.

| Final measured workload | n | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Placement → identified, 60-card decklist | 20 | **1,283.0 ms** | **1,552.7 ms** | 1,980.9 ms |
| Placement → identified, no decklist | 20 | **1,149.5 ms** | **1,548.6 ms** | 1,687.8 ms |
| Desktop click, 60-card decklist | 20 | **194.0 ms** | **218.2 ms** | 224.0 ms |
| Desktop click, no decklist | 20 | **193.6 ms** | **205.1 ms** | 241.9 ms |
| Full-catalog top-10 search, previous implementation | 120 | 7.01 ms | 8.50 ms | 11.86 ms |
| Full-catalog top-10 search, resident prepared index | 120 | **2.93 ms** | **3.62 ms** | 6.44 ms |
| 60-card subset top-10 search | 120 | 0.025 ms | 0.040 ms | 0.305 ms |

**40/40 placements and 40/40 clicks were correct `sure` results.** All final
placements were under 2 seconds and all clicks under 300 ms. Fresh-reader local
preparation took **726.7 ms**; search preparation took **7.30 ms once**. Across
150 alternating before/after search comparisons there were **0 ranking
mismatches**, with maximum score difference **1.11×10⁻¹⁶**. The recognition
worker requested the binary index, metadata, embedder and detector **once each**
across all 80 reads. There were **0 uncaught browser errors**.

Click timing includes native-frame cloning, full-scene detection, refinement,
warp, embedding, full-catalog search, the small feedback crop and worker reply.
Outlined UI reads reuse the exact held frame/quad and skip duplicate detection.
Normal remote/lab reads defer the large AI source warp and JPEG until explicit
**Ask AI**. The worker retains at most **6 sources / 64 MiB**, under worker-scoped
handles. A pixel-equality regression verifies the same source crop as eager
creation, including partial-card filling. After timed trials, one **mocked** AI
request received the original **640×933** crop (**79,094 JPEG bytes**); an evicted
handle was refused. **0 real provider calls** occurred. Eager API behavior and
calibration capture remain available.

The prior JPEG-only deferral run missed the click gate: with-deck p95 **300.6 ms**,
maximum **370.7 ms**. Deferring source warping too removed avoidable per-click work
and allocation. A separate final-code run with a one-card prior measured click
p95 **238.4/242.4 ms** (with/without prior), all 40 clicks under 290 ms; its
placement p95 was **1,504.0/1,635.0 ms**, with one **2,024.3 ms** outlier.
Earlier runs contended with builds were slower. The final table is the 60-card
run, not a universal worst-case guarantee under scheduling or CPU contention.

The hand-only negative was rerun for **30 seconds / 109 detector samples**:
**0 placement events, 0 prompts**. Chromium used **7.31%** of the entire exposed
eight-core machine (58.45% of one core), including full-reader preparation during
the negative. This is not a controlled CPU comparison with the earlier lazy
reader. Fixture provenance and its narrow scene coverage are preserved below.

Validation: **83 vision tests + 85 targeted web tests + 93 shared remote tests +
4 real-worker camera/table e2e cases = 265 passing cases**. Vision/web/e2e
typechecks and the worker bundle pass. Browser checks cover all four actual table
formats, projected EMZ geometry, automatic lab/table identification and movement,
owner actions and Undo, and recovery from a failed lazy asset request. Review
also reproduced and fixed cancellation-during-clone and appearance-change races;
final review found no remaining actionable defects.

These are warm desktop synthetic timing measurements, not held-out physical
webcam accuracy, mobile performance or measured WebGPU latency. Placement timing
ends at the local identified event; remote network/action/rendering is exercised
separately by e2e and is not included in these latency numbers. The same indexed
image is repeated, so 40/40 is fixture correctness rather than open-set recall.

Reproduce without model/index downloads:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
LATENCY_LABEL=release-60 LATENCY_TRIALS=20 npx tsx scripts/vision/benchmark-latency.ts
FIELD_NEGATIVE_SECONDS=30 npx tsx scripts/vision/benchmark-field-watcher.ts
```

Ignored raw artifacts: `data/vision/benchmark/latency/release-60.{json,log}`,
`release-deferred.{json,log}` (one-card prior, final code), `release.{json,log}`
(JPEG-only deferral), and `data/vision/benchmark/field-watcher/results.json`.
No main-checkout or protected-service changes, port-3000 use, new unit-test files,
model downloads or index rebuilds were needed. No PR is created.

## Earlier implementation snapshots

The remaining sections preserve earlier measurements and their original scope;
the format/latency follow-up above supersedes their watcher timings and stillness
settings. Earlier round-2 work used `feat/remote-vision` in `remote-vision`.
Apache notices remain intact.

## Automatic field watcher — 2026-11-01

Implemented in `feat/remote-autodetect`, based on `origin/feat/remote-ui` at
`0a96a709c`, in `.worktrees/remote-autodetect`. No main-checkout source changes,
protected service changes, new unit-test files, model downloads or index rebuild.

Measured with Node 22.23.3, Chromium 153.0.8010.12, GPU disabled, isolation/SIMD
on, **four actual WASM threads**, eight logical host CPUs and the existing full
index. The HTTP benchmark is offline after preparing one small negative fixture;
it serves on an ephemeral localhost port. Startup requested only
`models/card-detector.onnx`: **no embedding model, index or learning request**.
Detector-only cold initialization took **436.4 ms**.

| Workload / measure | Result |
| --- | --- |
| Real hand-motion negative | 30 s, 120 detector samples, **4.00 fps** |
| False placements / prompts on that negative | **0 / 0** |
| Negative Chromium CPU, entire eight-core machine | **5.17%** (41.33% of one core) |
| Native 1280×720 synthetic card-appearance trials | **5/5 correct sure placements**, no card click |
| Appearance → identified/placed event, median | **2,301.6 ms** |
| Appearance → event, p95 (five trials; maximum) | **2,655.1 ms** |
| Individual wall latencies | 2,552.6 / 1,968.1 / 2,043.2 / 2,655.1 / 2,301.6 ms |
| Placement-trial Chromium CPU, whole machine | **12.33%** (98.66% of one core) |
| Browser errors | **0** |

CPU is the sum of Chromium CDP process CPU-time deltas divided by wall time;
whole-machine CPU divides again by eight logical cores. It includes decoding,
canvas camera/buffering, browser overhead and inference; it is not just detector
CPU. Placement workload includes the first lazy full-reader load. A previous
run under concurrent builds/browser work was slower (median 4.35 s); adaptive
budgeting deliberately reduces detector frequency under load. These numbers do
not describe a GPU, phone or unconstrained laptop battery budget.

The negative is the **3.4-second** published
[IPN Hand example](https://gibranbenitez.github.io/IPN_Hand/images/sample.gif),
looped for 30 seconds, from Benitez-Garcia et al., *IPN Hand: A Video Dataset and
Benchmark for Real-Time Continuous Hand Gesture Recognition* (ICPR 2020), data
CC BY 4.0. Its person gestures in front of a room; there are no playing cards.
It is one short negative scene, not thirty seconds of distinct scenes and not a
real overhead duel-camera false-placement corpus. SHA256:
`0a88ace3eef79a7c5712f25b9a3e0d92657b8e0adc7ccd7f328ac6e76894c3a9`.
The positive trials render one existing indexed standard card on a plain mat
through canvas `captureStream`/a native frame buffer. No claim of physical-card
recall, broad hand rejection or calibrated webcam false-sure rate is made.

Validation: **71 vision tests, 93 shared remote integration tests, 82 targeted
web tests, and 3 real-worker camera e2e cases pass (249 total)**. Vision/web/e2e
typechecks and the worker bundle pass. The final three-case browser run completed
in 25.1 seconds on the isolated development server at port 3449.

Correctness checks include stillness/motion/confidence/partial/overlap gating,
sharpest frame+quad binding, deck priors, uncertain prompts, face-down privacy,
ID persistence for moves and brief occlusion, appearance mismatch replacement,
known-card restart/flip/unknown identity, removal/return/dismissal, stationary
arm surround, normal 200/400 ms buffer jitter, an early missed detection,
adaptive slow samples, cancellation and calibration/defense geometry. Server
coverage verifies same-ref attack/defense changes, owner checks and Undo.
The live fake-camera e2e verifies automatic appearance/movement, local Undo,
owner-table identification+placement with `source:auto`, server Undo with no
reapplication, and recovery after a deliberately failed lazy index request.

The engine is in `packages/vision/src/field-{watcher,motion,zones}.ts`.
`detect-scene.ts` is shared by the normal pipeline and detector-only worker path.
Table wiring is one mount plus a short shared-reader bridge and log suffix;
video sizing, card visuals and CSS are unchanged. Calibration and settings are
versioned localStorage values per user/seat. Frames, appearance descriptors and
physical tracks remain local. Removal and uncertain identity always require a
choice. Automatic placement uses the normal action route/Undo contract.

Reproduce: `npx tsx scripts/vision/benchmark-field-watcher.ts`.
Raw ignored results: `data/vision/benchmark/field-watcher/results.json`.
The script fetches/converts its pinned small hand fixture only if absent; `ffmpeg`
is required for that preparation. Reuses `benchmark-board.ts`'s local card fixture.
Models/index/runtime/dependencies are reused with hardlinks; generated assets,
clips and browser artifacts are not committed. Live trial: `/dev/vision-lab` →
**Auto-detect** → **Start camera**, or enable the camera on a Remote Duels table.

## Board continuation: local peeks, read-all and COVERED

Measured with Node **22.23.3**, Chromium **153.0.8010.12**, GPU disabled,
cross-origin isolation enabled, the actual browser Worker/ONNX WASM path and
the existing **14,652-card** full index. No external requests were permitted
by the benchmark. Five clean local card-photo fixtures were projectively
straightened, then composited into separate **2-, 4- and 6-card** boards.
Far-side cards were turned 180°. These are synthetic arrangements of indexed
cards, not held-out camera images or a claim about arbitrary table layouts.

| Cards in frame | Detected | Correct top-1 | Correct near/far | Warm API median | Warm pipeline median |
| --- | --- | --- | --- | --- | --- |
| 2 | 2/2 | 2/2 | 2/2 | **488.4 ms** | 486.5 ms |
| 4 | 4/4 | 4/4 | 4/4 | **847.9 ms** | 846.2 ms |
| 6 | 6/6 | 6/6 | 6/6 | **1,258.4 ms** | 1,256.7 ms |

Each median uses **3 warm repeats**, with frame decoding outside the timed API
call. Detection runs once per board, followed by sequential local reads.
The first 2-card call, including worker/model/index initialization, took
**1,214.0 ms**. Assignment and top-1 counts above describe the first warm
result per board, **12/12 total** each. The midpoint helper also passed
**100/100** synthetic y positions, including y=.5 assigned far.

An API peek returned the correct local name/tier in **240.7 ms**, including
local fixture fetch/decode. In the built production lab, focus-to-tooltip took
**795 ms**, including the **250 ms** dwell. Focus then hover on the same
outline made **1 worker peek request**, confirming snapshot-cache reuse.
No click, confirmation or AI request was produced by the peek/board paths.

Coverage checks:

- **3/3** distinct synthetic overlap geometries flagged covered; **3/3**
  duplicate/touching/separated controls remained unflagged. A perfect synthetic
  embedding remained `sure` when clean and became `not sure` when covered.
- A real-model synthetic two-card overlap read returned **2/2 `covered: true`,
  tier `not sure`**, preserving the suggested names. The hidden target's
  suggestion can be wrong: this guard suppresses certainty, not reconstructs it.
- A reviewer separately exercised an empty initial detector pass followed by
  two overlapping cards at the 448px fallback scale: **2 detector passes**,
  a perfect embedding, and final **`covered: true`, `not sure`**.

The lab browser check detected **6 outlines**, grouped **3 near / 3 far**,
filled **3 cards into Seat 2's selected near-side twin**, and preserved the
existing single manual confirmation. Moving the pointer during read-all did
not discard the result. Cancel followed by another read and Stop discarded
stale board/tooltip output. API abort returned **`AbortError`**, then the same
recognizer successfully reinitialized. **0 browser errors** occurred in the
API benchmark and lab check. The lab check's one explicit AI request was
intercepted by Playwright; **0 real provider calls** were made.

Validation: **8 targeted core tests + 15 existing lab component tests pass**;
vision/web typechecks, worker bundle and production Next.js build/standalone
packaging pass. Only one new **88-line** test file was added. Existing build
warnings concern the Sentry config import and a broad database trace; the
production build exits successfully. The temporary upstream clone is removed
after source inspection; no upstream executable, installer or trainer ran.

Changed runtime/UI paths: `packages/vision/src/{board,client,pipeline,worker,types}.ts`,
`src/detector/run.ts`, and
`packages/web/app/dev/vision-lab/{use-outline-reads.ts,vision-lab.tsx,vision-lab.module.css}`.
Reproducible tooling: `scripts/vision/{benchmark-board,check-lab}.ts`.
Raw ignored artifacts: `data/vision/benchmark/board/results.json`, three board
JPEGs and overlap fixture (about **0.53 MiB** total with the bundled benchmark
client), plus `data/vision/benchmark/lab-board.json`.

Near/far is a source-frame midpoint heuristic; twins are session-only lab
state with uncertain/face-down/error slots preserved. There is no player/zone
inference, remote-room persistence, depth estimation, hand detection or hidden
art reconstruction. The COVERED thresholds/behavior are adapted for exact
outlines and have not inherited upstream's private real-footage calibration.
Source and feature mapping: [PORTING.md](PORTING.md); usage: [README.md](README.md).

## Full-art coverage and measured accuracy

**Verified real full-art print images available locally: 0; indexed real full-art
prints: 0.** This is a local verified-coverage count, not a claim that such prints
do not exist. The 14,653-record source snapshot has image ID/full/small/cropped
URLs but no print-layout field or image-to-print mapping. Its 552 cards with a
Quarter Century set are not automatically full-art references. The two locally
cached full-card renders are conventional framed cards; the vision cache holds
14,816 derived artwork crops, which cannot establish a print's frame layout.

Konami separately describes extended-art cards in
[Rarity Collection 5](https://www.yugioh-card.com/eu/product/rarity-collection-5/).
[YGOPRODeck's image API](https://ygoprodeck.com/api-guide/) supplies full renders
and cropped art; those URL forms alone do not identify a full-art printing.

`full-art.ts` supplies a conservative frameless/text-box-absence hint. The builder
accepts explicitly verified whole-card references with print IDs, image paths,
provenance URLs and image hashes. When present, this independently keyed index
competes with the standard art-box index on every recognition, with both upright
and 180° whole-card readings. Per-index frame fusion preserves both candidate
lists and keeps priors from manufacturing certainty. Missing references leave
local name correction and optional Haiku name OCR available; the lab explains
this when it detects a possible full-art layout.

| Measurement | Result |
| --- | --- |
| Real full-art reference images / real-print accuracy | **0 / unmeasured** |
| Synthetic full-art fixtures | 3 cards × clean, blur, upside-down = **9** |
| Standard art-box index alone, synthetic top-1 | **6/9 (66.7%)** |
| Standard + whole-card reference index, synthetic top-1 | **9/9 (100%)** |
| Frameless heuristic on those synthetic scenes | **6/9**, so it is not a coverage gate |
| Standard 30-photo regression, top-1 / top-5 | **30/30 / 30/30** |
| Standard regression detected / corners found | **30/30 / 30/30** |
| Standard regression confidence | 29 sure, 1 not sure |
| Warm CPU/WASM pipeline median / p95 | **193.7 / 511.4 ms** |

The synthetic references stretch existing Blue-Eyes White Dragon, Ash Blossom
& Joyous Spring and Maxx “C” art across a full card. They are **not Konami prints**
and never enter real reference coverage or the deployed standard index. Tests
run the actual detector, warp, embedder, full standard catalog and new dual-index
pipeline. Six synthetic scenes miss detection and correctly stay uncertain via
the fallback guard. Real webcam/open-set/full-art accuracy remains unmeasured.
Timing is a fresh standalone run, not a controlled comparison to the prior round.

Reproduce with Node 22:

```sh
npx tsx scripts/vision/build-full-art.ts
npx tsx scripts/vision/benchmark-full-art.ts
npx tsx scripts/vision/prepare.ts --bundle-only
npx tsx scripts/vision/benchmark.ts --label round2-final
```

Raw evidence (ignored generated data):
`data/vision/yugioh-full-art.build.json`,
`data/vision/benchmark/full-art/results.json`, and
`data/vision/benchmark/results-round2-final.json`.

## Optional AI route

`POST /api/remote-vision/ai` requires an authenticated application owner,
`REMOTE_VISION_AI=1` and `ANTHROPIC_API_KEY`. It reuses the existing direct
Anthropic Messages request pattern and shared current model constant,
**`claude-haiku-5-5`**. Request:
`{jpegBase64, localTier, explicitRequest}`. Sure local results require an explicit
request; uncertain results may request a second opinion. The lab uploads only
when **Ask AI** is pressed and explains where the crop goes.

The route accepts fully decoded JPEGs of at most **256 KiB**, with both sides
**32–1024 pixels**, and allows **20 attempts/user/hour** using an atomic SQLite
counter. The **four-second deadline** covers the provider request and response
body; there are no paid retries. Images and provider error payloads are never
logged or stored. The response is
`{name, passcode?, setCode?, match:{passcode,name}|null}`. Unknown, ambiguous or
contradictory readings abstain; no AI output inserts a catalog record.

The browser smoke sent **one mocked request**, with a **23,261-byte JPEG**, no
automatic upload and zero browser page errors. All provider calls in tests are
mocked. No live AI API request or live AI accuracy assessment was made.

Files: `packages/web/app/api/remote-vision/ai/route.ts`,
`packages/web/src/lib/remote-vision-ai.ts`, `packages/vision/src/client.ts`,
`packages/web/app/dev/vision-lab/vision-lab.tsx`.

## Exact upstream inventory and additional ports

[PORTING.md](PORTING.md) inventories the pinned upstream source individually:

| Scope | Ported | Adapted | Not ported | Total |
| --- | ---: | ---: | ---: | ---: |
| Application/support source modules | 4 | 52 | 59 | **115** |
| Tool modules | 0 | 28 | 92 | **120** |
| Relay runtime | 0 | 0 | 4 | **4** |
| Measurement scripts | 0 | 0 | 6 | **6** |
| Extension build entry | 0 | 0 | 1 | **1** |

Build-only test bridges, tests, assets and documentation are explicitly scoped
separately. Every exclusion has a target/reason. Extension injection, browser
storage/relay/reporting, simulator count-badge reconstruction and private-video
harvesting/calibration are not claimed as physical-camera ports.

This round ports/adapts **all-card gold outlines on freeze**, polygon hit testing
with overlapping-card choice and **24 CSS-pixel minimum targets**, exact quad
selection and reruns, a clamped dismissible popover, Tab/Enter/numeric/arrow/Escape
keys, focus restoration, and stale-request/bitmap disposal. Face-down outlines
remain visible deliberately. A masked warp preserves whole-card geometry for
partial cards and fills unseen regions with the profile artwork mean; partial
results cannot be sure. Upside-down and back matching remain enabled. The
standard art box follows upstream's measured pendulum choice; the pendulum-only
crop is not silently forced at runtime. The retained training tools comprise
seven embedder and seven detector Python modules, with precise exclusions.

The board continuation above adds hover/whole-board recognition and adapts the
COVERED guard for exact outlines. Upstream drag-box input semantics, calibrated
padded-redetection policy and brightness-based orientation ordering remain
boundaries, with their reasons in PORTING.md. The seen mask detects source-frame
truncation, not hands/objects occluding pixels inside the frame.

## Verification and delivery

- **24/24** vision unit/pipeline/masked-warp tests.
- **39/39** mocked AI-route tests and **15/15** lab component tests.
- Vision and web TypeScript checks passed.
- Isolated real Chromium/WASM lab smoke on **3418**: outline selection, keyboard
  focus, AI crop request and Resume cleanup passed; zero page errors.
- Optimized Next.js webpack production build passed, including the AI route and
  standalone tracing. Worker rebundled. No new production service was deployed.
- Temporary upstream clone and isolated dev/build outputs removed after checks.
  Existing unrelated `packages/web/next-env.d.ts` development imports retained.
- Small feature commits: AI `b74dd8503`, vision core `e20ad909d`, lab `d4d0ce489`.
  Final documentation commit and pushed branch head are reported in the final
  response. No PR or merge.

## Player feedback continuation — 2026-11-01

Delivered on `feat/remote-vision-feedback`, starting at `d6a712928`. Work stayed
in `.worktrees/remote-vision-feedback`; the main checkout, port 3000 and port 3417
were untouched. No PR, merge, deployment, training run or paid AI request.

Implemented: default-off per-account consent and a once-only lab prompt; explicit
pick/search/voice/accepted-AI `recordFeedback`; safe detected-card JPEG capture;
bounded shared SQLite/private-disk storage; independent-user consensus or owner
approval for deployment-wide learned references; confusion-pair second checks;
owner review and daily tier metrics; user/account deletion and hourly retention;
admin-approved trainer export; actual-pipeline crop comparison/regression gate.

Tables: `vision_feedback_preferences` (choice, prompt time, rate window) and
`vision_samples` (private user ownership, JPEG size, normalized embedding, original
top-five scores, chosen ID, tier/source, frame class, sharpness, game/model/hash,
index/preprocessing space, review state). JPEGs are UUID-named private files under
`vision-feedback/` beside SQLite. Limits are 30 days, 5,000 samples, 64 MiB of
crops, 32 KiB per JPEG and 60 submissions per user/hour. Fallback, partial,
covered and card-back results do not produce feedback evidence.

The learned delta is derived from live eligible samples, never an independently
retained index file. Deletion/rejection therefore withdraws references and
confusion evidence on the next worker request. Compatible model/index/layout
identity is required. Consensus requires another authenticated user with the same
label and cosine >= .97. Confusion pairs require two different users; extra
views and a .06 margin cannot manufacture a higher similarity. At most 512
references and 256 confusion pairs are served. Accuracy labels explicitly say
“among submitted feedback”; this is not a denominator for all recognition scans.

Fresh verification with Node **22.23.3**:

| Check | Result |
| --- | --- |
| Targeted vision pipeline/client/board cases | **27 passed** |
| Shared feedback integration, account deletion and DB connection | **27 passed** |
| Existing web lab, feedback/admin routes, AI-route and live-stats files | **82 passed** |
| Existing real worker-process lifecycle cases | **5 passed** |
| Total targeted automated cases | **141 passed**, zero failures |
| Shared + worker TypeScript builds; vision/web/worker typechecks | Passed |
| Worker/runtime bundle | Passed |
| Real Chromium/WASM consent → capture → owner review → delete | Passed; **0 page errors** |

The real browser smoke used Chromium **153.0.8010.12**, GPU disabled, an isolated
E2E account/database and port **3438**. It verified default-off consent, decline,
no repeat prompt, account opt-in, one confirmation upload with **384 embedding
values and five candidates**, private admin crop retrieval, approve/reject delta
withdrawal and deletion of the user's sample. The server-retained JPEG was
**13,898 bytes**. A React StrictMode prompt race was reproduced and fixed, with
an existing-file regression case. Desktop/mobile admin and account screenshots
were inspected. The temporary server was stopped by its PID.

A separate native-ONNX smoke used the full **14,817-vector / 14,652-card** index
and five existing clean synthetic photo fixtures. The detector first produced
eligible exact card crops, which were saved through the real feedback service
under an isolated fixture user. The benchmark then decoded/re-embedded those
retained JPEGs through `RecognitionPipeline`'s selected-card path:

| Metric | Baseline, no delta | Candidate, contributor held out |
| --- | --- | --- |
| Top-1 | **5/5 (100%)** | **5/5 (100%)** |
| Top-5 | **5/5 (100%)** | **5/5 (100%)** |
| Sure / sure-but-wrong | **5 / 0** | **5 / 0** |
| Recognition errors | **0** | **0** |
| Comparison gate | Baseline only | **PASS**, same corpus/hash |

The five approved samples exported as trainer-compatible `list.json` plus a
labelled manifest and **84,618 bytes** of JPEGs. Exact warped cards use
`mCrop:0`; there is no upstream padded-harvest assumption. Temporary smoke data,
reports and screenshots occupy about **2 MiB**, all ignored. Existing models and
index files were reused without downloads or duplicate model storage.

These five indexed-card synthetic fixtures demonstrate the workflow and absence
of a regression, **not a measured real-player accuracy gain**. No real-player
samples or physical webcam test corpus were available. The crop benchmark cannot
measure source-frame detection because those frames are deliberately not retained.
Contributor/identical-crop holdout prevents self-reference gains; evaluating a
model trained on the same corpus still needs a separate held-out dataset. Offline
exports are private copies and need owner deletion/rebuilding after a privacy
request; live deletion cannot erase copies moved elsewhere or undo trained weights.

Run with `REMOTE_VISION_FEEDBACK=1`, matching `WEB_URL`, absolute `DATABASE_PATH`
and prepared `VISION_DATA_DIR`, then opt in at `/settings/account`. The lab is
`/dev/vision-lab`; owner review is `/admin#vision`. Native offline commands:

```sh
npx tsx scripts/vision/feedback.ts export --out /private/new-approved-dataset
npx tsx scripts/vision/feedback.ts benchmark --no-learning --out /private/before.json
npx tsx scripts/vision/feedback.ts benchmark --out /private/after.json --baseline /private/before.json
npx tsx scripts/vision/feedback.ts prune
```

Raw ignored evidence: `data/vision-feedback-smoke/{before,after,browser}.json`,
`export/{manifest,list}.json`, private JPEGs and screenshots. Operational commands,
version overrides, browser smoke configuration and privacy limitations are in
[the feedback runbook](../../docs/runbooks/vision-feedback.md). The canonical
marketing privacy page was updated; the app's legal links point there and it has
no separate privacy/terms page.

## Recognition review follow-up — 2026-11-01

Implemented the requested Part 1 scope from
`data/briefs/remote-duels/recognition-review-and-explainer.md` on
`feat/remote-vision-feedback`, starting at `a73bb2c5f`. All writes stayed in
`.worktrees/remote-vision-feedback`. The main checkout and existing port 3000/3417
processes were left alone. No retraining, paid API request, PR or merge.

| Item | Delivered |
| --- | --- |
| (2) Deck-first/catalog search | Actual restricted deck-row scan runs before the catalog scan. A confident off-deck clean winner survives; ambiguous reads can prefer a qualifying deck candidate. Sure always requires the same unboosted full-catalog winner and margin, so a wrong decklist cannot manufacture certainty. No unmeasured webcam accuracy gain is claimed. |
| (2) Physical index | In-memory filter removes Skill/nonphysical zero-passcode rows and duplicate image IDs, retaining field Tokens and alternate art. **14,817 → 14,652 vectors; 14,652 → 14,487 card identities**, plus the back. Builder catalog policy v3 applies to future builds. No shared binary/metadata rewrite or re-embedding. Ordinary Skill Drain/Prisoner/Successor cards remain eligible. |
| (4) Correctness | Every evaluated frame must independently agree with the final clean identity and pass confidence. Temporal frames redetect quads rather than reuse a selected outline. Face-down art guesses cannot be sure or contribute feedback. Exported remote message includes tier, covered and faceDown. |
| Vision-side (3) | Safe first frame with clean lead ≥ .05 can end a read. Learning snapshots refresh once on initialization and every 60s outside inference; failed refreshes retain the prior version for at most 120s. Shared own-feed buffer keeps native pixels, up to six frames/one second, without a fresh recording delay. The lab consumes this API. |
| P2 / P7 / P8 / P11 | Learned crops only rerank clean top-ten identities, cosine ≥ .90, cap eight/card; clean scores/competitors establish sure. Known confusion identities do not use learned rows. Actions use positive catalog IDs, including Token IDs, rather than zero passcodes. AI receives a separate **640 × 933** warp made from source pixels and ten clean candidate names; out-of-list responses abstain. Feedback remains a bounded 224px JPEG. README now says **broadcast-calibrated, not webcam-calibrated**. |
| (1) Tooling | Explicit lab mode labels true cards and arbitrary non-card targets, exports native JPEGs plus raw candidates/guards/provenance, and keeps captures local. Offline import merges batches without dropping old labels. Threshold tuning replays the recorded tier, uses cards and negatives, excludes wrong crop/frame/final decisions with a .01 safety gap, and maximizes sure coverage within conservative single score/margin rules at **zero observed wrong sure**. It emits a version-bound runtime configuration and condition/width/deck reports. |

The remote room and strict data-channel schema are on the separate
`feat/remote-ui` branch and do not exist here. This work supplies
`toRemoteRecognitionResult` and its typed payload; that branch must accept and
preserve the new fields when integrated. Actual remote-room click latency was
not measurable in this worktree.

### Synthetic before/after

Reused the exact existing **30 JPEGs**, seed **633**, five each of clean, blur,
perspective, glare, sleeve and combined conditions. No new reference downloads.
Node **22.23.3**, Chromium **153.0.8010.12**, Ryzen 7 9800X3D, WSL2, GPU disabled,
WASM SIMD/four threads with cross-origin isolation. Both workers used the same
model weights and original on-disk catalog; the candidate filters it in memory.

Unrelated worktrees began CPU-heavy Next/browser jobs during measurement. The
initial isolated-before run measured pipeline p50/p95 **235.2/426.7 ms**; the
first contended after run measured **773.8/1080.2 ms**. These runs are retained
but do not establish a latency regression. The comparison below instead runs
the old worker from `a73bb2c5f` and the candidate consecutively for each photo in
one browser, under the same ongoing load. Baseline runs first for each pair,
so residual scheduling/order noise remains.

| Metric | Before | After |
| --- | ---: | ---: |
| Top-1 | **30/30 (100%)** | **30/30 (100%)** |
| Top-5 | **30/30 (100%)** | **30/30 (100%)** |
| Detected / corners found | **30/30 / 30/30** | **30/30 / 30/30** |
| Sure | **29/30 (96.7%)** | **30/30 (100%)** |
| Sure-but-wrong / all positives | **0/30** | **0/30** |
| Wrong / sure answers | **0/29** | **0/30** |
| Pipeline p50 | **389.9 ms** | **428.8 ms** (+10.0%) |
| Pipeline p95 | **694.3 ms** | **659.6 ms** (−5.0%) |
| Worker API wall p50 / p95 | **393.1 / 700.6 ms** | **430.8 / 661.5 ms** |
| Six-frame API read (one fixture) | **839.7 ms; 3 frames** | **270.6 ms; 1 frame** (−67.8%) |

The full-catalog top-1/top-5 and wrong-sure gates hold; paired p95 is below the
+20% budget. These are indexed-image synthetic positives, **not a physical
webcam/open-set evaluation**. The off-card fallback probe remained `low match`;
one negative probe does not establish a false-positive rate. The Skill duplicate
that previously narrowed Double Evolution Pill's lead no longer blocks sure.
No physical webcam corpus was available, so there are **no real webcam accuracy,
negative sure-rate, mobile latency, or set-code readability measurements**. The
640px output preserves available text pixels; it cannot recreate text missing
from a distant or blurred source frame. No webcam-calibrated threshold file is
published from synthetic or mocked data.

Raw ignored evidence:
`data/vision/benchmark/results-review-before.json`,
`results-review-after.json`, `results-review-paired.json` (contains both workers'
per-photo records and timings), and their matching logs.

### Verification and tooling reproduction

The focused regression file is `packages/vision/src/pipeline.test.ts`; it covers
deck restriction/off-deck fallback, Skill Drain preservation, Token ID mapping,
poisoned references inside/outside the clean ten, face-down art sleeves,
disagreeing/moving frames, early exit, learning-cache expiry, source AI crop,
threshold safety including a misleading whole-card view, and a mocked AI answer
outside its candidate list. No paid API is called.

```sh
npx tsx --test packages/vision/src/pipeline.test.ts
npx tsc -p packages/vision/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit --incremental false
npx tsx scripts/vision/check-realset.ts
npx tsx scripts/vision/tune-thresholds.ts \
  --input data/vision/realset-smoke/export.json \
  --import-dir data/vision/realset-smoke/imported \
  --out data/vision/realset-smoke/thresholds.json
```

The browser harness bundles the actual lab React components and runs the actual
WASM worker on an ephemeral HTTP port. It mocks API responses and the unrelated
shared sheet button, avoiding Next's server/font build environment. It does not
start or stop a Next server, touch protected ports, or change a real user's
feedback preferences. Its synthetic camera is explicitly labelled as such.


Fresh verification: **25/25 cases passed in the one small targeted test file**;
vision and web TypeScript checks passed; browser worker bundle generated. The
isolated real-component/real-WASM smoke exported **one labelled card and one
empty-mat negative**, reproduced both recorded tiers offline, retained native
**1920 × 1080** buffer frames, and made **one mocked AI request** with a
**640 × 933, 95,685-byte JPEG and ten candidate names**. Repeated reads used
**one learning fetch**; starting a new recognizer for the camera used a second
initialization fetch. There were **zero feedback uploads and zero browser errors**.
A new freeze cannot export prior live evidence while detection is busy.

The offline smoke replay had **top-1/top-5 1/1**, **one correct sure**, and
**zero sure-but-wrong / 2 total samples** before and after tuning. A second import
with copied smoke imagery and distinct IDs retained all **four records**, with
zero wrong sure; this verifies batch retention, not additional accuracy evidence.
The deliberately poisoned/mock threshold regression also excludes wrong sure
and demonstrates refusal to calibrate without both cards and negatives.
The generated smoke threshold JSON stays under `realset-smoke/`; it is **not**
the default runtime threshold file.

Evidence: `data/vision/realset-smoke/{report.json,export.json,capture.png,unit.log,
thresholds.json,thresholds.report.json,thresholds-merged.report.json}` and
`imported/manifest.json` plus its two JPEGs. Temporary baseline source and UI
bundles were removed; models/runtime/index were reused. Only the pre-existing
`packages/web/next-env.d.ts` change is intentionally left uncommitted.

To repeat the paired comparison, build the old worker from the pinned source
without switching checkouts, then use the ordinary benchmark's comparison mode:

```sh
mkdir -p data/vision/baseline-src
git archive a73bb2c5f packages/vision/src | tar -x -C data/vision/baseline-src
npx esbuild data/vision/baseline-src/packages/vision/src/worker.ts --bundle \
  --format=esm --platform=browser --target=es2022 --minify \
  --outfile=data/vision/worker-before.js
npx tsx scripts/vision/benchmark.ts --label review-paired \
  --compare-worker /dev/vision-lab/assets/worker-before.js
```

Small commits: `317c51d8b` core safety, `6c2b35894` AI candidate validation,
`6dd70e15e` raw replay/calibration, `620c752df` native lab capture. The final
follow-up/documentation commit and pushed head are reported in the final answer.
