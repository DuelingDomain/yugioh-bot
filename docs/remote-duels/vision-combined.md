# Combined hand, Set, flip, and removal rules

The combined watcher retains the hand rework and ports `b1dd8e1fc` and `7af1194a4` by hand.
It repairs both known regressions. The tilt branch is absent. All changes remain uncommitted
on `fix/vision-combined`, starting at `000e5b6a0`.

All Task H artifacts are under `data/replay/sim-combined-20261114/`, called `R` below.
The accepted runs are **`R/complete-v2` and `R/complete-v3`**. Other runs are diagnostic
candidates or controls. `R/provenance.json` verifies that all 11 recorded product source
hashes in each accepted build match the final working tree. Both runs have zero watcher errors.

## V2 comparison

This is the hand report's 71-label v2x configuration across all ten clips. It uses the
current reader, summon glue, four-corner calibration, 170 ms detector requests, 228 ms reader
requests, 30 fps, and one native inference thread per lane. These are virtual clock costs.

Main and hand-only are the hand report's retained `main-run` and `complete-run` controls.
Their source hashes match `3cdc33aca` and `000e5b6a0`, respectively. Inputs, labels, and
parameters match the combined run. `R/controls-verification.json` records those checks.
The older 64-label baseline uses a 320 ms reader and has different totals.

| Measure | Main | Hand only | Combined |
| --- | ---: | ---: | ---: |
| On time | 19 | 19 | 25 |
| Late | 3 | 2 | 3 |
| Missed | 44 | 46 | 38 |
| Watcher placements | 44 | 34 | 37 |
| All prompts | 7 | 6 | 4 |
| Hand cards placed as field | 3 | 0 | 0 |
| Non-card phantoms | 2 | 0 | 0 |
| Sets placed, of 6 | 1 | 1 | 3 |
| Flips, of 2 | 1 | 1 | 2 |
| Correct or late removal matches | 6 | 6 | 6 |
| Stale source cards | 3 | 1 | 1 |
| Source-clear median, seconds | 3.586 | 4.112 | 3.312 |
| Source-clear p95, seconds | 4.116 | 5.596 | 5.958 |
| Placement delay median, seconds | 1.060 | 1.054 | 0.577 |
| Placement delay p95, seconds | 5.630 | 2.144 | 11.322 |

Evidence is in `R/analysis/comparison.json`, `R/complete-v2/score.json`, and
`R/analysis/safety-complete-v2.json`. The combined score also has two wrong-name outcomes
and three wrong-zone outcomes. The five outcome classes are exclusive and total 71.
Eight further observations are unscored.

Set counts describe physical presence. The recovered Sets are APS and two distinct,
separated Jimothy sleeves. Jimothy's approximate labels and changed spacing make exact slot
matching ambiguous. One Set has a raw wrong-zone outcome. The raw score remains unchanged.
Three Sets still fail admission. Both flips retain their original refs.

Source clearance checks 12 physical lifts against the corrected run2 source anchors.
Main establishes eight sources and clears five. Hand establishes six and clears five.
Combined establishes eight and clears seven. Missing registrations are excluded from the
stale count and clearance latency. Lostzone Spirit remains associated with FIELD after
its lift. Clearing a source does not prove the destination is correct.

Clearance latency has 5, 5, and 7 samples. Placement latency has 11, 10, and 16 samples.
Both use nearest-rank p95. Placement delay includes only correct or late placements with
an uncensored rest label. The cohorts differ. The combined placement p95 includes a late
recovered Jimothy Set, so the lower median does not mean every card became faster.

## Both known regressions

Oak in Solemn was delayed by cached confirmation that depended on activity across the
whole field. Slightly touching boxes also triggered inconsistent coverage and spread checks.
A strong fresh front can now confirm from clean local pixels within its detector age limit.
The existing minor-overlap tolerance applies through admission. Identity thresholds stay intact.
Local front confirmation cannot advance an unrelated new back. That isolation removed two
unsafe hand-pile Set callbacks found during integration.

