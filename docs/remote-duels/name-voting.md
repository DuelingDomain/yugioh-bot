# Card names without another model

Measured on 15 November 2026 from `343e9857055383f89cdc1d0644bc712c4f99268f`, branch `feat/vision-name-voting`. Changes remain uncommitted. The existing detector, DINOv2 reader, catalog and recording pipeline are unchanged.

## Kept behavior and switches

A new, unbound resting front gets the existing single-frame read first. A **sure** result returns immediately. A usable upright “not sure” name also keeps its ordinary path. Only a low match or an unsure sideways result blocked by the existing .77 guard can open a voting window. First reads taking more than **500 ms** skip it; this is a conservative cost gate, not a calibrated device classifier.

For **420 ms**, ordinary watcher scans can supply up to four snapshots, at least 100 ms apart. They must remain still, on the mat, hand-free, uncovered and show the same artwork. Rank their crops using `quality.ts` Laplacian sharpness multiplied by non-glare share. With two usable samples, send the original plus the best two to the existing three-frame embedding mean, without early exit. Three unique images therefore cost four frame reads, because the initial image is read again. Frame disagreement cannot manufacture a sure result. Invalidated reads cannot publish; cloned frames are closed. `FieldWatcherOptions.nameVoting:false` disables this path.

An explicit `priors.decklist` uses **.78 score / .06 margin**, after checking the unboosted full-catalog winner and per-frame agreement. Dynamic and likely sets retain .80 / .05. Membership cannot replace a better off-list identity, hide a reverse/whole-card answer, or suppress the normal raw/preclean decision. Soft deck answers wait for ordinary views; clear first reads stay fast. Missing lists keep the catalog/dynamic/likely path. `deckFirst:false` disables the closed-set path; omit the deck list to remove this new explicit-list acceptance. Existing catalog thresholds and calibrated floors remain in force.

The web already supplies the list: `recognitionPriorsFor` in `lib/remote/recognition-priors.ts` includes main, extra and side cards; `components/remote/ui/recognizer.ts` maps passcodes/aliases to index IDs in `priorsFor`, derives related sets, and passes them through `ownFieldResources.getPriors` to the watcher. Public opposing cards contribute context/seen; hidden hand and Set identities do not. No web production change was needed.

## Final replay results — ran

Baseline was reproduced before changes. All 15 event traces match the supplied `final2-*` baseline traces. V2 has 10 clips and 71 labels. V3 uses the reviewed **43 field/action labels**, not the legacy 64-label scorer. Original and corrected v2 scoring are both retained. Corrected scoring reserves exact label matches, excludes one censored label and removes stale pile-top wrong-name assignments; labels were not edited.

| Metric | v2 baseline | v2 no list | v2 list | v3 baseline | v3 no list | v3 list |
|---|---|---|---|---|---|---|
| On time / late / missed, original | 26/3/36 | 26/3/36 | 26/3/36 | 2/2/35 | 2/2/35 | 2/2/35 |
| Corrected scoring | 27/5/37 | 27/5/37 | 27/5/37 | same | same | same |
| Correct named top-card episodes | 12 | 12 | 12 | 4 | 6 | 6 |
| Real wrong names | 0 | 0 | 0 | 0 | 0 | 0 |
| Questions | 4 | 4 | 4 | 5 | 5 | 5 |
| Placements | 39 | 39 | 39 | 16 | 18 | 18 |
| Completed reader calls | 101 | 99 | 99 | 41 | 54 | 54 |
| Reads per placement | 2.59 | 2.54 | 2.54 | 2.56 | 3.00 | 3.00 |
| Placement median / p95, seconds | 0.663 / 12.180 | 0.620 / 12.180 | 0.620 / 12.180 | 3.157 / 8.074 | 3.157 / 8.074 | 3.157 / 8.074 |
| Phantoms, including duplicate physical instances | 0 | 0 | 0 | 0 | 0 | 0 |
| Hand / search / Extra preview placements | 0 | 0 | 0 | 3 | 3 | 3 |
| Stale registered sources | 0 | 0 | 0 | 0 | 0 | 0 |

The two extra v3 names are correct Dracossack and Link Spider tops. Their actions still fail the scorer's material/stack semantics, so overall action counts do not improve. “Correct named episodes” counts matched named tops, including these failed actions; it is not full action success. The three original v2 wrong-name outcomes remain pile-top scoring artifacts; corrected real wrong names remain zero. Placement delays use 16 successful timed matches on v2 and four on v3. Common-match median added delay is zero; v2's largest increase is 80 ms and v3's is zero.

Safety classes were transferred only for matching identity, face, pose, slot, close time and overlapping quads; new cases were inspected in local frame sheets. No final placement remains unclassified, and no new persistent duplicate was found. Source checks cover eight established v2 and three v3 sources; missing source registrations are excluded. Zero stale sources in this cohort does not prove removal safety for every visible card.

Each replay list contains the clip's label names plus **40 other physical cards**; clips without named labels get 40 distractors. With and without a list, scored outcomes are identical. These synthetic lists are optimistic priors, not evidence from real uploaded decks. Unit tests cover off-list near ties, reverse views, clear first reads, whole-card alternatives and precleaned alternatives, plus the lower in-list floor.

A further native-inference replay withheld every labeled name from the list on one focus clip per set, leaving only the 40 distractors. It produced 9 and 5 named placements, zero distractor-name placements and zero real wrong names (corrected v2 / reviewed v3). These are focused off-list checks, not another full-set score.

## Cost — ran with a fixed clock, not measured device latency

