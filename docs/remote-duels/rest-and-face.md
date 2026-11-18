# Rest and face review — 15–16 November 2026

Local, solo investigation from `121d26528617359175fffec1b85190df43d17394`. Decisions and final replay numbers are recorded below. Evaluation artifacts live in [the ignored run folder](../../data/replay/rest-face-20261115/). No recording, training, download, deployment, commit or external service was used.

**A — Seven geometry misses.** No test-set calibration fault was established, and no calibration was changed. Six rows expose product evidence problems: four inaccurate outline fits, one covered/overlapping outline, and one size-learning fault. The remaining row is a departure/source-binding attribution problem, not a resting-arrival geometry failure. None of the seven is primarily a nearest-zone, slot-centre, rotation, mat-edge containment or neighbour-distance failure. This does not certify the agent-estimated right-mat zones.

| Label | Frame / trace evidence | Decision about the gate |
| --- | --- | --- |
| left-0420:truth-12 | Resting blue Link; fitted top-right corner includes mat. Tilt 21.21°, opposite-side ratio .680; size .778, cell share .707. | Reject the supplied trapezoid. Repairing zone containment would not fix its corners. |
| right-0840:truth-4 | Resting trap beside the private fan; fitted right side extends into mat. Debug reports 33–41° tilt. | Reject this unsupported outline. |
| right-0840:truth-9 | Sideways brown monster beside/over another card; raw box says `covered`, debug says 16° and fingers. | An overlapping, covered outline has more than a rest-geometry hold. Do not bypass it. |
| right-0840:truth-11 | Departure at 40 s; zero nearby raw outlines in the 40.5–44 s window. | Not a contemporary rest-gate failure. The scorer shares its source ref with truth-10. |
| right-0840:truth-18 | Resting upright brown monster; fitted top tapers. Tilt 17.16°, sides .814, size .642, share .592. | Supplied shape fails; size and zone share pass. |
| right-1950:truth-5 | Resting brown monster; fitted bottom-right extends beyond sleeve. Tilt 16.84°, sides .802, size .666, share .644. | Supplied shape fails; size and zone share pass. |
| left-1550:truth-17 | Resting upright brown monster; size .884, tilt 2.66°, sides .953, share .724. First sample passes against .740 reference. | Product size-learning fault: other tracks repeatedly shrink the reference, and the unmoved card then fails the 1.2× test. |

All seven traces and frames were read. [Geometry ledger](../../data/replay/rest-face-20261115/geometry-ledger.json) retains the indexed raw/rest evidence; [seven-frame sheet](../../data/replay/rest-face-20261115/review/geometry-seven.jpg) shows the label centres and supplied outlines. Native-image skew also exists, so a new calibration cannot selectively straighten these quads. The cell-coordinate metric can amplify corner error; the experiment did not widen tilt, side-ratio, size, containment or hand thresholds. Existing nearest-zone assignment remains in place.

Candidate A replaces the frame-weighted shared size average with the median of one current observation per identified card, bounded to 32 refs. Only strong, complete, non-kept, non-cell resting outlines teach it; calibration changes clear the samples. The regression repeats a smaller card after ordinary cards leave view: a 1.17× arrival must place, while a 1.3× outline without detected fingers must remain blocked. It fails before the change and passes after. This cannot establish physical height from an overhead image; bad identities or split physical tracks can still contaminate learned size.

**B — Two face-up cards admitted as Sets.** p016 (left-0420, 58.434 s) has detector front .844, pixel down .82, inner RGB deviation 23.57, and back distance .221. p034 (right-1950, 31.512 s) has detector front .863, pixel down .82, deviation 19.54, and no learned back. Both use the generic texture rule in `classifyFaceState`, rather than its strong plain-sleeve rule. Neither was admitted by matching a previously learned sleeve. The brown track had also been dismissed; `admittingSet` and the rest-only Set guard omitted that lifecycle state. Visible art, glare and inaccurate cropping were present. These traces do not isolate frame colour as the cause.