In the original 64-label, 320 ms reader setup, Oak takes **1.210 seconds** after rest.
Main takes 1.222 seconds and the standalone Set fix takes 4.582 seconds.
The final evidence is `R/oak-final-64/score.json` and its Solemn run log.
`R/front-local-red.log` and the green test receipts cover the local confirmation contract.
`R/unrelated-back-red-final.log` covers the separate back-safety contract.

The removal regression lost Cardmarket's short sharp window before a hand and camera cut.
A weak drifting box kept the published source alive, and the next periodic scan came too late.
Bound sources now reject that weak drift. One paced verification scan follows each new
disappearance. The follow-up waits at least 250 ms so it counts as a separate scan.
Blur and actual hand or card texture continue to block removal.

The original removal-only automatic match total fell from 9 to 8. Replaying the removal-only
build with these repairs restores **9** across all ten clips. Cardmarket matches at 53.588 s,
1.088 s after its labelled rest. Evidence is `R/removal-regression-64/score.json`, its
Cardmarket log, and `R/snapshots/removal-fixed-watcher.ts`. The source-footprint test fails
before the repair in `R/source-footprint-red.log` and passes afterward.
These nine automatic matches can include wrong or premature events. They are not nine
verified removals, and they are not the six correct-or-late v2x matches above.

## V3 comparison

All five clips ran with the final combined source and the same 170 ms detector and 228 ms
current reader costs. The before control is the supplied frozen `v3-run/fix610-current`
run, rescored into `R/main-v3-rescored` using the same frozen truth and exclusions as combined.
Its nine source hashes match main and its inputs match combined.
`R/v3-controls-verification.json` records those checks.

There are 43 scored field/action labels and 15 held observations. Six other labels are
excluded, and one is context only. Every original label remains in the reviewed JSON.

| Field or runtime measure | Main before | Combined after |
| --- | ---: | ---: |
| On time | 4 | 4 |
| Late | 2 | 2 |
| Missed field/action labels | 33 | 30 |
| Wrong name | 1 | 2 |
| Wrong zone | 3 | 5 |
| Missed held observations | 15 | 15 |
| Watcher placements | 18 | 18 |
| All prompts | 4 | 3 |
| Hand/search previews placed as field | 2 | 2 |
| Non-card phantoms | 1 | 0 |
| Extra Deck previews placed as field | 1 | 1 |

Correct recall stays at six. The three fewer misses become one additional wrong name and
two additional wrong zones. This is not a correct-recall gain.
`R/complete-v3/reviewed-score.json` contains the final label outcomes.
The generic `score.json` is the older automatic scorer and is not the reviewed v3 result.

The original Tenpai empty-mat phantom is gone. Two white token markers still become Sets.
The Swordsoul marker's game role remains unresolved. The initial Unicorn remains ambiguous.
All 18 combined placement episodes have a retained direct-frame review or a strict transfer
from that review. Frames were decoded in memory. No image or video files were exported.
See `R/accepted-v3/safety-review.json` and `R/analysis/safety-complete-v3.json`.

## Safety against every single fix

The final v2 run has zero reviewed hand cards and zero phantoms. Each of its 37 placement
episodes was reviewed directly or matched to a reviewed control by identity, face, slot,
pose, time, and position. All four original hand-rest windows remain unplaced.

Fresh single-fix v2 controls have 6 prompts for hand, 6 for Set, and 7 for removal.
Combined has 4. Fresh single-fix v3 controls have 7, 3, and 4 prompts, respectively.
Combined has 3. Both reviewed hand-preview episodes also occur in every v3 single-fix
control, as does the Extra Deck preview. Combined introduces no additional hand-preview
or phantom episode. `R/analysis/safety-gates.json` records the comparisons.

Integration initially added five v3 questions about printed mat art. The default startup
guard now checks unchanged initial pixels, including repeated printed monster-cell patterns
with the existing mat alignment tolerance. It only suppresses unverified background.
Positive independent back evidence, changed arrivals, and an explicitly disabled startup
guard retain their decisions. Existing bindings and placeholders are excluded.
`vision-startup-background.test.ts` covers these boundaries.

## Changed files and tests

