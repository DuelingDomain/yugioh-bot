# Set and flip detection

This is the standalone `b1dd8e1fc` receipt, using 64 labels and a 320 ms reader.
The [combined receipt](vision-combined.md) uses the hand rework's 71-label setup
and includes the Oak delay repair and the current safety checks.

Local result: reviewed Set recall **1/6 → 3/6** (the two recovered Sets are late),
and flips **0/2 → 2/2**, both on time and on their original refs. Three Sets remain
blocked. No new object or hand-card placement was found in the ten clips.

## Changes

Only `packages/vision/src/field-watcher.ts` changes product behavior:

- Field-track face gates allow 1500 ms between clean samples. CPU scans in this
  replay are often 830–898 ms apart; the old 650 ms expiry restarted confirmation.
  Sample counts, minimum duration, positive-back evidence and rest checks stay intact.
- A real detector front of an existing Set opens a 1500 ms reveal window. Fresh
  independent front pixels can confirm locally while hands move elsewhere.
  This also covers a pending reveal whose first read was interrupted. The window
  never extends on cached boxes and watcher interruptions close it. Hand contact,
  local motion, blur, coverage and the mat plane still gate this path. It cannot
  start a new card or publish an identity without the normal successful read.
- One clean `low match` reveal gets a fresh-frame retry before prompting. A
  second failure still prompts without publishing a hidden identity.

The detector, image evidence thresholds, sleeve matching, geometry and web
product code are unchanged. New Vitest cases live in
`packages/web/tests/vision-set-{admission,and-flip}.test.ts`, where the existing
Vitest runner discovers them. This avoids putting Vitest files in vision's
`node:test` source glob.

## Reproducible comparison

All receipts, prefixed harness copies and JSON output are under ignored
`data/replay/sim-fixset/` (`R` below). The accepted comparison is
**`R/before-pinned/` versus `R/final/`**. `R/result.json` identifies accepted and
intermediate runs. No clips or extracted images were written outside the eval
worktree's data directory. Source frames were inspected in memory.

Inputs are pinned to the supplied corrected baseline's own
`/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/run2-baseline/inputs.json`.
The shared input file had different APS 2016 and Jimothy calibration corners.
Eight initial controls were retained and those two controls were rerun with the
original corners. Each clip has independent workers and clock. All ten controls
then matched run2's semantic events exactly; see
`R/before-pinned/baseline-verification.json` and its provenance receipt.

Final replay: Node 22.23.4, current reader, 170/320 ms fixed detector/reader
requests, four-corner grids, virtual clock, one native inference thread per lane,
and at most two replay runners concurrently. All ten final clips have zero
watcher errors. The offline sink runs product proposal helpers; it does not prove
React, HTTP, reducer or owner-camera behavior. No download, training, Git write,
PR or deployment was performed.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node data/replay/sim-fixset/sim-fixset-run.mjs baseline \
  --inputs /Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/run2-baseline/inputs.json \
  --out data/replay/sim-fixset/rerun-final