Normal costs are 170 ms per detector operation and 228 ms per single-frame reader operation. A three-frame retry also pays for redetection: the observed batch costs **1704 ms** (3 × 228 + 6 × 170), after the first 228 ms and the 420 ms window. Total **2352 ms**, or **2124 ms extra**, on those attempts. A window without enough clean samples costs 420 ms and no extra reader call. At most one extra three-frame request occurs per eligible read attempt; ordinary retries can attempt another window. Four extra frame clones are retained at most.

Two three-frame batches ran in each final set. Sure first reads remain one request and 228 ms. Completed read counts and reads per placement are above. Observed logical ONNX reader-worker requests, including reader-side detection and cache hits, rise from **266/145** (v2/v3 baseline) to **300/192** without lists, or **284/179** with lists. These are work counts, not a benchmark speedup.

The supplied **1121 ms slow-reader model** was run on one focus clip per set, baseline and final. Calls remain **21→21** and **3→3**, all single-frame; first-read duration stays 1121 ms, extra voting calls and added delay are zero. V2's placement median stays 2.475 s; that v3 focus has no placements. This is a two-clip slow-model check, not a full slow-device replay or hardware measurement.

## Measured alternatives and reverts

Each row replayed both complete clip sets independently. Cells show original on-time/late/missed, followed by correct named episodes (N), questions (Q), reads per placement (R), and median delay in seconds (D).

| Trial | v2 | v3 | Decision |
|---|---|---|---|
| Score votes | 24/4/37; N12 Q4 R3.08 D0.648 | 3/2/34; N6 Q4 R2.79 D2.210 | Rejected: one duplicate physical card in v3 |
| Broad embedding mean | 22/6/37; N12 Q4 R2.74 D0.536 | 2/3/34; N8 Q4 R3.11 D4.214 | Rejected: v2 on-time reads delayed |
| Targeted mean prototype | 26/3/36; N12 Q4 R2.54 D0.620 | 2/3/34; N8 Q4 R3.22 D4.218 | Superseded: strict sure-first and slow-read gates added |
| 90/270, guard removed | 26/3/36; N12 Q4 R2.56 D0.726 | 3/3/33; N5 Q4 R2.22 D2.595 | Rejected: one departed token source stayed in v3 |
| 90/270, guard .76 | 26/3/36; N12 Q4 R2.62 D0.726 | 2/2/35; N4 Q5 R2.50 D3.157 | Rejected: no naming gain, more work |
| Deck-only trial | 26/3/36; N12 Q4 R2.59 D0.663 | 2/2/35; N4 Q5 R2.56 D3.157 | Safe; no added named episodes |

Corrected v2 outcomes for score votes were **25/6/38**, broad mean **23/8/38**, and every other row **27/5/37**. All rows retained zero real wrong names and no rise in hand/preview placements. Score voting made a second board instance of one physical Kashtira Birth; it failed the phantom cap. Broad mean delayed already usable reads. Side reads rectify quarter turns before the portrait warp; their pixel test passed, but the known glare misread survived. Removing .77 left a departed token source registered; .76 brought no gain. All extra side-angle production code was removed and **.77 remains**. The detector already canonicalizes portrait corner order, which helps explain the limited extra-angle benefit.

The targeted prototype's extra late success was not retained: the final version skips all sure first results and slow reads. Keep only the narrower final results above. Rejected source/tests and frozen runs remain ignored locally.

## Tests and proof limits

- Final vision suite: `node --import tsx --test --test-concurrency=1 packages/vision/src/*.test.ts`: **331 passed, 1 failed (332 total)**. The remaining unchanged `mat-fit.test.ts:78` CPU-budget assertion reports 1823 ms under load; it also failed on the baseline.
- Eight watcher Vitest files, `--maxWorkers=1`: **72 passed**. This includes five new tests for sure-first, three-frame recovery, slow/disabled voting and hand interruption. Two existing board dismissal/Scan cases explicitly disable the optional window to retain immediate state-transition checks; their assertions remain. The board file separately passes **143 tests**.
- Pipeline: **50 passed**, including mean fusion, disagreement and off-list guards. The baseline “deck restriction searches only its artwork rows” failure was stale opponent-public-context expectations later in that broad test. Its row-restriction assertions pass. Expectations now match existing public-card behavior and retain hidden-card exclusions; no web behavior was changed.
- Side-rectification pixel tests were run while that candidate existed; their source is archived with the rejected implementation, not shipped.
- Package typecheck (`npm run typecheck --workspace=@yugidraft/vision`, TypeScript 5.9.3): **pass**. The separate root TypeScript 6.0.3 check still fails on the unchanged `web-runtime.ts:221` GPU adapter type. `git diff --check`: pass.

All media, labels, copied scripts, ONNX caches, reviews and receipts remain gitignored under `data/replay/name-voting-20261115/`; original media stays in the evaluation worktree. The harness runs actual native ONNX inference and product code, caches only model/input-keyed pure tensors, and uses simulated browser board glue and fixed virtual costs. At most two replays ran together. Failed harness attempts and a transient disk-full retry are excluded.

**Inference limits:** the two recovered names appear on later single-frame reads after voting changes scheduling; these clips do not isolate mean fusion as their cause. No claim is made for live-camera reliability, browser WebGPU/WASM performance, new lighting, unseen decks or stack semantics. Existing v3 hand/search/preview failures remain. This is a small naming gain with extra normal-device work, not a general recall improvement.

Tracked files: `packages/vision/src/{field-watcher,pipeline,search,decision,pipeline.test,board.test}.ts`, `packages/web/tests/remote-name-voting.test.ts`, and this document. Local receipts include `baseline-exact-comparison.json`, `verified-{nolist,list}-summary.json`, safety reviews, paired-delay files, `verified-slow-cost.json`, `deck-list-receipts.json`, `off-list-receipt.json`, `final-gates.json`, and `provenance.json`.