Product changes are confined to `packages/vision/src/field-watcher.ts`.
The Set port retains slower-cadence face confirmation, same-ref local reveals, and one
fresh retry for a nonempty low-match reveal. Empty results cannot create a retry loop.
The removal port retains a separate focus baseline and permits repeated sharp, hand-free
absence evidence to outlast a shadow. A blur timeout cannot become removal evidence.

Four new Vitest files contain the ported cases and integration regressions:

- `packages/web/tests/vision-set-admission.test.ts`
- `packages/web/tests/vision-set-and-flip.test.ts`
- `packages/web/tests/field-removal.test.ts`
- `packages/web/tests/vision-startup-background.test.ts`

The standalone reports are included as `set-and-flip-detection.md` and `card-removal.md`.
Their original 64-label figures remain separate from this report's 71-label comparison.

Final focused verification passes 57 tests in nine Vitest files and all 154 existing
board, face-state, and field-pile tests. Scoped TypeScript checking also passes.
Receipts are `R/vitest-complete.log`, `R/watcher-complete.log`, and
`R/typecheck-scoped-complete.log`.

The earlier full native vision run passed 323 of 326 tests. One failure exposed the reveal
retry loop and is repaired. The final face-state run passes all seven cases. Two unchanged
tests still fail in isolation: the pipeline related-card fixture expects `[1,3]` but receives
`[1,3,4]`, and mat-fit exceeds its CPU budget on this loaded Mac.
Package-wide vision typechecking still fails at the unchanged GPU adapter type in
`web-runtime.ts:221`. `R/baseline-checks.json` verifies that these files match HEAD;
`R/baseline-recheck.json` records the isolated commands and exits.

The final focused commands are:

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts \
	packages/web/tests/vision-set-admission.test.ts \
	packages/web/tests/vision-set-and-flip.test.ts \
	packages/web/tests/field-removal.test.ts \
	packages/web/tests/vision-startup-background.test.ts \
	packages/web/tests/remote-hand-contact.test.ts \
	packages/web/tests/remote-set-placement.test.ts \
	packages/web/tests/remote-skin-contact.test.ts \
	packages/web/tests/remote-front-retry.test.ts \
	packages/web/tests/remote-back-evidence.test.ts --maxWorkers=1
node --import tsx --test packages/vision/src/board.test.ts \
	packages/vision/src/face-state.test.ts packages/vision/src/field-piles.test.ts
node node_modules/typescript/bin/tsc --noEmit -p data/replay/sim-combined-20261114/tsconfig-scoped.json
```

Replay copies are all prefixed `sim-h-` under `R/scripts`. Evaluation scripts and other
worktrees remain read only. Fresh combined runs use these commands with new output names:

```sh
R=data/replay/sim-combined-20261114
E=/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation
node "$R/scripts/sim-h-v2x-run.mjs" baseline --source combined --reader current \
	--glue summons --threads 1 --detector-ms 170 --reader-ms 228 \
	--stage-times "$E/v2x/stage-times.json" --inputs "$R/complete-v2/inputs.json" \
	--labels "$R/complete-v2/label-inputs.json" --out "$R/rerun-v2"
node "$R/scripts/sim-h-v3-run.mjs" baseline --source combined --reader current \
	--glue summons --threads 1 --detector-ms 170 --reader-ms 228 \
	--stage-times "$E/v3-run/normal-stage-times.json" --inputs "$R/complete-v3/inputs.json" \
	--labels "$R/complete-v3/label-inputs.json" --out "$R/rerun-v3"
node "$R/scripts/sim-h-v3-reviewed.mjs" "$R/rerun-v3"
python3 "$R/scripts/sim-h-analyze.py" "$R/complete-v2"
python3 "$R/scripts/sim-h-finalize.py"
```

At most two replay parents ran at once. No downloads, training, commits, pushes, PRs,
or deployments occurred. Media stays in the eval worktree's data directory.

## Open limits

V2 still has 38 misses, three late outcomes, three missed Sets, one stale source,
and a long placement-delay tail. V3 still confuses hand and Extra Deck previews with field
cards. Token roles, material consumption, attachment, and banish behavior remain incomplete.
The offline sink exercises product proposal helpers. It does not verify browser queues,
React reducers, network ownership, or live camera behavior.
