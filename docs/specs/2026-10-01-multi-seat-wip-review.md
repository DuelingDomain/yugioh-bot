# P68 review of the saved overlay work

Review date: 2026-10-02. The base is the installed P68 Standard and Domain cores, patches 0001 through 0068. The final owner decisions of 2026-10-02 apply. The archived PLAYER_ALL and zone hit lists are historical P61 evidence. Their old counts and opponent-field rules are not current P68 results.

This review covers the 17 saved, untracked suffixes, the two modified delayed-effect suffixes, the three modified native checks, the pending-rule edit, the audit runners and the five historical evidence documents. It also fixes the Pair Bear defect found by the required table checks. No installed engine file or core source was changed.

## Completed card fixes

Each fix has a separate commit with its suffix, generated manifest entry and real-engine proof. The proofs check the final state of every seat. Stock 1v1 controls use stock scripts. The LP fixture skips the opening Draw Phase so these card tests do not depend on the host's first-draw change.

| Code | Card | Saved defect and final change | Green cases per core | Without the fix, per core |
| --- | --- | --- | ---: | --- |
| 11110587 | That Grass Looks Greener | Compare one declared smaller Deck in FFA and Tag; mill only the acting Deck. | 12 | Joined-Deck Tag variant: 4 fail. Smallest-Deck variant: 1 fail. |
| 22593417 | Topologic Gumblar Dragon | Bind the opponent before either hand discards. | 7 | 6 fail, 1 pass |
| 26273196 | Time Wizard of Tomorrow | Choose the damage opponent at activation. Check both coin results. | 18 | 12 fail, 6 pass |
| 46918794 | Tremendous Fire | Choose the damage opponent at activation. | 9 | 6 fail, 3 pass |
| 6909330 | Soul Binding Gate | Keep the event opponent bind; pick only for an own event. | 12 | The wrong-seat variant fails 6 FFA cases. |
| 76004142 | Bad Luck Blast | The same opponent supplies the target and takes the damage. Other fields are absent from the target list. | 9 | 6 fail, 3 pass |
| 83819309 | Cooling Embers | Keep the event opponent bind; pick only for an own event. | 12 | The wrong-seat variant fails 6 FFA cases. |
| 48814566 | Banquet of Millions | Return each Extra Deck card to its real owner at End Phase. | 4 | 3 fail, 1 pass |
| 51612489 | Riot's Reason | Remove the owner hint pick; return a stolen monster to its owner and let that owner summon. | 6 | 4 fail, 2 Tag controls pass on the prior suffix |
| 21501961 | Pair Bear Scare!! | Bind both target steps and offer only the declining duelist's monsters. | 18 | 2 Tag decline cases fail on the prior suffix; 16 pass. |

The first nine rows account for nine of the 17 saved suffixes. Pair Bear already had a committed suffix. Its proofs cover reveal, return and decline with holders p0 and p1 in FFA3, FFA4 and Tag. The old suffix produced a forbidden bind in FFA and a nil reveal card in Tag.

The original completion run, before the review corrections below, passed **239 of 239 cases on each installed core**, in 16 files: the card fixes and unchanged LP controls (109), PLAYER_ALL API boundary (27), hidden-zone pairs (50), zone triggers (44), existing controller summons (6), and the independent P68 Worm proof (3). These are distinct cases. The 54 related table-outcome cases overlap this set at Cooling Embers and Worm; do not add the totals as if every case were unique.

The PLAYER_ALL API proof retains the exact-category and actual-group-size checks, including rejected calls. Accepted calls complete the real card action. The new hidden-zone pair and zone-trigger tests prove card outcomes. Their ordinary runs do not prove activation-time opponent binding for every stock card.

## Work that requires another core

Seven saved suffixes have correct destination outcomes on P68 but fail their exact Tag summon-actor proof on both cores: `Wrong summon actor: got 2 expected 0`. The destination bind changes the folded actor. An optional Lua fallback does not fix that core limitation. These partial fixes are excluded from the active manifest and saved as separate patches with their proofs and generated metadata.

