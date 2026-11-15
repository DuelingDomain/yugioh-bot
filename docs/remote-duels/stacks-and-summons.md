# Stacks and summons (Remote Duels)

Branch `feat/vision-stack-memory`, based on `343e98570`. Scope: a card on top of a card, on the field and on the GY/banished pile.

## Board memory and frame differences (15 November 2026)

A confirmed stack now survives a slow read or an Extra Deck search. It does not expire into the hand after five seconds.
The five-second window still bounds inference from cards that really left the field.

- The watcher keeps cover relations as a graph, bottom first. A new top can cover an intermediate card without losing the
  cards already under it. A kept, cell-only or covered detector outline is not proof that a lower card is visible again;
  the last published resting box supplies its footprint.
- When exactly one confirmed face-up monster disappears and exactly one occupied spot gains a clean settled top, the
  watcher checks the source against its learned empty mat. The stationary monster stays bottom, the incoming monster is
  next, and the new outline is top. A 1.5-second landing check protects the source while the new outline settles. Multiple
  missing sources or receiving stacks remain ambiguous. An unchanged neighbouring outline cannot claim a departed card.
- Empty cells retain their own before-frame appearance once the settled-cell analyzer agrees that they are quiet. The
  saved empty frame stays separate from the scenery the hand test learns later. True departures still use the existing
  sharpness, motion, hand and empty-spot checks.
- New covers require a resting outline with no hand or moving shadow. An existing cover can survive a hand passing over
  it. When a genuine outline of the known bottom reappears, two clean full scans release the lifted top instead of
  reversing the cover relation. A weak kept outline cannot establish this separation.
  The separation receipt prevents the Xyz vanished/pending/recent fallbacks from reclaiming that card until fresh
  cover or field-placement evidence appears. Link/Synchro departure inference is unchanged.
- A newly read Xyz binds the eligible known materials observed under it. The two-material minimum (or a rank-up
  holder) remains; an expired or unregistered material is not invented. A returning preview can use the same atomic
  `twin.place`/`fromRef` summon path as a new top. Vanished-only inference keeps its minimum material count.
- An unsure top over two known monsters asks once. If the player's Extra Deck is available, Xyz candidates whose Rank
  equals the monsters' shared Level come first. Missing facts, mixed Levels, Xyz/Link materials or a missing list supply
  no such prior. The prior only orders a question. A back-like unread top cannot turn the known materials into Set cards.

Measured replay results and verification are recorded below. Raw clips, labels, replay scripts, frames and per-label
traces stay local in the gitignored `data/replay/stack-memory-20261115/` folder.

## Earlier failure mode

- Watcher (`packages/vision/src/field-watcher.ts`): a track with no outline in 2 full scans, no hand and a clear spot is
  removed; the glue moves it to the hand. A covered card is kept only by chance (`spotSeen`: another outline overlaps
  its spot). Worse, the outline of the top card can be matched to the covered track (it is closer). The covered track
  then "changes" identity and the real top card loses its outline and goes to the hand.
- So for an Xyz Summon: the Xyz takes over the material's ref, the other material goes to the hand.
- Temple of the Kings partly covered: kept while the cover's outline overlaps it; else removed after 2 scans.
- GY: a new top is pushed only when a read of it finishes and wins the "is this a lifted/old card" checks. A read that
  fails or is unsure can leave the count low.

## Rules (what we build)

1. **Under.** A field track with no genuine outline is *under* another live track when the top overlaps its remembered resting box, is
   settled (identified, or still for 300 ms), has about the same size (area ratio 0.6-1.7, not a card held up), covers
   >= 40% of its last box and its centre: `track.under = <top id>`, hidden, never removed. The watcher emits `covered` once.
   When the top leaves or moves off, `under` clears and the normal rules apply (seen again = visible; not seen in 2
   scans = removed). An identified track whose look matches an outline wins that outline over a closer track whose
   look does not match (the top card keeps its own ref). A new outline over a confirmed card that reads as that card,
   or reads not sure but has the same look (other light, a turn), merges back into it: no new ref, no `placed`. A new
   look with an unsure read is a new card; over two known monsters it asks for an identity. Any battle position.
