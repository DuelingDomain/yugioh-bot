# Tilted cameras

The replay exposed two unit errors. A rectified card was still measured using camera pixel aspect, and edge angles were measured with rectangular mat cells treated as squares. The fixes keep the existing angle, size, identity, contact and Set-evidence limits.

At 20.210 s in `sim-remote-SlUY5fXnL8k`, the central card measures 15.6606 degrees in square cell units but 10.7806 degrees in physical 59:86 units. Its opposite-side ratio is .8847. The old 14-degree gate incorrectly routes it to the held reader. Its raw shape also fails the aspect gate while its physical shape passes. An oversized partial outline of the far card additionally marks this card covered.

## Baseline diagnosis

All 36 corrected-baseline misses have one primary observed blocker below. These are counts of blocking traces, not independent recovery estimates: a label can meet another guard after its first blocker is fixed. Corner errors can also lower reader scores; no missed label was isolated to a missing projective crop operation. `pipeline.ts` already warps the selected four corners before reading.

| Primary blocker | Misses |
|---|---:|
| hand/contact | 7 |
| held-show gate | 8 |
| reader confidence | 3 |
| zone/pile role | 3 |
| face/overlap gate | 4 |
| matching fault | 1 |
| plane geometry | 3 |
| stillness/end | 1 |
| shadow hold | 2 |
| detector poor/partial | 3 |
| aspect gate | 1 |

The three `detector poor/partial` rows mean no usable returned outline, or a clipped outline. They do not establish that the raw model produced no proposal below its decode floor. The eight hand shows have a separate supported held reader; none met its eligibility, visibility and repeated-read contract. The old review called this event type unsupported, which is not accurate for the current source.

Evidence: `data/replay/fixtilt/causes.json`, `diagnosis.json` and `diagnosis-summary.jsonl`. Rule/read evidence below is from corrected `v2/run2-baseline/runs/`. Frame panels are the existing native images under the eval worktree. The faulty run1 overlays and conclusions for Cardmarket, Jimothy and Bgm were not reused. No video or frame was copied here.