| Code | Card | Prerequisite | Destination result per core | Exact Tag actor result per core |
| --- | --- | --- | --- | --- |
| 11163040 | The Kaiju Files | MPActionSeat | 3 pass; stock has 1 fail and 2 pass | 1 fail |
| 14772491 | Common Soul | MPActionSeat | 3 pass; stock has 3 fail | 1 fail |
| 45112597 | Worldsea Dragon Zealantis | MPActionSeat | 3 pass; stock has 3 fail | 1 fail |
| 68223137 | One-Kuri-Way | MPActionSeat | 3 pass; stock has 3 fail | 1 fail |
| 76524506 | Garden Rose Flora | MPActionSeat | 3 pass; stock has 3 fail | 1 fail |
| 90500169 | Level Down!? | MPActionSeat and MPOwnerSeat | 3 pass; stock has 3 fail | 1 fail |
| 91742238 | Return of the Zombies | MPActionSeat | 3 pass; stock has 3 fail | 1 fail |

Exports are under `packages/duel-server/domain-core/.build/phase1/gap-overlay/in/overlay-wip/`, named `local-CODE-overlay-and-proofs.diff`. Apply them in the order in `local-export-bases.json`. That file records the exact base commit and each base/result tree. All seven complete patches pass `git apply --check --cached` in that order with a private index. This proves that they apply; it does not prove the pending core behavior. The Level Down stolen-Tag-owner branch also needs an integration proof after MPOwnerSeat is installed in a private core.

The eighth saved suffix, **57809669 Hecahands Tartaros**, is clearly broken. All three saved-suffix proofs fail on each installed core. A real Give and Take creates the stolen Fusion material, and its actual owner/controller and material group were checked. Tartaros still does not appear as a legal activation. No valid fix was proved. Its exact suffix and three proofs are saved in `local-57809669-unresolved-suffix-and-proofs.diff` and in the ignored archive. It is removed from the active manifest and runnable tests. This is unresolved work, not a completed card fix.

The modified Book of Eclipse (`c35480699.lua`) and Prediction Princess Astromorrigan (`c5010422.lua`) suffixes require the pending C3 declared-opponent and C4 lasting-effect rules. Their exact edits are saved in `phase1/df-p3/in/overlay-wip-book-astro.patch`; the tracked scripts are restored to their P68 versions. The modified native expectations are saved separately: `phase1/df-opp/in/overlay-wip-f7-window.patch`, `phase1/df-elim/in/overlay-wip-elimination.patch`, and `phase1/df-elim/in/overlay-wip-simultaneous-loss.patch`. All four patches passed their apply check. No pending-core pass is claimed.

The pending first-draw rule removal belongs with the first-draw owner's host change. The saved edit is `phase2/briefs/wave2/reports/overlay-wip-first-draw-coverage.patch`. The rule list was restored rather than committing another owner's change.

## Table and manifest checks

The old check rejected Cannons because its boolean activation check was named `target`. The corrected lint reads the named Lua function and accepts its own `chk==0` branch. A negative regression proves that a different callback cannot supply the branch. Linkerbell's local boolean cost alias is accepted. A bare field count is still rejected.

Six cards need events or materials absent from the generic table game: Criosphinx, The Fabled Unicore, Linkerbell, Fallin' Cheatah, Worm Millidith and Cooling Embers. Each table exception states the exact missing event or material and names a real outcome proof. Those six suites pass 54 cases on each installed core. The new Worm wrapper uses the P68 equip target prompt and checks every seat's Extra Deck and remaining Deck count. It leaves another owner's C3 fixture unchanged.

Before removing the eight outgoing suffixes, the complete table passed 843 checks on the Standard P68 trap core and 843 on the installed Domain release core. The remaining manifest failure was the uninstalled MPActionSeat call. The default table core remains the debug core. `TABLE_TRAP_WASM` has precedence; `NSEAT_WASM` permits the separate Domain outcome run. A release-core run does not prove the absence of diagnostics that only the trap core emits. The final production table and manifest counts are recorded in the task report.