2. **Summon window (glue, 5 s).** The glue keeps, per seat: covered monsters (face-up, M/EMZ) and *vanished* monsters
   (face-up M/EMZ removed events). Vanished cards still go to the hand at once (rule 4); a summon re-routes them.
3. **Xyz Summon.** An Xyz Monster (catalog type) placed in M/EMZ, with 2+ eligible materials (covered under it, or vanished up
   to 5 s before its first outline / 5 s after its placement): `twin.place` carries `summon: {kind:"xyz", materialRefs}`
   (or `twin.attach` when it is already placed). Materials stay twin cards in zone `material` with `materialOf`; the Xyz
   has `materials: ref[]` (refs, not card ids, so copies, names, privacy and Undo keep working). Rank-up: an Xyz used as
   a material brings its own materials; an Xyz with materials alone is enough (cards in zone `material` are not
   counted alone). A camera lift of the Xyz to the hand keeps its materials for 30 s (it may come back). When the Xyz leaves the field or turns face-down, its materials go to the GY
   (in order). `twin.detach` sends one material to the GY (or another pile).
4. **Synchro / Link / Fusion.** Same window; materials go to the GY in the same undoable action (log line
   "Synchro Summon: X + Y → Z (materials to GY)"). Link: at most `link rating` materials (the newest vanished); never
   more than the vanished/covered cards; no rating = no camera summon. Synchro/Fusion need 2+, Link 1+. A vanished
   card counts only while it is still out of view in the hand. After placement, attach only while below the minimum
   (Xyz: only a card over the Xyz box). Invalid materials in a camera `twin.place` are skipped, not fatal.
5. **Default.** Outside a summon, a vanished card goes to the hand as today. Known face-up monsters moved onto each other
   stay known while the physical stack remains; there is no five-second hand default. Other overlaps wait 5 s for a summon.
   Then, only if the camera still sees the same stack (nothing on top, the top not moved
   back), the card under it goes to the hand ("Name → hand (covered)") and the top card moves. One Undo reverts both;
   the camera then leaves that stack alone. A monster that truly left the field can still be reclaimed within the departure window.
   An Xyz material put in the GY / banished pile is detached there (no second copy).
6. **GY/banished pile (a log, not a picture).** The camera only confirms the top and adds new tops.
   - Pile lift (`pile.lift`, toast with Undo) only after >= 2 s of sharp frames (blur gate from `feat/remote-detect-fix`
     only), no hand, no outline, and a spot that no longer looks like the pile.
   - Re-check against the mat: the watcher compares the GY and banished cells with their empty-mat baseline (or plain
     mat) on every sample. A cell is clear only on a sharp frame, with no hand or moving shadow over it and no card there
     that still looks like itself. A blurred frame is never clear. A clear cell for 2 s is a pile lift, also when the
     detector still returns a stale low-score outline there. Scan field (S) does the same for GY and banished as for
     Deck and Extra: after its two passes, an empty cell with no hand is lifted at once.
   - Before the lift, the board accounts for the pile cards that show up elsewhere: a member the camera placed on the
     field as a new card (seen now, first seen at most 10 s before the cell cleared) is merged with that field card
     (one card, "X moved from the GY"). Only the other members go to the hand.
   - Revive (no prompt): a card that shows on the field while the same card lies in this seat's GY/banished pile is
     that pile card moving (`twin.place` with `fromRef`, one Undo) when the pile cell shows the empty mat, the pile
     is gone, or a hand was over the pile just before and the card was the top. While a hand was over that pile in the
     last 1 s, the placement waits (at most ~1 s) for the cell to settle. A card that the camera still sees on the pile
     stays there, and the field card is a new copy. The "2×" badge is then correct: it counts the copies of one card
     on the field and in the piles; the pile number counts the cards in the pile.
   - A top that looks the same = no change. A lower card seen on top = the cards above it left (existing rule).
   - A top that cannot be read: unsure reads get a best match (as on the field); a low match pushes an unnamed card.
   - A new pile card needs entry evidence (camera running > 2 s, and a hand over the pile from 10 s before, or a sure
     read that differs from the current top); a re-read
     after a restart binds to the current top. An unread "Unknown" top is a log entry too (never renamed by the next).
   - Pile viewer: newer/older (`pile.order`), "Name it" (`card.identified`), "Remove from pile" (`twin.remove`).
     For 3 s after a reorder the camera does not take cards out of that pile.
   Earlier text of this rule: Each new top (new outline or a changed top look after a hand passed) is read with priority and
   pushed once in order. Idempotent: the same physical top (same look as the known top) is never pushed again. If the
   new top cannot be read in 3 s, the glue pushes an unnamed face-up card ("Unknown card") so the count stays right;
   the player names it later (pile viewer). The board shows the pile count; the pile viewer lists all cards in order.

