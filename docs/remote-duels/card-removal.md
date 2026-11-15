# Card removal

This is the standalone `7af1194a4` receipt. The [combined receipt](vision-combined.md)
includes the lost Cardmarket match repair and the current 71-label comparison.

## Corrected baseline

Checked on `fix/vision-removal-delay`, starting at `3cdc33aca813163bb6ff2768e7db516eb4b1d234`.
Evaluation root: `/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/`.
All times below are seconds within a clip. Ref numbers are the final suffix of a watcher ref.

`v2/run2-baseline/runs/*.json` and `v2/run2-baseline/score.json` are the source evidence.
Seven clip logs are identical to `run1-baseline`. Cardmarket, Jimothy and BgmToxqmo4s differ;
their old R3 board verdicts must not be carried forward.
All eight product source hashes recorded in the corrected baseline build match this
branch's starting HEAD, including the watcher, detector, reader and glue.

The comparable R3 set has eight physical lifts with a virtual source. Five clear and three
stay stale (four stale refs, because Original Sinful Spoils has two refs). Applied source
clearance delays are 1.834, 2.926, 4.610, 7.620 and 12.452 seconds: median 4.610 seconds,
nearest-rank p95 12.452 seconds. These are source removals, not proof of the correct destination.

Across all corrected v2 clips, Cardmarket adds one established source. There are 9/12
established sources, 6/9 cleared and 3/9 stale source episodes. Median clearance delay
is 5.068 s; p95 is 12.452 s. Cardmarket also has an unrelated false removal during a
camera cut. Source clearance alone does not prove a safe or correct destination.

The automatic scorer reports nine removal labels matched, 42 placements and seven prompts
(two presence prompts). It can match a wrong card or a pile arrival. Its nine matches are
not nine verified removals. Placement/phantom classifications from the faulty run cannot
be treated as current proof.

## Per-card check

Label numbers are zero-based indices in `v2/review-removals/labels.json`. The old contact
sheets still show the physical event; the board evidence below comes from run2 logs.