## Disposition of each audit file

The 32 top-level audit files are preserved byte for byte under `phase1/overlay-wip/archive/`. The report's `overlay-wip-audit-inventory.json` records the original path, archive path and SHA-256 for each file. No original was deleted. Print runners and repeated wrappers are excluded from normal test discovery. Real cases were promoted or retained in permanent scenarios, or preserved as pending-core evidence.

| Archived file | Purpose and disposition |
| --- | --- |
| audit-all-hands-chaos.test.ts | Tag Chaos Emperor Dragon stock comparison; the real action is in all-player-zones. Archive the print runner. |
| audit-all-hands-circle-phase.test.ts | Underworld Circle Standby comparison; the real action is in all-player-zone-gaps. Archive the print runner. |
| audit-all-hands-cleaners.test.ts | Deck removal and reveal comparisons; permanent cases are in all-player-decks. |
| audit-all-hands-existing.test.ts | Repeated late-card and LP scenario runner; keep the existing scenario suites. |
| audit-all-hands-extra.test.ts | Extra Deck comparison runner; permanent cases are in all-player-extra. |
| audit-all-hands-pairs-b.test.ts | Additional paired zone actions and triggers; promote paired-zone-triggers. |
| audit-all-hands-pairs.test.ts | Hidden-zone pair actions; promote paired-hidden-zones. |
| audit-all-hands-permanent.test.ts | Repeated runner for all-player-zone-gaps, all-player-decks and all-player-zones. |
| audit-all-hands.test.ts | Neo-Daedalus, Norleras, Sophia and Law stock comparisons; permanent cases are in all-player-zones. |
| audit-global-regression.test.ts | Result-file aggregation, with no test registration. Preserve as evidence only. |
| audit-global-seat.test.ts | Temporary global-seat runner imports ignored scratch probes. Existing global-seat scenarios remain; preserve the runner as evidence. |
| audit-owner-actions.test.ts | Mecha Bunny and Mimighoul Fork outcomes already in owner-actions. |
| audit-player-all-boundary.test.ts | Exact API boundary; promote and complete player-all-operation-info. |
| audit-player-all-existing.test.ts | Repeated compare, seat, revival and other committed scenarios. |
| audit-player-all-stock.test.ts | Stock LP/action exploration; use the permanent each-player, revival and LP pair suites. |
| audit-player-all-timing.test.ts | Temporary LP instrumentation; the new LP suites assert the required prompt timing and every seat's outcome. |
| audit-player-all.test.ts | Revival and each-opponent exploration; permanent revival and each-opponent scenarios retain the real actions. |
| audit-root-action-actor.test.ts | Exact Tag summon-actor probe. Seven affected new suffixes have separate exported proofs. Preserve the broader probe for owner/action core integration; no pending-core green claim. |
| audit-root-combination.test.ts | Combination Attack destination; already in combination-controller. |
| audit-root-destinations.test.ts | Materialization/Hydor destination drafts; permanent owner-field-returns and hydor-owner scenarios retain these outcomes. |
| audit-root-fork-legality.test.ts | Mimighoul Fork owner-Deck legality; already in fork-draw-legality. |
| audit-root-fork-stolen.test.ts | Stolen Tag owner branch; preserve the exact draft for owner-seat integration. |
| audit-root-hydor-fixed.test.ts | Repeated Hydor destination draft; permanent hydor-owner scenarios retain the outcome. |
| audit-root-local-summons.test.ts | Local controller/owner summon runner; promote Banquet, Riot and the existing controller controls; export the seven core-dependent cards. |
| audit-root-local-units.ts | Static scan of local recipient variables. No card-outcome test; archive the scanner. |
| audit-root-materialization-preview.test.ts | Earlier Materialization destination draft; permanent owner-field-returns scenarios retain the outcome. |
| audit-root-materialization-stolen-red.test.ts | Failing stolen-owner draft; preserve for owner-seat integration. |
| audit-root-materialization-stolen.test.ts | Stolen-owner follow-up; preserve for owner-seat integration. |
| audit-root-materialization.test.ts | Repeated Materialization destination draft; permanent owner-field-returns scenarios retain the outcome. |
| audit-root-ninja.test.ts | Black Dragon Ninja delayed return; already in black-dragon-return. |
| audit-root-raw-filter.ts | Static recipient scan and printed results; archive the scanner. |
| audit-root-skip-draw.ts | Temporary mocked helper. Permanent LP proofs use an explicit real-engine Draw Phase fixture. |