## Shared state (`packages/shared/src/remote`)

- `TwinCard.materials?: string[]` (Xyz, bottom first), `TwinCard.materialOf?: string`; zone `material` (pile shape,
  public, never a physical slot).
- Actions: `twin.place.summon?`, `twin.attach {cardRef, materialRefs, kind}`, `twin.detach {cardRef, materialRef, zone}`,
  `pile.order {zone, cardRefs}` (owner fixes the pile order).
  A material must be the actor's card on the field (M/EMZ) or in the hand with `departedFrom` M/EMZ within 30 s.
- One reducer path `applySummon` for place and attach; links are cleaned after each action (like Equip links).

## UI

- Board card: "2 mat." badge. Inspector: list of materials with Detach. Voice: "detach" detaches the bottom material
  of the only Xyz with materials, or of the named one ("detach material from <name>").
- Debug labels: one short line above the box (`#c-74 M3 id up`), 9px; the reason shows on hover / in a title.

## Tests (lean)

- Fenrir scenario (`packages/vision/src/board.test.ts`): Xyz over two stacked materials (one moved from M4), Temple
  partly covered stays, 3-card GY sequence (Apophis → Temple → Man with the Mark, hands over the pile) count 3, in order.
- Shared reducer test (`preserves slot metadata ...`): Xyz place with materials, rank-up, detach, Xyz leaves → GY,
  Synchro materials to GY, Undo.

## Limits

- A card that turns and also reads sure as a different card is a new card on top (rare: a sure read needs the art).
- A known monster stack waiting for a summon keeps its physical relation; other covers use rule 5.
- A remembered identity is required. The watcher cannot recover names that were never admitted before the cards were covered.
- Token roles and spell/Graveyard effect attachments still need their own lifecycle and material-eligibility work.

## Not in scope

Opponent cards under my cards; Pendulum/Link arrows; material identity reads from under a card.


## Replay diagnosis and proof (15 November 2026)

The fresh baseline runs reproduce `343e98570`: v2 original 26/3/36 and v3 field/action 2/2/35
(on time/late/missed). Their 22 source hashes match `343e98570`. The stack contact sheet and three fresh placement frames were inspected locally;
raw labels, frame strips and per-label traces remain gitignored. Detailed trace indexes and the eleven individual diagnoses are local in
[`DIAGNOSIS.md`](../../data/replay/stack-memory-20261115/DIAGNOSIS.md) and
[`stack-diagnosis.json`](../../data/replay/stack-memory-20261115/baseline-v3/stack-diagnosis.json).

Primary causes count each label once: **7 missing confirmed prerequisites, 2 token-marker role failures,
1 top admission failure, and 1 incomplete-material binding/eligibility failure**. Additional blockers overlap.
The eleven individual label records and frame/trace links remain in the local diagnosis; they are not copied here.

