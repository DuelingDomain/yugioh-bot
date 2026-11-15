# Scan and hand rules: Task L

**Not accepted. No product or test changes were kept.** The worktree is restored to its starting source at `a21a7e33289624685aa4281edda123e4c7640545`. The only project-tree change left for review is this report; local evidence is in [`data/replay/sim-l-20261115`](../../data/replay/sim-l-20261115).

Step 0 did not pass. The six requested changes were therefore evaluated as separate diagnostic candidates from HEAD, in order **1, 2, 3, 5, 6, 4**. They are not an accepted cumulative chain. Change 4 ran alone, after the other hand changes. A preliminary crop candidate was also rejected and corrected. There were **135 fresh clip runs**: nine pairs of ten v2 and five v3 clips. Every run exited zero with zero watcher errors. No commit, push, PR, deployment, download, training, or media export occurred. Work was solo, with at most two replay parents and one inference thread per lane.

The main column uses the retained PR #610 replay. All nine recorded source hashes match the local `origin/main` ref, `3cdc33aca813163bb6ff2768e7db516eb4b1d234`. No fetch or production measurement was done. The local branch named `main` is older and lacks this vision package; it is not used as the control. Joined is the retained Task H build. Start and every candidate were replayed now with the same frozen inputs and labels. See [main source verification](../../data/replay/sim-l-20261115/live-main-source-check.json) and [run/source provenance](../../data/replay/sim-l-20261115/provenance.json).

V2 uses **71 scored labels**, current reader, summon glue, four-corner calibration, 30 fps, and 170/228 ms detector/reader costs. This is not the older 64-label baseline. V3 uses 43 field/action labels and 15 held observations; six exclusions and one context label remain separate. Crop requests in candidate 3 use the measured conservative cost described below.

The caps were: zero non-card phantoms, zero hand/preview placements, at most three prompts on each set, zero wrong-name outcomes, wrong-zone outcomes at most 3 on v2 and 4 on v3, at least 31/48 false-box rejections, and detector work within +25%. Name and zone flags were also checked against start. The existing v3 build already violates the hand/preview and prompt caps. Its two hand/search previews and one Extra Deck preview are counted together in the tables; none is excused as baseline debt.

Step 0 remains open for four reasons.

- **Two extra v2 misses:** joined's wrong-name GY outcomes for Solemn Oak (`truth-8`, 46.5 s) and Poplar (`truth-9`, 49 s) become misses. Correct plus late remains 28. Restoring those callbacks would restore wrong names. Faster scans did not produce correct replacements.
- **Jimothy tail:** the S4 Set rests at 33.5 s and places at 45.680 s, a 12.180 s delay. Its trace has weak back evidence, contact at 33.832 s, missing outlines from 34.662–37.194 s, release samples at 38.064/38.894 s, and another miss at 42.320 s that restarts confirmation. This is not naming inference time.
- **V3 timing:** Longyuan's delay rises from 2.016 s in joined to 9.708 s in HEAD. The grip/contact and interrupted face/release sequence hold the same field card. Six correct-or-late field outcomes remain, but one moves from on time to late.
- **Fourth v3 prompt:** King Noir asks at 61.862 s. Its read at 61.560 s selects Graydle Parasite at .696, a low match. Silencing that question would hide an unread card. The King questions at 28.682 s and 61.862 s both refer to M3; a shared zone/episode question needs a proper lifecycle,.

The first repair carried only post-release evidence through one short detector miss when the same clean pixels remained. Its owner test failed before and passed after, but all replay outcomes and delays stayed unchanged. It was removed. [Cause evidence](../../data/replay/sim-l-20261115/step0-causes.md), [original tail trace](../../data/replay/sim-j-20261114/tail-evidence.json), and the current start run logs retain the exact events.

The v2 results follow. Times are seconds, median/p95. Main and joined are retained controls. The final restored source is byte-identical to start, so the start row describes the restored final build; no additional final replay is claimed.