| Label | Clip/card | Corrected baseline evidence |
|---|---|---|
| 0 | APS 2002, Puppeteer flip, 26.5 | Ref 2 stays face-down until its departure. This is a flip failure. |
| 1 | APS 2002, Puppeteer lift, 30 | Ref 2 clears at 32.926; 2.926 s. Blur and shadow holds precede removal at 32.126; glue adds 0.800 s. Transfer is bracketed by a cut at 28.5–31.5. |
| 2 | Solemn, Poplar move, 7.5 | Ref 3 moves S1 to M1 at 9.980. |
| 3 | Solemn, Original Sinful Spoils flip, 21.5 | Ref 9 prompts at 24.448; original refs 2 and 9 remain field entries. A prompt does not flip the board. |
| 4 | Solemn, Temple lift, 23 | Ref 1 reaches GY at 24.834; 1.834 s. Same-ref transfer clears the source. |
| 5 | Solemn, Original Sinful Spoils lift, 27 | Refs 2 and 9 stay stale. New named GY ref 13 at 32.942 does not clear them. Ref 9 has 297 shadow-hold notes after 27; no removal. Ref 2 also follows a hand-area sleeve. |
| 6 | Solemn, WANTED, 40 | Shown from hand; no field source to remove. Named BANISHED arrival at 43.120 disagrees with the GY label. |
| 7 | Solemn, Oak lift, 46.5 | Ref 12 clears at 54.120; 7.620 s. It has 84 shadow-hold notes after the lift, then removal at 53.320. GY rebinding is later, at 58.418. |
| 8 | Solemn, Poplar lift, 49 | Ref 3 remains M1. After 49 there are 130 shadow-hold notes and 12 full-scan miss notes; no removal. The GY event at 58.418 is Oak. |
| 9 | Cardmarket, Spell pickup, 52 | Corrected run now has source ref 17, read as Hapi in S5. It clears only at 57.526, after an edited presenter shot. Hermitree ref 11 is also falsely removed during this cut and returns at 58.278. Run1's empty-board verdict is invalid here. |
| 10 | Lostzone, Droll, 2.5 | Arrival from hand in GY at 3.360. No field departure tested. |
| 11 | Lostzone, Nightmare Pain move, 11 | Same ref 5 moves S4 to S2 at 14.040. |
| 12 | Lostzone, Spirit lift, 13 | Ref 3 clears at 17.610; 4.610 s. Removal at 16.810 follows eight full misses over 3.5 s and repeated shadows. Named GY membership arrives at 34.108. |
| 13 | Jimothy, pink sleeve pickup, 3.5 | No initial virtual source. Corrected run places a different Set ref 7 much later, at 51.688. It cannot prove this removal. |
| 14 | 29hZVYmE3tc, Spell lift, 40 | Pot of Desires ref 9 clears at 52.452; 12.452 s. It has 137 shadow-hold notes after 40, then removal after 12 full misses over 9.333 s. Destination defaults to HAND, not the observed side pile. |
| 15 | 29hZVYmE3tc, temporary sleeve pickup, 57.5 | Ref 14 stays S3. The final full misses still report a hand over the spot at 58.492 and 59.312. Timeout must not override that hand evidence. |
| 16 | BgmToxqmo4s, monster shift, 15 | Corrected run has Phalanx ref 6, but no move to the left source location. It stays virtual M4 until GY at 43.544. Covered/hand/outline evidence also keeps it; this is not solely a shadow delay. |
| 17 | BgmToxqmo4s, Spell lift, 17.5 | Corrected ref 5, Divine Lance, moves S1 to GY at 19.842; 2.342 s. Run1's empty-board verdict is invalid. |
| 18 | BgmToxqmo4s, sideways card shift, 36 | No applied board move at this event. Existing pile identification events do not prove the source shift. |
| 19 | BgmToxqmo4s, field lifts, 39 | Ref 6 reaches GY at 43.544, but its virtual M4 source was already stale after label 16. Do not count this as a second independent successful source removal. |
| 20 | SlUY5fXnL8k, defense card lift, 7.5 | No initial committed board entry. Later replacement detection cannot prove removal. |

## Removal rule

Repeated sharp scans with no hand, no card texture and no valid outline can outlast a moving
shadow after 1.5 seconds. Actual blur must never become absence evidence merely because a
timer expired. Sharp frames must return, or a real camera/exposure change must reset the
focus baseline. A hand covering a card for 1.5 seconds must keep the same ref without a
remove/place cycle.
The reader keeps its exposure relearning; removal retains a separate focus reference.

Keep real covered-card/stack evidence separate from an absent card. A different outline
alone cannot prove that a card underneath it left. Unanswered presence prompts and held-card
placement guards still own their existing decisions.

## Validation status

The four requested regressions in `packages/web/tests/field-removal.test.ts` use the real
watcher and a manual clock. Before the fix, moving-shadow removal, prolonged blur and
recovery after a hold failed; the 1.5-second hand cover passed. Six further tests cover
unchanged card pixels under shadow, a longer hand cover, blur interrupting clear evidence,
full-scan absence over a changed textured spot, and focus validation after an exposure
change. All ten pass. A sharp unchanged card can validate the new exposure; unchanged
coarse colour with lost detail cannot. A timer never validates focus.

The 148 existing board, face-state and pile tests pass. Vision typechecking stops at the
unchanged GPU adapter type error in `packages/vision/src/web-runtime.ts:221`.

Script copies and all output are under the gitignored `data/replay/sim-fixrm/` folder.
`analysis/run2-per-card.json` records all 21 corrected baseline source checks.
`provenance.json` pins the actual commit, source hashes and input hashes.
No frames or crops are exported. The eval worktree is read only.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts packages/web/tests/field-removal.test.ts --maxWorkers=1
node --import tsx --test packages/vision/src/board.test.ts packages/vision/src/face-state.test.ts packages/vision/src/field-piles.test.ts
node data/replay/sim-fixrm/scripts/sim-fixrm-run.mjs baseline \
  --inputs /Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/run2-baseline/inputs.json \
  --out data/replay/sim-fixrm/after-new