The inherited offline harness already runs `fieldSummonKind`, `fieldSummonMaterials`, placement helpers and a
five-second summon/default window. It does not mount React. Its local copy now uses the new bottom-first traversal
and known-monster waiting rule, including cancellation when a waiting material is visibly lifted away. Browser queue effects and mutations remain an offline model; shared reducer tests
exercise actual material state separately. No label identities or deck lists seed the watcher. Missing Link `level`
in the raw local catalog is an additional harness limitation, not proof of a browser catalog bug; the production
contract supplies Link rating as `level`. No complete label is attributed solely to window expiry.

Final verification, using Node 22.23.4:

- Full vision suite: **334 passed / 2 failed / 0 skipped**. Failures are the unchanged `mat-fit.test.ts` printed-centres
  case and `pipeline.test.ts` deck-restriction case supplied as baseline failures. The suite includes watcher, pile,
  stack and pixel tests. `--test-force-exit` lets the unchanged client Worker test finish without excluding it.
- Related web tests: **167 passed / 2 failed** across six files, including all six new stack/glue cases.
  Failures are the missing `double-metaphone` dependency and the pending-identity-transfer test. The latter also fails
  with the baseline watcher in the separate baseline check.
- Related shared tests: **274 passed / 0 failed** (`card-behaviour` and `remote-duels.integration`).
- Typechecks fail in unchanged source: vision `web-runtime.ts` GPU-adapter typing; web voice room fields and missing
  `double-metaphone`. The new test fixtures typecheck without additional errors.
- Fail-before/pass-after checks cover stack separation in all three Xyz fallback paths and a weak lower outline
  during arrival of the new top. The requested immediate/late-read, lifted material, empty-mat departure and passing
  hand cases all pass. These are synthetic watcher/helper/reducer checks, not browser-camera proof.

```sh
export PATH=/Users/imranqureshi/.nvm/versions/node/v22.23.4/bin:$PATH
node --import tsx --test --test-force-exit --test-concurrency=1 packages/vision/src/*.test.ts
node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts \
  packages/web/tests/vision-stack-memory.test.ts packages/web/tests/field-removal.test.ts \
  packages/web/tests/remote-recognition.test.ts packages/web/tests/remote-hand-contact.test.ts \
  packages/web/tests/remote-skin-contact.test.ts packages/web/tests/remote-sideways-read.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config packages/shared/vitest.config.ts \
  packages/shared/tests/remote/card-behaviour.test.ts \
  packages/shared/tests/remote/remote-duels.integration.test.ts --maxWorkers=1
```

Removed during review: allowing one observed material to trigger a new Xyz summon. It broke the existing
expired-material contract (one remaining live monster is insufficient). The normal two-material minimum and rank-up
exception are retained. Superseded and incomplete trial run folders were removed after preserving summary/receipt
files; the fresh baseline and final traces remain local.


### Measured result of the retained build

The keep rule passes, but **complete stack/summon-material labels remain 0/11**. The requested normal sequence is
verified by synthetic watcher and shared-reducer tests; this clip set does not establish end-to-end stack success.
All fifteen final clips were rerun with the current reader, four-corner calibration, 30 fps,
170/228 ms simulated detector/reader costs, and one native inference thread per lane. The baseline was freshly reproduced before the product edits; its complete receipts and source hashes were verified again after interruptions.

| Metric | v2 before | v2 after | v3 before | v3 after |
| --- | ---: | ---: | ---: | ---: |
| On time / late / missed (original task scoring) | 26 / 3 / 36 | 26 / 3 / 36 | 2 / 2 / 35 | 2 / 2 / 35 |
| On time / late / missed (corrected v2) | 27 / 5 / 37 | 27 / 5 / 37 | same as above | same as above |
| Questions | 4 | 4 | 5 | 5 |
| Watcher placements | 39 | 39 | 16 | 15 |
| Non-card phantoms | 0 | 0 | 0 | 0 |
| Hand/search/Extra preview placements | 0 | 0 | 3 | 3 |
| Real wrong names | 0 | 0 | 0 | 0 |
| Wrong-name outcomes (original scorer) | 3 | 3 | 0 | 0 |
| Stale registered sources | 0 | 0 | 0 | 0 |
| Wrong zones (original task scoring) | 3 | 3 | 4 | 4 |
| Scored Sets / 6 | 3 | 3 | — | — |
| Scored flips / 2 | 2 | 2 | — | — |
| Token markers placed as Sets | 0 | 0 | 2 | 2 |
| Placement delay median / p95, seconds | .663 / 12.180 | .663 / 12.180 | 3.157 / 8.074 | 3.157 / 8.074 |
| Corrected v2 placement median, seconds | .678 | .678 | — | — |
| Detector requests / reads per minute | 85 / 10.1 | 85 / 10.1 | 79 / 5.857 | 79 / 5.857 |
| Complete stack/material labels / 11 | — | — | 0 | 0 |