Candidate B carries the detector face into positive-back measurement. A detector front cannot become a Set from texture or a sleeve match; a genuinely uniform sleeve with independent mat-boundary evidence retains its path. Conflicting front pixels abstain and use the existing front-reader timeout and identity checks. All unbound lifecycle states, including dismissal, must pass Set evidence and rest checks. No naming threshold changes. Two regression subcases fail on main and pass after the change: a textured detector front must use the reader, and a dismissed object cannot publish a Set/flip from unsupported back evidence. Printed sleeves misclassified as fronts may wait or need a player choice.

[Original p016 input](../../data/replay/rest-face-20261115/review/p016-input.jpg) and [p034 input](../../data/replay/rest-face-20261115/review/p034-input.jpg) were inspected. These are real cards with wrong face state, distinct from non-card phantoms.

**C — Previews and stale sources.** No C product change was made. The two preview callbacks are p014/p015, left-0420 at 42.600/48.512 s, over the same sideways Extra Deck selection fan in S4. They are real resting cards, not literally held cards. The outline/overlap evidence treats the top as isolated; rest cannot establish player intent. Only p014 creates a board arrival. A rule rejecting every sideways front or every overlapping card would also affect valid defense positions and stacks; no narrow safe repair was established.

The three stale-source score rows are not three independently proven stale physical cards. right-0840 truth-10 and truth-11 both bind ref `…2-9`; that ref emits removal at 36.036 s and a committed departure at 36.836 s, before either label's 41 s rest. The scorer's post-rest clearance window counts both as stale. Two unreadable simultaneous departures and a shared automatic source binding prevent a distinct-instance claim. The score is retained unchanged. left-1550 truth-9 binds an older Mind Scan ref to the book-art Spell departure; it later follows a kept/old outline in S3 and emits a move at 61.034 s. Source association and stale-outline retention are entangled. Removing such refs without fresh absence/identity proof could remove another card. [Stale ledger](../../data/replay/rest-face-20261115/stale-ledger.json) retains the actual events and notes.

**D — Three hand-contact misses.** [The three reviewed sequences](../../data/replay/rest-face-20261115/review/hand-windows.jpg) and [hand ledger](../../data/replay/rest-face-20261115/hand-review.json) show: left-0105 truth-12 is touched at 37 s, released by 38 s, and has only one second before its observation ends; right-0840 truth-2 has no visible hand at 3–5 s and zero measured contact, but latches opposite-edge grip (off-crop fingers cannot be excluded); right-0200 truth-8 has hand activity around the lower fan during a departure, while the old source is empty in sampled frames. Main clears that source at 39.962 s, after its label window ends at 39 s. No hand threshold was changed.

**A verdict: KEEP.** V5 misses fall 18→17 (on-time 10→11); both Extra Deck preview callbacks disappear. V2 headline successes fall 33→32 (one late→wrong-zone); v3 remains 6. Confirmed wrong-name outcomes stay zero; stale rows remain 3/0/0 for v5/v2/v3. All 40 changed callbacks were inspected: 34 retimed and six new callbacks, including Reading/move stages. The only new named placement is the resting rabbit-art M5 card. One retimed v2 Reading cue over an existing private search fan remains. No new held/search/Extra episode or non-card phantom was found. The seven review sheets and individual classifications are in `a-reviewed-final.json`. The existing two v3 token-marker-as-Set role errors are retained as role errors, outside the non-card-phantom count; they are not repaired or excused.

**B verdict: KEPT by the orchestrator after review (the solo run marked it REJECT).** The reject came only from the brief's "misses must fall" rule, which fits a recall fix, not a wrong-face fix. B's own goal is met and no safety or score number is worse than A. Its incremental control is kept A. It removes both wrong-face episodes, including their later false flips, but v5 misses remain 17→17; it fails the requested per-fix miss-reduction rule. The 18→17 improvement against original main belongs to A. V2 and v3 headline results, named-label errors and source clearance are unchanged from A. All ten changed B callbacks (six new, four retimed, all on v5) were inspected: real resting fronts, no new held/search/Extra episode or non-card phantom. The new blue Link name is tentative `bestMatch` Shuraig at .7408 and remains independently unassessed; the brown card uses main's later face-up name sooner. This is not a claim of perfect naming. B's source/test changes were removed. [Patch](../../data/replay/rest-face-20261115/patches/b-face.patch), red/green receipts, every changed frame, scores and build hashes remain; rejected run folders and the B source snapshot were deleted.