```

## Every Set and flip label

`B` means `R/before-pinned/runs/`; `A` means `R/final/runs/`. The full detector,
rest, face, evidence and rejected-box rows are in `R/label-blockers-before.json`
and `R/label-blockers-after.json`. Frame numbers below are zero-based at 30 fps
in each run record's `clip.file`; no JPEG copy is needed.

| Label | Exact baseline blocker | Final result / frame evidence |
| --- | --- | --- |
| APS 2002 Set `truth-0`, M3 | Already admitted at 20.216 s, positive uniform back. First clean sight is censored by the cut/hand. | Retained at 20.216 s. |
| APS 2002 flip `truth-1`, M3 | At 26.976 s the only useful front box scores .768 but contact is .50251. Clean fronts then occur between scans while global motion prevents cached confirmation. A returning hand cancels the first read. Later scans miss the card; the old Set was removed at 32.126 s. | Same ref ending `-2` reveals Mysterious Puppeteer at **28.282 s**, delay **1.282 s**. Source frame **848**, capture 28.2667 s. Reads at 27.108 and 27.962 s score .8933/.8960; the first was interrupted. See `A/aps-2002-duel.json`, `rule.set-reveal-recovery`, and `R/aps-front-probes.json`. |
| Solemn flip `truth-2`, S3 | Front pixels are positive at 23.628 s, but the first read scores .72386 (`low match`), then immediately prompts at 24.448 s. Earlier clean local frames were starved by global confirmation checks. | Same ref ending `-9` reveals Original Sinful Spoils at **23.168 s**, delay **.668 s**. Source frame **695**, capture 23.1667 s. |
| Lostzone Set `truth-8`, S3 | Positive independent back at 46.572 s (SD 17.418, confidence .82), but contact .06784 blocks rest. At 47.442/48.212 s contact is .05990/.04545. At the brief release, 49.082 s, pixels abstain and SD 9.843 exceeds the uniform limit 8. Later boxes have only 18% in S3. There is no clean resting window for admission or its 600 ms prompt. | Still missed. See `B/lostzone-yubel-ryzeal.json`; source captures 46.400/48.900 s, frames **1392/1467**. |
| Jimothy Set `truth-2`, S3 | Track 5 rests with positive backs at 38.882, 39.712, 40.610 and 41.480 s; SD 3.506–3.962. Every face gate remains unknown because each scan gap exceeds 650 ms. | S3 commits at **40.610 s**, delay **9.110 s**. Source frame **1213**, capture 40.4333 s. |
| Jimothy Set `truth-3`, S5 | Initial track 6 has positive uniform backs at 32.922/33.818 s (.580/.554 detector scores), but contact then motion prevent rest. After spacing, the rightmost sleeve lacks a usable continuing detector box. The nearby third sleeve maps to S4 and fails the aspect guard. | Still missed. Initial captures 32.733/33.633 s, frames **982/1009**; inspect the four separated sleeves at frame **1213**. |
| Jimothy Set `truth-4`, S4 | Weak third-sleeve boxes are rejected by `cardAspect` before a track starts: e.g. 38.052 s, score .438, centre .773/.512, debug use `not card-shaped`. This is not a positive-back refusal. | Still missed. Source frame **1136**, capture 37.8667 s; rejected-box evidence is retained in the blocker JSON. |
| Jimothy Set `truth-5`, S2 | Track 7 reaches rest with positive back evidence, but clean observations at 38.882/39.712/40.610/41.480 s repeatedly expire in the face gate. | S2 commits at **40.610 s**, delay **3.610 s**. Same source frame **1213**. |

## Scores and the matching limitation

These are the **unchanged automatic matcher** results, in order
**on time / late / missed / other wrong outcome**. Eight unscored observations
are excluded from this table.

| Label type | Before | After |
| --- | --- | --- |
| Set (6) | 1 / 0 / 5 / 0 | 1 / 0 / 3 / 2 |
| Flip (2) | 0 / 0 / 2 / 0 | 2 / 0 / 0 / 0 |
| Monster (24) | 11 / 0 / 12 / 1 | 10 / 1 / 12 / 1 |
| Spell/trap (5) | 1 / 1 / 2 / 1 | 1 / 1 / 2 / 1 |
| To Graveyard (10) | 3 / 1 / 2 / 4 | 3 / 1 / 2 / 4 |
| Move (5) | 3 / 0 / 2 / 0 | 3 / 0 / 2 / 0 |
| Return to hand (3) | 0 / 1 / 2 / 0 | 0 / 1 / 2 / 0 |
| Removed (1) | 0 / 0 / 1 / 0 | 0 / 0 / 1 / 0 |
| Hand show (8) | 0 / 0 / 8 / 0 | 0 / 0 / 8 / 0 |
| Total (64) | **19 / 3 / 36 / 6** | **20 / 4 / 32 / 8** |

Jimothy's approximate label coordinates cause greedy matching to consume the S2
commit for the earlier S3 label, then the S3 commit for S4. Direct review of frame
1213 shows both commits on real, separated sleeves in S2 and S3. The reviewed
assignment retains the original 15 s horizon: **Sets 1 on time + 2 late + 3 missed**.
`R/final/set-flip-reviewed.json` records this correction separately; raw
`score.json` is untouched. Raw totals are not presented as reviewed recall.

Placements **42 → 43**; total prompts **7 → 5**, including actual card-presence
questions **2 → 1**. Median matched delay **1.058 → 1.246 s**, p95
**5.620 → 5.026 s**; these use different successful-label cohorts. One existing
Solemn Snake-Eye Oak label regresses from **1.222 to 4.582 s** and becomes late.
See `R/final/comparison.json` for every changed label.

## Phantom protection and checks

All **48** retained false-box crops were rechecked with the unchanged image
functions: **31/48 rejected**, zero changed image verdicts
(`R/false-boxes.json`). This is separate from temporal replay proof.

All three unmatched new placement events were reviewed directly: the two named
reveals above and the resting pink S3 sleeve. The two unmatched old GY placement
events are now moves of those revealed Set refs. Other placement episodes match
one-to-one within .065 image units and 15 s.

Existing **non-card phantoms 2 → 2**, **hand-card placements 4 → 4**, and one
existing duplicate Set remains. The phantoms are printed mat art in the two
remote clips, not newly admitted objects. **New non-card phantoms: 0; new
hand-card placements: 0.** See `R/baseline-review.json` and
`R/final/placement-review.json`. Prior visual review is inherited only for the
seven unaffected clips with identical placement geometry/time; the three
formerly corrupt clips and added events were reviewed from corrected inputs.

- **11/11 Vitest cases pass** under the existing web configuration.
- **137/137 existing watcher tests pass** (`board.test.ts`).
- Regressions fail on the original watcher. The interrupted-read regression also
  fails with the bounded window restricted to already settled tracks, then passes
  when the existing Set binding survives pending recognition.
- Scoped TypeScript and `git diff --check` pass. Full vision TypeScript still
  reports the unchanged `web-runtime.ts:221` GPU adapter type error.

Receipts: `R/test-before.log`, `R/test-binding-before.log`, `R/test-final.log`,
`R/board-tests-final.log`, `R/typecheck-scoped.log`, `R/typecheck.log`.

Open: Lostzone contact/cell/pixel ambiguity; Jimothy S4 aspect and S5 proposal
coverage (geometry work is left to its owner); the Oak delay regression; the two
existing mat-art phantoms, four hand-card placements and duplicate. These local,
agent-labelled video results do not establish unseen-camera accuracy.