The corrected v2 scorer prevents one label consuming another label's card, excludes a 0.4-second censored arrival,
and separates an unchanged pile-top name from a real wrong read. It reports one wrong-zone outcome instead of three;
the original wrong-name outcomes include label-consumption conflicts and retained pile-top names, rather than new wrong-name placements. No labels were edited. V3 uses the
reviewed 43 field/action labels; 15 held observations remain separate. The legacy all-kind v3 script also remains
unchanged at 4/1/57, which is a different scoring universe from the task's field/action totals.

V2's 39 placement payloads and times are identical after ignoring event-log join keys. All 54 final placements
transfer one-to-one from the control frame review with matching identity, face, zone and pose, within one second
and .02 per corner; no unreviewed placement was accepted. V3 loses one repeated top-card placement, with no change to
scored field outcomes. The two token-marker Sets and three private/preview placements are existing errors, not
successful stack behavior. Source-clear accounting covers eight established v2 sources and four registered v3 lifts;
all clear in both builds. It cannot measure cards that were never registered. No covered known material becomes a
new Set in the owner tests, and no new phantom or Set placement appears in either replay.

Evidence: local `verified-v2/`, `verified-v3/`, `verified-summary.json`, `verified-keep-review.json`,
`verified-keep-gates.json`, `verified-v2-placement-comparison.json`, `verified-source-equivalence.json` and
`verified-provenance.json`. Both complete run receipts report code 0. Final product-source receipts match the current
files, and rebuilding the current source produces byte-identical replay cores. Replay helpers and inference artifacts
remain gitignored. The retained replay read existing inference caches and did not save cache misses. Diagnostic placement frames and a
contact sheet were decoded earlier into the gitignored review folder. No recordings were changed. Superseded trial
folders were removed after preserving receipts.

Execution note: a sandbox-denied PID stop briefly overlapped two incomplete retry pairs. Both were interrupted through
the execution sessions and their incomplete folders removed. The completed retained replay used two parents. Disk
preflights were above 1 GiB; the local runner stops below that threshold. This scheduling deviation is recorded in
`decisions.tsv`.

Known limits: no live browser, WebGPU/WASM camera, network queue or persistent reload was exercised. The background
signal still has the inherited limitation that a completely still hand can be learned after four seconds. Fully hidden
contents and simultaneous independent departures/arrivals remain ambiguous; the unique-source rule is a contextual
inference. Unknown starting identities, weak top reads, token roles and effect-driven spell attachments still block
these clips. No model was trained and the recording pipeline was not changed.


### Changed files

- Vision runtime: `packages/vision/src/field-watcher.ts`, `field-stack-memory.ts`, `field-motion.ts`, `index.ts`.
- Vision tests: `packages/vision/src/board.test.ts`, `scene-pixels.test.ts`.
- Web: `packages/web/src/components/remote/field-watcher.tsx`, `packages/web/src/lib/remote/field-summons.ts`,
  `packages/web/tests/vision-stack-memory.test.ts`.
- This document: `docs/remote-duels/stacks-and-summons.md`.

No commit was created by this execution. HEAD advanced externally to `a706cf0c8` while verification was finishing;
the follow-up separation handling and final documentation corrections remain uncommitted. No push, merge, deployment or PR update was performed.