The per-fix recall rule is applied incrementally so B does not receive credit for A's gain. Broad tilt/containment relaxations and a general sideways/overlap preview veto were **REJECTED without product changes** because the evidence does not establish a safe mechanism. D is diagnosis only.

These are score-v4 headline outcomes. Denominators exclude auxiliary held observations, context and relation-only rows: v5 38, v2 62, v3 28. “Wrong name” means outcomes on named labels, not raw reader guesses or independently verified correctness of every card. “Placed” counts watcher placement callbacks, not distinct board arrivals.


| Set | Build | On time | Late | Missed | Wrong zone | Wrong name | Early | Stale rows | Placed | Prompts |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v5 | main | 10 | 4 | 18 | 4 | 0 | 2 | 3 | 37 | 3 |
| v5 | A alone | 11 | 4 | 17 | 4 | 0 | 2 | 3 | 34 | 3 |
| v5 | A+B — final | 11 | 4 | 17 | 4 | 0 | 2 | 3 | 32 | 3 |
| v2 | main | 27 | 6 | 26 | 3 | 0 | 0 | 0 | 39 | 4 |
| v2 | A alone | 27 | 5 | 26 | 4 | 0 | 0 | 0 | 38 | 4 |
| v2 | A+B — final | 27 | 5 | 26 | 4 | 0 | 0 | 0 | 38 | 4 |
| v3 | main | 3 | 3 | 21 | 1 | 0 | 0 | 0 | 16 | 5 |
| v3 | A alone | 3 | 3 | 21 | 1 | 0 | 0 | 0 | 16 | 5 |
| v3 | A+B — final | 3 | 3 | 21 | 1 | 0 | 0 | 0 | 16 | 5 |

| Set | Non-card phantoms, main / A / A+B | Hand/search/Extra episodes, main / A / A+B | New unsafe episode from A or B |
| --- | --- | --- | --- |
| v5 | 0 / 0 / 0 | 2 / 0 / 0 | 0 |
| v2 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| v3 | 0 / 0 / 0 | 3 / 3 / 3 | 0 |

A incidentally withholds both v5 preview callbacks. Its preview track has size/rest and release holds (including .873 size against a .719–.720 reference), then sideways-back holds; this does not establish a general understanding of preview intent. B removes the two visible-face-as-Set episodes, but is not retained. Kept A therefore still has both wrong-face episodes. The three v3 unsafe baseline episodes remain baseline debt; the existing two token role errors are reported separately above. A retimes an already existing private-fan Reading cue by .080 s; it does not introduce that episode.

Baseline safety review transfers 88/92 placement callbacks by matching card ID, zone, face and pose, within .03 image units and one second of the retained reviewed episode. The other four fresh v3 callbacks were directly inspected and show resting cards/backs. This transfer does not certify distinct-instance continuity. All candidate callbacks whose publication time or payload changed were directly reviewed, including Reading and move/flip stages: **40 for A, 10 for B**. Exact unchanged placement payloads/times inherit their reviewed control. Individual classifications and image paths are in `a-reviewed-final.json`, `b-reviewed-final.json` and `baseline-review-transfer.json`; unmatched outputs were not automatically called phantoms.

Placement latency below uses known-rest **arrivals**, on the virtual clock. Cohorts change, so a median is not a paired speed claim.

| Set | Main median / p95 (s) | A median / p95 (s) | A+B median / p95 (s) |
| --- | --- | --- | --- |
| v5 | 0.663 / 7.246 | 0.626 / 9.736 | 0.626 / 9.736 |
| v2 | 0.648 / 12.180 | 0.648 / 12.180 | 0.648 / 12.180 |
| v3 | 3.157 / 8.074 | 3.157 / 8.074 | 3.157 / 8.074 |