The two historical hit-list Markdown files, ranked PLAYER_ALL CSV, raw scan CSV and timing JSON are kept byte for byte in `packages/duel-server/domain-core/.build/phase1/overlay-wip/archive/`. They are ignored local evidence. Only this disposition document stays in docs. The static findings do not prove every card branch or pending rule.

## Remaining integration work

No native check, core gate or nduel run was required for these overlay/test changes, and none is claimed. The three exported native expectation changes must be tested by their core owners after C3/C5 integration. The owner/action core task must run the saved destination and exact-actor proofs on private Standard and Domain builds.

The final task report lists current TypeScript errors in other owners' files. No file changed by this task has a type error. Earlier historical-suite runs had two P68 failures in all-player-zone-gaps because another owner had added a C3-only opponent prompt to Underworld Circle. The same issue affects the old Worm fixture; the new independent P68 Worm proof covers the table exception. Do not change an owner's scenario to match an uninstalled core as part of this overlay review.

## Review corrections

- Finding 1: a real-engine probe changed only the owner value in the possible summon hint to PLAYER_ALL. The FFA pick disappeared. Six cases per installed P68 core now check no pick, the actual owner choice, and every seat. Four cases fail on the prior suffix; the two Tag controls pass.

- Finding 2: Time Wizard now has a 1700 ATK monster on every unpicked field, including the Tag partner. Eighteen cases per P68 core check both coin results, every Graveyard and the exact LP sum. A private suffix that keeps only own and bound fields fails all 16 multiplayer cases per core; its two 1v1 controls pass. The active suffix already has the correct all-field action.

- Finding 3: P68 probe_bind pins the event opponent before the target check. MPPick preserves that bind. Each card now has FFA3, FFA4 and Tag cases where the last opponent causes the event, with no free pick and exact LP for every seat. The two suites pass 24 cases per core. A private operation that redirects Lua 1 to seat 1 fails all four new FFA event cases, and eight prior cases, per core. The six Tag cases remain controls. No core change is needed.

- Finding 4: six decline cases put monsters on two opponent fields and check the complete destroy options. The prior suffix fails the two Tag cases on each P68 core. Individual GetFieldCard reads now build the bound duelist's monster group; joined Tag field queries are not used for this choice. All 18 cases pass per core.

- Finding 5: Gumblar checks both hand options in every case. Grass checks the exact eligible seats when two opponents qualify; a sole eligible opponent is bound silently and must leave an action prompt. Banquet uses explicit steps to check every opponent option, every unchanged seat and no resolution before the pick. No harness auto-picks an unexpected Grass or Banquet prompt. The three suites pass 21 cases per core. Negative suffixes fail 16 cases per core: Gumblar 6, Grass 7, Banquet 3.

- Finding 6: the owner answer already records one declared opposing Deck in Tag. Two new cases use own Deck 8, opposing Decks 5 and 3, and partner Deck 12. Choosing seat 1 mills 3; choosing seat 3 mills 5. Every other Deck and every LP total stays unchanged. The 12-case Grass suite passes per core. A joined-Deck comparison fails all four positive Tag cases, including both new cases. An automatic smallest-Deck operation fails the new seat-1 case per core.

- Finding 7: a new commit removes the three raw CSV/JSON dumps and the two historical hit lists from docs. All five archived files match the bytes in b16f5dd and their original SHA-256 values. The archive inventory is `phase1/overlay-wip-fix/archive-inventory.json`. b16f5dd remains in history.