```

Set `SIM_FIXRM_BEFORE=1` with a separate output folder to use the frozen original watcher.
## Final replay

`after-final/` completed all ten v2 clips in 550.47 s, with zero watcher errors. All grids
match frozen `run2-baseline/inputs.json`. The reader, 170/320 ms inference costs and
800 ms departure glue are unchanged. Output contains JSON and bundles, with no frame exports.

| Measure | Corrected baseline | Final build |
|---|---:|---:|
| Established sources among 12 lift labels | 9 | 9 |
| Applied source clearances | 6/9 | 6/9 |
| Stale source episodes / refs | 3 / 4 | 3 / 4 |
| Source clear within 3 s of clean rest | 2/9 | 4/9 |
| Clearance median / p95, physical event to applied board move | 5.068 / 12.452 s | 3.584 / 5.952 s |
| Automatic removal labels matched | 9 | 8 |
| Placements / prompts | 42 / 7 | 42 / 7 |
| Known reviewed phantom / hand-card placements | 1 / 4 | 1 / 4 |

Latency includes only the six clearances in each run, not failures. The cleared sets differ:
Poplar now clears, while Cardmarket no longer clears during blurred camera-cut evidence.
Across the same five sources cleared in both runs, median delay is 4.610 to 3.716 s.
In the original comparable R3 group, 5/8 sources cleared before and 6/8 clear now.
Automatic matching loses Cardmarket's former late return-hand match; it still does not
prove that other matched labels cleared their actual source or reached the right destination.

| Source | Baseline clearance | Final clearance | Event-to-clear delay before → after |
|---|---:|---:|---|
| Puppeteer | 32.926 | 33.716 | 2.926 → 3.716 s; 0.790 s slower |
| Temple | 24.834 | 24.834 | 1.834 → 1.834 s |
| Original Sinful Spoils, two refs | none | none | pending flip / wrong sleeve association |
| Oak | 54.120 | 52.452 | 7.620 → 5.952 s |
| Poplar | none | 52.452 | stale → 3.452 s |
| Cardmarket Spell | 57.526 | none | stale; tracker follows the hand-area box |
| Spirit | 17.610 | 15.944 | 4.610 → 2.944 s |
| 29hZ Spell | 52.452 | 44.776 | 12.452 → 4.776 s |
| 29hZ temporary sleeve | none | none | hand remains over the tracked spot |

All 42 placement episodes pair by identity, zone, face, position, time and corners. There
are no new or lost episodes. Thirty-eight placement signatures are exact; four existing
real-card episodes occur 0.018–0.486 s earlier, with at most 0.00116 normalized corner shift.
Those four still have no touch and low motion. All five known false-placement events have
identical timestamps, geometry, identity, face and position. This found no added phantom or hand-card
placement in this replay. It does not supply a new absolute phantom census for every clip.
Seven total prompts, including two presence prompts, are unchanged.

Evidence under `data/replay/sim-fixrm/`:

- `analysis/run2-per-card.json`: all 21 corrected baseline source checks and hold notes.
- `analysis/before-per-card.json`, `analysis/after-per-card.json`, `analysis/removal-summary.json`: source links, delays and endpoints.
- `analysis/comparison.json`, `analysis/safety-review.json`: all placement pairs, shifted-event evidence and the five unchanged false placements.
- `after-final/score.json`, `after-final/run-receipt.json`, `provenance.json`: scores, completion and source/input hashes.

Early trial replays were stopped using their own sessions. The shared input file had newer
APS 2016 and Jimothy grids; the final run uses the original run2 grids. No other processes
were stopped. This is native offline replay with the documented glue model, not browser,
HTTP/reducer or camera-device proof.

Still open: destination rebinding, pending flip prompts for previously placed cards,
wrong sleeve association, and persistent loss of scene detail that needs a real camera
baseline reset. Keep genuine stack coverage and detected hands protected.