**What ran.** There were **69 completed clip replays**: main, A and A+B each ran all 8 v5, 10 v2 and 5 v3 clips, serially, with zero watcher errors. Native Current/detector inference used one thread per lane and pure-tensor caches; stateful watcher/model decisions were rebuilt. Detector/reader clock costs were 170/228 ms, 30 fps, 800 ms departure wait, 5 s pile reconciliation; no prompt was answered. Prepared assets were copied with `cp -c -R`. Input, label and override hashes match across all three builds for each set. No calibration or truth labels were edited. Eleven relevant main source owners were checked against `121d26528`; source/build/input receipts retain hashes.

The baseline launcher's parent exited 2 after all three completed replay/score stages because its script was edited while the shell was still reading it. All three model run receipts are code 0 and their 23 clip files and scores are complete; [the receipt](../../data/replay/rest-face-20261115/baseline-launcher-receipt.json) records this separately. A and B launchers exited 0. No replay was silently treated as complete without its receipts.

All explicit writes were inside this worktree. Evaluation inputs and shared tensor fallbacks were read only; new tensors, decoded review frames, scores and patches are in the owned ignored folder. Candidate runs checked disk/data headroom before clips and sets; regenerable local cache entries were pruned. The largest printed folder size was 4.1 GiB (about 4.4 GB), below the 5 GB limit. Final disk free space is recorded in `verification.json`, well above the 8 GiB stop. A native runtime's 51-byte `:memory:.ses` scratch file was moved from the repo root into this run folder after replay. No rejected run folder remains.

**Tests on final kept A (Node 22.23.4).**

| Check | Result |
| --- | --- |
| `npx tsx --test packages/vision/src/*.test.ts` | 342 passed / 1 failed, 343 total. Only unchanged `mat-fit.test.ts` CPU budget: 1908.817 ms > 1500 ms. |
| Web watcher/vision tests, `-c packages/web/vitest.config.ts --maxWorkers=1` | 404 passed / 1 failed in 21 files. Only `remote-recognition.test.ts` voice case cannot import missing `double-metaphone`. Exact 21-file list: `web-test-files.json`. |
| `npm run typecheck --workspace=packages/vision` | Pass. |
| `git diff --check` | Pass. |

A's owner regression failed against main and passed against A, covering both 1.17× acceptance and 1.3× rejection with zero detected fingers. B's two lifecycle subcases failed against kept A and passed against A+B; the rejected combined build also passed 345/346 full vision tests, with the same unchanged CPU-budget failure. No tests were deleted or skipped to hide these failures. Exact logs are under `logs/`.

**Limits.** V5 has 138 agent-made labels, agent-estimated calibration, timing uncertainty and censored short windows. Names are independently established on only a small subset. One recovered label is below the older scorer report's provisional six-unopposed-gain noise floor; KEEP means the stated local gates passed, not established improvement on unseen footage. Incorrect corner fits, overlapping/covered outlines and the three provisional stale-source rows remain. A learned-size median cannot prove physical height or intent and can be contaminated by bad identities/split physical tracks. No live browser, camera, device, multiplayer or production proof was run, and virtual costs are not measured user latency.

Modified tracked files: `packages/vision/src/field-watcher.ts` and `packages/vision/src/board.test.ts`. New report: `docs/remote-duels/rest-and-face.md`. B's helper, watcher and test edits are present only in its ignored patch. HEAD/branch were not changed; all kept changes are uncommitted. No commit, push, merge, deploy, PR edit, footage download, recording-pipeline change or training occurred.

To repeat A, use a fresh output prefix and the retained serial driver:

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
REST_CANDIDATE_PACKAGES="$PWD/packages" \
  bash data/replay/rest-face-20261115/scripts/replay.sh candidate repeat-a
```

Main used the same driver with `main main`; A used `candidate a`; rejected A+B used `candidate b` and its then-frozen source snapshot. Rebuilding B requires applying its saved patch to a copy of kept A; deleted run folders are not replay inputs. [Results](../../data/replay/rest-face-20261115/results.json), [A decision](../../data/replay/rest-face-20261115/a-verdict.json), [B decision](../../data/replay/rest-face-20261115/b-verdict.json), and [rejected receipts](../../data/replay/rest-face-20261115/rejected-b-receipts/) retain the review trail.