| Build / candidate | On time | Late | Missed | Placed | Prompts | Phantoms | Hand / preview | Wrong name | Wrong zone | Sets /6 | Flips /2 | Stale | Source clear med/p95 s | Placement med/p95 s | Detect/min | Reads/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |
| main | 19 | 3 | 44 | 44 | 7 | 2 | 3 | 3 | 2 | 1 | 1 | 3 | 3.586/4.116 | 1.060/5.630 | 85.000 | 9.400 |
| joined | 25 | 3 | 38 | 37 | 4 | 0 | 0 | 2 | 3 | 3 | 2 | 1 | 3.312/5.958 | 0.577/11.322 | 85.000 | 8.300 |
| start | 26 | 2 | 40 | 37 | 3 | 0 | 0 | 0 | 3 | 3 | 2 | 0 | 2.280/3.708 | 0.605/12.180 | 85.000 | 9.400 |
| step0 | 26 | 2 | 40 | 37 | 3 | 0 | 0 | 0 | 3 | 3 | 2 | 0 | 2.280/3.708 | 0.605/12.180 | 85.000 | 9.400 |
| step1 | 22 | 3 | 41 | 38 | 3 | 0 | 2 | 2 | 3 | 3 | 1 | 1 | 2.260/3.672 | 0.652/12.186 | 85.000 | 8.700 |
| step2 | 26 | 2 | 40 | 37 | 3 | 0 | 0 | 0 | 3 | 3 | 2 | 0 | 2.280/3.708 | 0.605/12.180 | 85.000 | 9.400 |
| step3a | 22 | 4 | 39 | 39 | 1 | 0 | 0 | 2 | 3 | 3 | 2 | 1 | 2.457/3.996 | 0.708/11.848 | 93.000 | 8.400 |
| step3 | 24 | 2 | 40 | 37 | 2 | 0 | 0 | 2 | 3 | 3 | 2 | 1 | 2.075/2.908 | 0.734/11.848 | 92.900 | 8.400 |
| step5 | 25 | 2 | 38 | 37 | 4 | 0 | 0 | 3 | 3 | 3 | 2 | 0 | 2.254/3.708 | 0.564/7.120 | 85.000 | 9.700 |
| step6 | 24 | 2 | 40 | 36 | 34 | 0 | 0 | 2 | 3 | 3 | 1 | 1 | 2.206/3.702 | 0.818/12.180 | 85.000 | 10.500 |
| step4 | 26 | 2 | 40 | 37 | 3 | 0 | 0 | 0 | 3 | 3 | 2 | 0 | 2.280/3.708 | 0.605/12.180 | 85.000 | 9.400 |

Wrong-name and wrong-zone columns are exclusive outcome classes. Overlapping flags are retained in [comparison.json](../../data/replay/sim-l-20261115/comparison.json); start has one name flag despite zero wrong-name outcomes. Preliminary 3a also has one premature outcome, outside the displayed classes. Sets use the retained exact-slot observation check, not a claim that all six were recovered correctly.

Source clearance counts registered sources only. Start establishes eight of twelve labelled sources and clears all eight; four missing registrations are excluded. Main has five timed clearances, joined seven, start eight. Candidate 3 has only seven established sources and one stale source, leaving six timed clearances. Its smaller source-clear median is not a gain. Placement cohorts also differ: main has 11 timed matches, joined/start 16, and candidates 14–16. P95 uses nearest rank and is often the slowest sample.

The v3 results follow.

| Build / candidate | On time | Late | Field/action misses | Placed | Prompts | Phantoms | Hand / preview | Wrong name | Wrong zone | Placement med/p95 s | Detect/min | Reads/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| main | 4 | 2 | 33 | 18 | 4 | 1 | 3 | 1 | 3 | 2.523/5.656 | 78.286 | 9.714 |
| joined | 4 | 2 | 30 | 18 | 3 | 0 | 3 | 2 | 5 | 2.431/8.092 | 79.429 | 5.286 |
| start | 3 | 3 | 33 | 19 | 4 | 0 | 3 | 0 | 4 | 3.851/9.708 | 78.857 | 6.143 |
| step0 | 3 | 3 | 33 | 19 | 4 | 0 | 3 | 0 | 4 | 3.851/9.708 | 78.857 | 6.143 |
| step1 | 3 | 4 | 32 | 18 | 4 | 0 | 3 | 0 | 4 | 4.990/9.694 | 79.857 | 6.857 |
| step2 | 3 | 3 | 33 | 19 | 4 | 0 | 3 | 0 | 4 | 3.851/9.708 | 78.857 | 6.143 |
| step3a | 1 | 5 | 33 | 19 | 3 | 0 | 3 | 0 | 4 | 5.816/13.778 | 85.429 | 7.429 |
| step3 | 1 | 5 | 33 | 19 | 3 | 0 | 3 | 0 | 4 | 5.816/13.778 | 85.429 | 7.429 |
| step5 | 3 | 3 | 33 | 19 | 5 | 0 | 4 | 0 | 4 | 3.564/9.704 | 79.429 | 7.143 |
| step6 | 2 | 4 | 33 | 17 | 36 | 0 | 3 | 0 | 4 | 4.272/8.848 | 79.429 | 6.429 |
| step4 | 3 | 3 | 33 | 19 | 5 | 0 | 3 | 0 | 4 | 3.851/9.708 | 78.857 | 6.429 |