| Label | Trace time (s) | Primary blocker and evidence | Native frame panel |
|---|---:|---|---|
| `aps-2002-duel:truth-1` | 27.146 | hand/contact: Track 2 has one .768 front box, but connected skin blocks rest before the cut. | [row-00.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-00.jpg) |
| `aps-2002-duel:truth-4` | 59.250 | held-show gate: No clean detector outline near the shown card before the clip ends. | [row-01.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-01.jpg) |
| `aps-2016-match:truth-0` | 29.250 | held-show gate: Hand fan. No held event satisfies the single visible outline and repeated sure-read contract. | [row-02.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-02.jpg) |
| `aps-2016-match:truth-1` | 37.250 | held-show gate: Held Alpha becomes a field arrival; no separate held event. | [row-03.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-03.jpg) |
| `aps-2016-match:truth-2` | 41.014 | hand/contact: A .974 box is routed held: tilted 18 degrees, sides .76, fingers. Alpha eventually places at 54.194, beyond the 53-second matching horizon. Correct angle units alone leave the .76 side ratio below .78. | [row-04.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-04.jpg) |
| `solemn-tenpai-snake:truth-2` | 23.948 | reader confidence: Top score .72386 is below the .74 floor; no named flip. Glare is visible. | [row-05.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-05.jpg) |
| `solemn-tenpai-snake:truth-7` | 43.120 | zone/pile role: WANTED is named at the upper-right pile, mapped BANISHED, while truth requires GY. The grid/label role conflict is retained. | [row-06.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-06.jpg) |
| `solemn-tenpai-snake:truth-10` | 57.098 | face/overlap gate: Two sure reads (.794/.799) but face remains unknown; only reading emits before the end. | [row-07.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-07.jpg) |
| `cardmarket-meme:truth-1` | 5.750 | held-show gate: A fan of overlapping cards has no eligible held reveal. | [row-09.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-09.jpg) |
| `cardmarket-meme:truth-2` | 7.750 | held-show gate: The shown fan has moving/covered outlines; no eligible held reveal. | [row-10.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-10.jpg) |
| `cardmarket-meme:truth-4` | 31.210 | matching fault: A correct Hermitree placement exists at 31.21 but the greedy scorer consumes it for truth-3 (Lonefire). | [row-12.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-12.jpg) |
| `cardmarket-meme:truth-7` | 59.336 | hand/contact: Track 20 has a .902 front box; connected skin blocks rest until the end. | [row-15.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-15.jpg) |
| `lostzone-yubel-ryzeal:truth-5` | 24.252 | plane geometry: Squirmer is routed held by tilt/side distortion. A .9296 identity read is not sure because the crop is covered. The S4 label and physical row also disagree. | [row-16.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-16.jpg) |
| `lostzone-yubel-ryzeal:truth-8` | 55.020 | face/overlap gate: Track 15 alternates hand contact, across-cell rejection and absent positive back evidence. It cannot commit a Set. | [row-17.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-17.jpg) |
| `lostzone-yubel-ryzeal:truth-9` | 59.336 | stillness/end: Only one useful .857 front observation; settling 1/2 when the clip ends. | [row-18.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-18.jpg) |
| `jimothy-branded-labrynth:truth-0` | 4.584 | zone/pile role: Startup pink stack is treated as a side pile; no field twin exists to depart. | [row-19.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-19.jpg) |
| `jimothy-branded-labrynth:truth-2` | 41.980 | shadow hold: Tracks 5/8 reach on-mat and uniform sleeve evidence, but repeated 5-10 percent shadow holds block admission. Label xy is offset from the settled card. | [row-21.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-21.jpg) |
| `jimothy-branded-labrynth:truth-3` | 37.882 | detector poor/partial: The far-right fourth sleeve has no separate usable outline. Nearby .438 box belongs to its neighbour. | [row-22.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-22.jpg) |
| `jimothy-branded-labrynth:truth-4` | 38.052 | aspect gate: The .438/.430 sleeve outline at (.773,.512) is explicitly skipped: not card-shaped. Set shape admission is deliberately retained. | [row-23.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-23.jpg) |
| `jimothy-branded-labrynth:truth-5` | 37.250 | face/overlap gate: Track 7 reaches on-mat with positive uniform sleeve evidence but face gate waits (pixels: down), with shadow holds. | [row-24.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-24.jpg) |
| `sim-remote-29hZVYmE3tc:truth-4` | 42.022 | zone/pile role: Strong .85-.87 outline at lower left maps EXTRA and use deck pile. No field placement/departure is emitted for that pile. | [row-25.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-25.jpg) |
| `sim-remote-29hZVYmE3tc:truth-6` | 57.622 | shadow hold: Pickup starts during shadow hold, followed by hand occlusion until the clip ends. | [row-26.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-26.jpg) |
| `sim-remote-BgmToxqmo4s:truth-1` | 17.954 | reader confidence: Track 12 reads .7165 then .6608, below the naming floor; the move cannot carry a confirmed identity. | [row-28.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-28.jpg) |
| `sim-remote-BgmToxqmo4s:truth-3` | 26.836 | detector poor/partial: Top-edge Spell box is clipped by the frame (.489, partial), and cannot form a clean field arrival. | [row-30.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-30.jpg) |
| `sim-remote-BgmToxqmo4s:truth-4` | 33.684 | hand/contact: New row card is tracked but repeatedly reports held: hand contact and a spread prompt. | [row-31.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-31.jpg) |
| `sim-remote-BgmToxqmo4s:truth-5` | 36.704 | plane geometry: A new row card is routed held: tilted 19 degrees, sides .85, fingers; subsequent track is prompt-only spread. | [row-32.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-32.jpg) |
| `sim-remote-BgmToxqmo4s:truth-6` | 34.748 | face/overlap gate: The new overlapping row shares nearby tracks; face/back evidence and spread handling prevent a separate placement. Label xy is offset; no isolated crop-warp fault is proven. | [row-33.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-33.jpg) |
| `sim-remote-BgmToxqmo4s:truth-7` | 38.072 | hand/contact: The moved left card repeatedly reports held: hand contact and face unknown. | [row-34.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-34.jpg) |
| `sim-remote-BgmToxqmo4s:truth-9` | 42.988 | detector poor/partial: New top-row card is partially outside the frame; .544 front box is partial, then tracks 22/23 wait for clean face evidence. | [row-36.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-36.jpg) |
| `sim-remote-BgmToxqmo4s:truth-10` | 50.248 | reader confidence: Read scores .6767/.6380 do not meet the naming floor; hand/shape/spread gates also occur. | [row-37.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-37.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-0` | 7.022 | hand/contact: Startup defense card never becomes identified because connected skin blocks rest. Pickup therefore has no board twin to remove. | [row-38.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-38.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-1` | 20.210 | plane geometry: Central defense box has physical tilt 10.7806 degrees but old cell-space tilt 15.6606; sides .8847. It is incorrectly routed as held. Raw aspect also fails while physical aspect passes. Oversized far-card boxes also mark it covered. | [row-39.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-39.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-2` | 18.250 | held-show gate: Right-edge show lacks a clean eligible single outline; no repeated sure held read. | [row-40.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-40.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-3` | 21.750 | held-show gate: Hand-area show has only weak/moving/hand-covered outlines; no repeated sure held read. | [row-41.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-41.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-5` | 33.750 | held-show gate: Hand-area show is weak or face-down; no eligible held reveal. | [row-42.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-42.jpg) |
| `sim-remote-SlUY5fXnL8k:truth-6` | 53.936 | hand/contact: Track 7 has .58-.68 front boxes but rest remains held: hand contact and face unknown. | [row-43.jpg](/Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/review-misses/row-43.jpg) |

Cardmarket `truth-4` is a matching fault: the 31.210 s Hermitree placement is consumed by the earlier Lonefire label (`truth-3`). Solemn WANTED and the lower-left 29hZ pile have retained label/grid role conflicts. Several manual xy labels are offset from the settled cards; the table uses tracks and native context rather than treating every nearby box as the labelled card.

## Changes

- `packages/vision/src/field-card-shape.ts`: preserve existing pixel shape checks and add physical mat units for calibrated fronts. Calibrated aspect does not add a new Set admission path.
- `packages/vision/src/field-zones.ts`: calculate opposite-edge angles and lengths in physical 59:86 units. Area and cell-share calculations stay in cells.
- `packages/vision/src/field-watcher.ts`: use the shared shape calculation.
- Concurrent local `field-perspective.ts` and watcher advisory edits were preserved and tested. Tests live under `packages/vision/tests/`, outside the legacy Node test glob. No web UI was designed.

The optional snapshot field `cameraView` contains `compression` and `tooFlat`. Compression is the minimum local singular-value ratio of the calibrated projection, measured at playable cell centres in equal physical units. `tooFlat` is true below .25: one direction needs more than four times as much stretching as the other. It refreshes when calibration or capture size changes. It is an advisory, never admission evidence or a removal gate. An inaccurate grid can also trigger it.

None of these ten grids crosses .25 (range .5502 to .9355). The data therefore do not establish an angle at which reading becomes impossible. The .25 signal is a measurable sampling warning, not a validated accuracy cutoff or a camera pose estimate. The supplied angle bands are approximate visual estimates, not measured camera poses.

## Replay and checks

The full after replay completed all 10 clips / 64 labels with zero watcher errors. Receipt: `data/replay/fixtilt/after/run-receipt.json`; source hashes and review totals: `data/replay/fixtilt/final-receipt.json`. The six-clip local baseline spot-check reproduced all 38 scored label statuses from corrected run2.

| Metric | Corrected run2 before | After, original matcher | After, one matching fix |
|---|---:|---:|---:|
| On time | 19 | 19 | 20 |
| Late | 3 | 4 | 3 |
| Missed | 36 | 35 | 35 |
| Wrong-name status | 3 | 3 | 3 |
| Wrong-zone status | 2 | 2 | 2 |
| Premature | 1 | 1 | 1 |
| Placements | 42 | 43 | 43 |
| All prompts | 7 | 9 | 9 |
| Card here? (`card-presence`) | 2 | 3 | 3 |
| Median delay (s) | 1.058 | 1.222 | 1.222 |
| p95 delay (s) | 5.620 | 10.394 | 5.666 |

The extra late result in the original matcher is not a recovered removal. At 18.894 s the new real M3 placement names Vision HERO Increase. The generic `removed` label at 7.5 s consumes that placement before the actual arrival label at 16 s is considered. The separate copied scorer only prevents a generic removal with no destination zone from consuming a placed/moved event. Scoring both before and after with that fix leaves the before score unchanged and credits the actual arrival at 18.894 - 16.5 = **2.394 s after rest**. It does not infer a removal. All other matching rules remain unchanged, including the retained Cardmarket conflict.

The raw scores remain at `after/score.json` and the supplied `run2-baseline/score.json`. Re-scored results and the exact policy live at `semantic-before/` and `semantic-after/`. Reproduce with `node data/replay/fixtilt/scripts/sim-fixtilt-rescore.mjs`. The four `nameWrong` flags (one on a wrong-zone result) also stay 4 -> 4; this is distinct from the three primary wrong-name statuses.

| Angle from top-down | Labels | On time, before -> after with matching fix | Late, before -> after | Found including late |
|---|---:|---:|---:|---:|
| up to 12 degrees | 25 | 11 -> 11 | 2 -> 2 | 13 -> 13 |
| 13 to 30 degrees | 20 | 3 -> 3 | 0 -> 0 | 3 -> 3 |
| above 30 degrees | 19 | 5 -> 6 | 1 -> 1 | 6 -> 7 |

With the original matcher, the above-30-degree band instead reads 5 -> 5 on time and 1 -> 2 late; the other bands are identical. Thus the real gain is one on-time placement in the 45-degree clip, not a broad recovery of tilted views.

Physical precision was checked separately: **2 -> 2 phantoms; 4 -> 4 hand-card placements; zero new wrong names among the two added placements.** Forty-one after placements match the same baseline physical episode by clip, zone, card ID, time within one second and polygon IoU >= .7. The two additions were reviewed against native frames:

- Bgm: GY Dragunity Phalanx at 44.334 s, the prior field monster now on the right pile. The existing full frame at `run2-baseline/placements/sim-remote-BgmToxqmo4s-18.jpg` (45.128 s) shows this same pile card. Inspect the GY quad; the tablet elsewhere in that full frame remains a phantom.
- SlUY: M3 Vision HERO Increase at 18.894 s. The existing `run1-tilt/placements/sim-remote-SlUY5fXnL8k-1.jpg` is the identical timestamp and real field episode in one of the seven valid clips.

`after-placement-review.json` records every after placement, its matching baseline key or direct-review source, and its quad. The one lost placement is APS 2016 Alpha at 54.194 s, already beyond its label horizon. The after path instead asks an uncertain prompt at 40.972 s and never settles that identity. Bgm also adds a Card here? prompt on the real M4 card at 11.174 s. Neither prompt was answered. These are costs of the change, not successful recoveries.

The corrected baseline physical review finds two phantoms and four hand-card placements. The second phantom is the tablet printed on the Bgm mat, placed as a Set at 45.128 s (quad x=.375-.462, y=.255-.484). It was absent from the valid seven-clip run1 review. `baseline-placement-review.json` records all 42 physical-object classifications and source image paths. Field/pile-card classification does not certify the original name, zone or unique board ref.

The full before reference is the supplied corrected `v2/run2-baseline`; all eight recorded product source hashes match the clean local source. A local baseline spot-check was stopped at a clip boundary to reduce host load. It is not a second full baseline. See `data/replay/fixtilt/baseline-provenance.json`.

Commands use Node 22.23.4. Copied scripts, numerical traces, model-output caches and receipts stay under `data/replay/fixtilt/`. Inputs use absolute paths to the eval data. The copied scorer does not export frames or crops. It uses the same 64 labels, 30 fps, fixed 170/320 ms inference costs and departure glue as corrected run2; the reader and Set/removal policies are not replaced with the other agents' work.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node data/replay/fixtilt/scripts/sim-fixtilt-v2-run.mjs baseline \
  --inputs /Users/imranqureshi/repos/yugioh-bot-vision-eval/data/vision-eval/simulation/v2/shared-inputs.json \
  --out data/replay/fixtilt/after
npx --no-install vitest run packages/vision/tests/field-card-shape.test.ts packages/vision/tests/field-rest-geometry.test.ts packages/vision/tests/field-perspective.test.ts
node --import tsx --test packages/vision/src/board.test.ts packages/vision/src/field-calibration-bounds.test.ts
```

The focused Vitest files pass 13 tests. The existing watcher and calibration files pass 139 tests, including phone/calculator phantom guards. Both new geometry regressions failed before their fixes (`test-before.log`, `rest-test-before.log`). The package typecheck reports the unchanged `web-runtime.ts:221` `GpuAdapterLike`/`GPUAdapter` incompatibility; no edited-file error was reported.

## Open work

Hand/contact routing, face/back evidence, scene holds and reader uncertainty still explain most misses. The Set and removal policies are left for their owners. The 45-degree clip also has an oversized far-card outline that creates a covered-card veto. A grid warp cannot recover pixels outside the frame, identify occluded cards, or distinguish a hand-origin card from a field card without the existing role evidence. Matching and label/grid conflicts need a separate evaluation repair. Native CPU replay does not prove browser or device behaviour.