All candidates still miss all 15 held observations. Those observations do not authorize field placement. The hand/preview column includes two hand/search previews plus one Extra Deck preview in start; candidate 5 adds the held Ashuna. Token markers emitted as Sets are separate role errors, not counted as non-card phantoms. Their counts and the unresolved initial/marker roles remain in each safety review. These tables do not prove board equality.

All candidates were removed for the following reasons.

| Candidate | Behavior tested | Result and reason removed |
| --- | --- | --- |
| 0 | Carry verified release/face evidence through a short clean detector miss; require the outline to return before publishing | 58 focused tests passed. Replay results did not change; Step 0 caps still fail. |
| 1 | Check motion per zone; wake a scan when a zone stops, without bypassing token debt | New test failed before/passed after. V2 wrong names rose to 2, one flip was lost, and two private Solemn red hand piles became Sets at 27.856/35.556 s. A full wake can advance unrelated admission evidence. |
| 2 | One retry 300 ms after an empty landing scan; no repeated quiet retry | Two tests passed. All 15 headline results, delays and request totals stayed unchanged; 14/15 complete event logs were identical. Existing dirty-scene/pacing work still controlled these cases. |
| 3a | Detect changed-zone crops, retain unseen tracks, and run slower full checks | Rejected for unscoped shadow rescue: a crop could still trigger detector passes over unchanged known cards. Its native cost estimate was incomplete. |
| 3 | Scope crop evidence and rescue inputs; use one detector pass per crop; keep full background checks | Scope test failed before/passed after. V2 gained no recall, introduced two wrong names and one stale source, and its median rose to .734 s. V3 fell to one on-time outcome with 13.778 s p95. |
| 5 | Require crop skin components to reach the frame edge through a smooth arm/hand path | Four pixel tests passed; 36/48 false boxes still reject. V2 prompts rose to 4 and wrong names to 3; v3 prompts rose to 5. A held Ashuna was placed at 41.658 s. Missing arm connectivity must abstain, not clear an established grip. |
| 6 | Retain blocked candidates through both expiry paths; recheck the spot; ask once after a bound if still uncertain | The 14-test owner file passed, including retention, bounded question and later release. V2 prompts rose to 34 and v3 to 36. Per-track retention needs shared zone/episode state and proven absence cleanup. It also lost a flip and left one stale source. |
| 4 | Allow small edge-only contact after three fresh corner-stable scans over 300 ms, with clear art and mat-plane evidence | Fifteen tests passed. Established opposite-edge grips stayed blocked. All 56 placement payloads/times exactly match start: there are no new placement episodes to review. V3 adds an uncertain M2 question at 85.120 s, taking prompts to 5, with no placement-speed gain. |

Every placement outside the strict reviewed controls was checked from frames decoded in memory. Reviews cover the new unsafe hand piles and held Ashuna. Corrected crop v3 placements exactly match the already reviewed preliminary crop episodes. For change 4, [the exact comparison](../../data/replay/sim-l-20261115/step4-placement-comparison.json) proves 37 v2 plus 19 v3 placements match start. No image/video files were saved. Per-run `safety-review.json` files retain identity, pose, polygon, time, classification and review source.

The detector was benchmarked with **uncached native ONNX CPU inference, one thread**, local frames decoded in memory, alternating full/crop order and warm-up pairs. The first measurement used three frames and 27 measured pairs: full median **169.035 ms**, crop **50.395 ms**. A second used four crop shapes, including square detector input, and 20 measured pairs: full median **125.599 ms**, crop **47.337 ms**. Host load varied, so these are not normal-device timings.

The replay used the conservative paired p95 crop/full ratio, **.7227**, giving **123 ms per crop against 170 ms full**. The measured path disables shadow rescue. Corrected candidate 3 does likewise for active crops and retains rescue on background full scans. See [raw measurement](../../data/replay/sim-l-20261115/detector-cost-varied.json), [initial measurement](../../data/replay/sim-l-20261115/detector-cost.json), and [cost model](../../data/replay/sim-l-20261115/crop-cost-model.json).

Requests/minute and reads/minute are in both tables. The following ledger applies the same measured crop cost to retained traces for comparison. It is estimated detector work, not live CPU utilization. Full-frame work retains the harness's fixed cost; native shadow-pass/device cost is not certified. Preliminary 3a cannot claim this budget because of its unscoped rescue path.

| Build | V2 detector work, s/min | Change from start | V3 detector work, s/min | Change from start |
| --- | ---: | ---: | ---: | ---: |
| main | 14.380 | +0.26% | 13.255 | -0.73% |
| joined | 14.342 | +0.00% | 13.442 | +0.68% |
| start | 14.342 | +0.00% | 13.352 | +0.00% |
| step0 | 14.342 | +0.00% | 13.352 | +0.00% |
| step1 | 14.436 | +0.66% | 13.569 | +1.63% |
| step2 | 14.342 | +0.00% | 13.352 | +0.00% |
| step3 | 14.501 | +1.11% | 13.502 | +1.13% |
| step5 | 14.347 | +0.03% | 13.449 | +0.73% |
| step6 | 14.342 | +0.00% | 13.456 | +0.78% |
| step4 | 14.342 | +0.00% | 13.352 | +0.00% |

All usable candidate ledgers stay within +25%; none passes all safety/accuracy caps. Lower crop cost bought more requests; end-to-end results worsened. Fixed virtual inference time, cached native tensors and offline board glue do not establish browser, device, network or live-camera performance.

Only this document is left as a source-controlled change. Candidate edits to `field-watcher.ts`, `field-pacer.ts`, `field-motion.ts`, the new `field-scan-retry.ts`, and the allowed vision/hand tests were all restored. Their code and tests remain under `data/replay/sim-l-20261115/rejected-*/`; the timing runners and reports have the `sim-l-` prefix under that folder's `scripts/`. Existing evaluation scripts and other worktrees were read only.

Final verification: **60 Vitest tests passed in six focused files; scoped TypeScript passed.** All **78 vision TypeScript files** match the recorded start. All 18 new run reports have matching frozen inputs/labels and complete placement reviews. Cold false-box filtering rejects **36/48** at start, candidate 5 and restored final; all 36 rejected HEAD IDs are retained. The historical attribution of 31 rejections is carried from Task J. Rejected candidates' red/green receipts are retained separately; their tests are not left active after their code is removed.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts \
  packages/web/tests/remote-hand-contact.test.ts \
  packages/web/tests/remote-skin-contact.test.ts \
  packages/web/tests/field-removal.test.ts \
  packages/web/tests/vision-set-admission.test.ts \
  packages/web/tests/vision-set-and-flip.test.ts \
  packages/web/tests/vision-startup-background.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc --noEmit \
  -p data/replay/sim-l-20261115/tsconfig-scoped.json
```

Replay commands and costs are in `scripts/sim-l-pair.mjs`, each run's `run-receipt.json`, and the retained candidate snapshots. The pair runner rebuilds current source: replaying a rejected candidate requires its saved source and a fresh output name. Direct runner commands use `--detector-ms 170 --reader-ms 228`; add `--crop-ms 123` for candidate 3 and `--crop-ms 170` for the other candidates. The historical continuation scripts are execution receipts, not commands to overwrite the recorded folders. Do not overwrite the recorded runs. [All gates](../../data/replay/sim-l-20261115/gates.json), [decisions](../../data/replay/sim-l-20261115/decisions.tsv), and [source/input receipts](../../data/replay/sim-l-20261115/provenance.json) are inspectable.

The final build retains **zero stale registered sources**, with **2.280/3.708 s** source-clear median/p95. It still has **40 v2 misses**, **.605/12.180 s** placement median/p95, and the existing v3 hand/preview and prompt failures. The requested targets—fewer than 28 v2 misses, roughly .35 s median and under 3 s p95—were not reached.

[All remaining misses and causes](../../data/replay/sim-l-20261115/remaining-misses.md) lists the 40 v2 misses and 48 v3 misses (33 field/action plus 15 held observations). IDs/outcomes match the fresh start replay; final source is restored to that exact version. Causes are carried from Task J, linked to current logs; nearby-track attribution remains approximate and unresolved cases stay marked unresolved.

The remaining work needs hand/arm state that preserves an established hold when evidence becomes unknown, local absence proof for fully observed crop regions, one bounded question lifecycle per physical zone/episode, and better identity/outline evidence for weak backs and low-match cards. Hand/search/Extra preview roles, material relations, token roles and the offline glue's stack wait remain unresolved. No question was hidden to satisfy a count, and no naming or phantom threshold was lowered in the restored build.
