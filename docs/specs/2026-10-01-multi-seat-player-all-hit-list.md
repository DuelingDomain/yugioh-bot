# PLAYER_ALL script audit

This is the historical P61 audit. The 2026-10-02 owner decisions replace its earlier opponent-field rules. The P68 review is in [the overlay work review](2026-10-01-multi-seat-wip-review.md). Its counts apply only to the stated tests and core. The CSV and JSON files preserve the original scan evidence.

Audit dates: 2026-10-01 to 2026-10-02. The engine is the real P61 Standard Multi or Domain Multi core. The card scripts and card database come from `data/duel-engine-next`. No live data was used.

## Scope and result

The first scan found 585 literal `PLAYER_ALL` lines: 518 stock lines and 67 overlay lines. After the repairs, the current scan has 588 lines: 518 stock lines and 70 overlay lines. The complete ranked list is [multi-seat-player-all-hits.csv](2026-10-01-multi-seat-player-all-hits.csv). Each row gives the exact source file, line, card, function, allowed formats, active status, API verdict, effect verdict and evidence. The scan includes helpers. Stock cards with no database entry, cards forbidden in all multiplayer formats, comments and replaced stock functions are marked as excluded. Cards forbidden only in FFA retain their legal Tag rows.

The current counts are 257 active lines, 248 lines for cards absent from the database, 72 replaced stock lines, eight comments and three lines forbidden in all multiplayer formats. The list distinguishes a valid operation-info call from a correct card outcome. A valid `PLAYER_ALL` value does not make a two-player damage, draw, choice or summon operation correct.

All 42 allowed stock cards with active `PLAYER_ALL` damage/recovery metadata have real card-outcome tests. These tests include 32 each-player or affected-controller cards and ten selected-player or duel-style pair cards. Mecha-Dog Marron has a separate PLAYER_ALL branch and is also tested. Five overlay-only LP cards, eight saved-controller LP cards and Blazing Mirror Force have additional live tests. The seven saved-controller defects and the Greed defect were found by those extra tests.

The final audit set passed 282 tests on each preserved P61 core: 281 real-duel cases and one existing source check. It includes the LP cases, revival cases, returned-owner discards, the API boundary and the existing each-opponent and Rebirth checks. Every rule case checks every seat. Tag cases include both teams and a partner with cards in hand. The separate audit reports below cover other effect branches and cards.

## Exact API boundary

`SetOperationInfo` rejects a nonnil Card/Group with `PLAYER_ALL` only when the category is exactly `CATEGORY_SPECIAL_SUMMON` and the actual group size is not two. The count argument does not replace the actual group size. Nil and numeric zero have no group object. A non-special-summon category and a combined category do not enter this exact-category check. `SetPossibleOperationInfo` has no such group-size check.

Live proof: [player-all-operation-info.test.ts](../../packages/duel-server/tests/scenarios/multiplayer/player-all-operation-info.test.ts), 27/27 on each core. A real card activation creates each of nine cases in FFA3, FFA4 and Tag. Accepted cases complete the draw and check every seat. Rejected cases prove the actual engine error `group size wasn't exactly 2`.

| Real operation-info case | Result in FFA3, FFA4 and Tag |
| --- | --- |
| Exact Special Summon, nil group | ACCEPT |
| Exact Special Summon, numeric-zero group | ACCEPT |
| Exact Special Summon, one-card group | REJECT |
| Exact Special Summon, two-card group | ACCEPT |
| Exact Special Summon, three-card group | REJECT |
| Exact Special Summon, four-card group | REJECT |
| Destroy, three-card group | ACCEPT |
| Special Summon plus Destroy, three-card group | ACCEPT |
| Possible Special Summon, three-card group | ACCEPT |

The three revival overlays keep a `#g==2` guard for a nonnil exact-Special-Summon group with PLAYER_ALL. Different Dimension Encounter uses nil. Bone Temple Block chooses exactly two targets; its metadata is accepted. A nil summon group on another card is not an API defect. Its summon operation still needs its own outcome check.

## Ranked defects proved in this audit

FAIL means the required card outcome failed on the original stock script or original overlay. PASS means that the tested action had the required outcome. It does not prove all effects and timings of a card. The final suffixes pass the permanent cases on both cores.

| Rank | Card | Original FFA3/FFA4 | Original Tag | Cause and smallest repair |
| ---: | --- | --- | --- | --- |
| 1 | 94667532 Mecha-Dog Marron | FAIL / FAIL | FAIL under final Q3; first repair also FAIL | The stock LP operation reaches only folded 0 and 1. Visit every living duelist. Q3 applies 1000 to each Tag member, so each team loses 2000. |
| 2 | 21501961 Pair Bear Scare!! | FAIL / FAIL | FAIL, both teams | The reveal branch recovers for only two folded players. Keep the picked opponent's reveal, then recover 2000 for every living duelist. |
| 3 | 18654201 Criosphinx | FAIL / FAIL | FAIL | A two-bit owner mask and folded discard recipient omit or merge returned owners. Store a real-seat owner mask and discard once for each affected real owner. |
| 4 | 43434803 The Shallow Grave | PASS / PASS | FAIL | Own-side selection includes partner GY cards, but the summon loop skips the partner. Select and summon once in each real duelist scope. |
| 5 | 84136000 The Grave of Enkindling | PASS / PASS | FAIL | Same missing-partner and shared-GY selection defect after real battle destruction. Retain the PLAYER_ALL group guard. |
| 6 | 39900763 Different Dimension Encounter | PASS / PASS | FAIL | Same missing-partner defect for banished cards. Use each real duelist's choices and field. Nil PLAYER_ALL metadata remains valid. |
| 7 | 47233801 Dark Snake Syndrome | PASS / PASS | FAIL, both teams | Folded own-Standby condition also accepts the partner's turn. Use MPTurnOwns; retain Q3 damage once per living duelist. |
| 8 | 30270176 Crimson Nova | PASS / PASS | FAIL, both teams | Folded own-End-Phase condition also accepts the partner's turn. Use MPTurnOwns; retain Q3 damage once per living duelist. |
| 9 | 89405199 Greed | PASS / PASS | FAIL, both teams | Shared Tag S/T queries see the same Greed twice. A local seen-card set makes each Greed record a draw event once. |
| 10 | 62472614 Pestilence | FAIL / FAIL | FAIL, both teams | Saved folded target controller needs a bind. The folded Standby condition also fires on the partner turn. Bind the equip target for target information and damage; use MPTurnOwns. |
| 11 | 20765952 Mask of Dispel | FAIL / FAIL | FAIL, both teams | Same defects for the stored face-up Spell target. Preserve that target and bind its real controller. |
| 12 | 56948373 Mask of the Accursed | FAIL / FAIL | FAIL, both teams | Same equip-controller defects. Copy its stock initial_effect to replace the anonymous phase condition with the named corrected condition. |
| 13 | 83584898 Darkworld Shackles | FAIL / FAIL | FAIL, both teams | Same equip-controller and partner-Standby defects. Wrap stock target/operation so their other checks stay in place. |
| 14 | 19578592 Axe of Fools | FAIL / FAIL | FAIL, both teams | Same equip-controller and partner-Standby defects. Wrap stock target/operation. |
| 15 | 81385346 Stamping Destruction | FAIL / FAIL | PASS, both teams | Resolution asks for an opponent after its selected Spell/Trap is destroyed. Bind the selected target controller before destruction and the 500 damage. |
| 16 | 13574687 Turbo Cannon | FAIL / FAIL | PASS, both teams | Folded damage metadata asks for another opponent before the selected monster is destroyed. Bind the target's controller in the metadata and through destruction/damage. |

These are three independent operation patterns: each-duelist actions, real-controller actions and exact own-duelist turn conditions. Greed is a separate repeated-observer defect. No production core change was needed for these fixes. Spear Cretin (58551308) belongs to the external agent; its suffix and permanent tests were not changed by this audit.

## Required full scenarios and original results

[each-duelist-revival.ts](../../packages/duel-server/tests/scenarios/multiplayer/each-duelist-revival.ts) has 12 cases. Each duelist has two valid cards and receives its own selection prompt. The Grave of Enkindling uses actual battle destruction. Before the repair, all six Tag cases fail. After the repair, all 12 cases pass. Six existing each-opponent cases also pass.

[mecha-dog-marron.ts](../../packages/duel-server/tests/scenarios/multiplayer/mecha-dog-marron.ts) destroys Marron in DEF by battle. FFA requires 7000 LP at every seat. Tag requires 14000 at every seat view. The first team-deduplicated suffix gives 15000, so both corrected Tag cases fail it. All four corrected cases pass.

[criosphinx.ts](../../packages/duel-server/tests/scenarios/multiplayer/criosphinx.ts) uses a real Penguin Soldier flip and two returned monsters with different owners. Every affected owner must discard from its own hand. All six original cases fail; all six corrected cases pass.

Dark Snake Syndrome is activated, then play passes through two complete rounds. Its own Standby damage is 200 then 400: FFA ends at 7400 and Tag at 14800 per pool. The original Tag condition adds partner turns and ends at 10000. Crimson Nova passes through its own End Phase and its partner's End Phase. It must burn once, for 6000 per Tag pool, leaving 10000. The original condition burns twice and leaves 4000.

Pair Bear Scare!! picks one opponent, who reveals a real Deck copy. All FFA duelists must recover 2000; all Tag members recover 2000, which gives 4000 per team. The expected final LP is 10000 in FFA and 20000 in Tag. The test checks the actual resolved GY/Deck state. It does not claim that the card's separate return-to-opponent-hand trigger was proved.

[player-all-overlay-lp.ts](../../packages/duel-server/tests/scenarios/multiplayer/player-all-overlay-lp.ts) has 20 cases. Greed observes a real Pot of Greed draw of two, then applies 1000 at End Phase to that drawing side. Original Tag gives 2000, leaving 14000 instead of 15000; original FFA passes. The repaired 20-case matrix passes. Amabie recovers 300 per living duelist, including 600 per Tag pool. Cracking observes real effect destruction on every field and damages each affected side once. Meklord Asterisk observes a real Synchro Summon. Morale Boost checks the Equip Spell controller's 1000 recovery and later 1000 damage; the equipped monster's controller is a different seat.

[local-controller-lp.ts](../../packages/duel-server/tests/scenarios/multiplayer/local-controller-lp.ts) has 36 cases. The five Standby cards select a later opponent's real monster or Spell, with another target available. One complete round passes through both Tag partners. FFA must damage only the real target seat by 500; Tag must damage that target team once by 500. Original FFA leaves that seat at 8000, and original Tag leaves its team at 15000 instead of 15500. The repaired targets end at 7500 or 15500. Stamping Destruction selects a later-seat Supply Squad and must destroy it, send itself to the GY and damage that same seat by 500. Turbo Cannon selects a later-seat Luster Dragon and must destroy it and damage that same seat by 950. The original FFA script stops for a second opponent choice; the required final board is absent. The suffix uses the already known controller and completes the required board.

Two controls need no suffix. Ghost Mourner & Moonlit Chill (52038441) responds to a later opponent's real Monster Reborn. It negates the summoned Beaver Warrior; that opponent then uses Dark Hole. The leaving monster's previous controller takes 1200. Blazing Mirror Force (75249652) responds to an actual attack. It destroys Attack Position monsters across all opponent fields. In FFA3 it destroys 1700+1900 ATK and damages actor and attacking opponent by 1800 each; the other LP total stays unchanged. In FFA4 it also destroys a 1200 ATK monster and damages the same pair by 2400 each. Tag damages each team by 1800 once. Both controls pass all four cases on each core.

## Complete LP inventory

The tables below refer to active stock metadata in the original scan. The resolving operation can come from an existing suffix. Each linked file plays the actual card through the stated trigger and checks the final state of every seat. All listed cases pass on both P61 cores. Uniform each-player LP actions execute once per living duelist; therefore each Tag pool receives two equal actions. Event masks and aggregate effect-draw counts execute once per affected side.

| Code and card | Resolving action proof | Format coverage |
| --- | --- | --- |
| 3064425 Superheavy Samurai Soulbang Cannon | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 4807253 Performage Flame Eater | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 6783559 Self-Destruct Ant | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 6909330 Soul Binding Gate | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 7852509 Loop of Destruction | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 12694768 Abaki | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 14989021 Simorgh, Bird of Divinity | [each-player-lp-amounts](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-amounts.ts) | FFA3, FFA4, Tag p0 and p1 |
| 18271561 Chthonian Blast | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 20686759 Morphtronic Rusty Engine | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 20985997 Detonator Circle "A" | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 21219755 Destruction Ring | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 21501961 Pair Bear Scare!! | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 26273196 Time Wizard of Tomorrow | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 29599813 Purrely Pretty Memory | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 29716911 Capacitor Stalker | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 30270176 Crimson Nova the Dark Cubic Lord | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 31353051 Exploderokket Dragon | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 34004470 The Big Saturn | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 34449261 Fusion Fright Waltz | [each-player-lp-amounts](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-amounts.ts) | FFA3, FFA4, Tag p0 and p1 |
| 35842855 Pyrorex the Elemental Lord | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 37780349 Destiny HERO - Dynatag | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 39767432 Sorcerer of Sebek | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 46089249 Koa'ki Ring | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 46918794 Tremendous Fire | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 47233801 Dark Snake Syndrome | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 49407319 Star Mine | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 58071123 Oxygeddon | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 63378869 Aiza the Dragoness of Deranged Devotion | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 65430834 Jurassic Impact | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 66719324 Rain of Mercy | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 71782404 Red-Eyes Burn | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 73507661 Fairy Wind | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |
| 75797046 Photon Alexandra Queen | [each-player-lp-amounts](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-amounts.ts) | FFA3, FFA4, Tag p0 and p1 |
| 76004142 Bad Luck Blast | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 81143465 Tragic Twin Twined Jewels | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 83555666 Ring of Destruction | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | Tag p0 and p1; FFA forbidden |
| 83819309 Cooling Embers | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 83888009 Rebirth of the Seventh Emperors | [rebirth-emperors](../../packages/duel-server/tests/scenarios/multiplayer/rebirth-emperors.ts) | FFA3/FFA4 later actors and eliminated-seat cases; Tag p0/p3 |
| 86209650 Stray Asmodian | [each-player-lp-simple](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-simple.ts) | FFA3, FFA4, Tag p0 and p1 |
| 89693655 Subspace Battle | [player-all-lp-pairs](../../packages/duel-server/tests/scenarios/multiplayer/player-all-lp-pairs.ts) | FFA3, FFA4, Tag p0 and p1 |
| 89719143 Final Fusion | [each-player-lp-responses](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-responses.ts) | FFA3, FFA4, Tag p0 and p1 |
| 93469007 Assault Overload | [each-player-lp-triggers](../../packages/duel-server/tests/scenarios/multiplayer/each-player-lp-triggers.ts) | FFA3, FFA4, Tag p0 and p1 |

The ten pair/selected-player cards are Time Wizard of Tomorrow, Tremendous Fire, Star Mine, Jurassic Impact, Soul Binding Gate, Bad Luck Blast, Tragic Twin Twined Jewels, Ring of Destruction, Cooling Embers and Subspace Battle. Their PLAYER_ALL metadata is accepted. Their actual text or branch uses self, one selected player, or one duel-style opponent. The 38 permanent cases prove that the other FFA LP totals stay unchanged; Ring is tested only in legal Tag. This classification is not used for a uniform “each player” operation.

Branch limits are explicit. Time Wizard tests the failed coin call and self damage. Star Mine tests its destruction trigger. Cooling Embers tests the chosen opponent's recovery branch. Fusion Fright Waltz tests one affected controller's destruction group. Soul Binding Gate starts face-up and proves the real summon/destruction trigger, not its activation condition. Bad Luck Blast tests the target and damage recipient as the same opponent; it does not prove a mixed-target/damage-recipient interpretation. Pair Bear's separate return-hand trigger is not part of its recovery proof. A passing branch is not a proof of the other branches.

## Other active hits and explicit limits

The CSV gives a separate verdict for every remaining active line. A `LIMITATION` row has no full effect outcome in this audit. It is not called safe merely because its metadata is accepted or because a test has a matching card tag. Existing scenario-file names in that row are leads for further checks, not proof that the exact function was executed. Helper and constant rows have no independent card outcome; their callers need a card test.

The original active special-summon metadata has 22 literal rows. Four nonnil group sites were the guarded Shallow Grave, Grave of Enkindling and Spear Cretin overlays, and stock Bone Temple Block's exact two targets. Different Dimension Encounter, Magician's Circle, Over Limit, Demiurge Ema, Gouki Destroy Ogre, Pinpoint Dash and Blooming of the Darkest Rose use nil/zero groups. The other Special Summon rows use SetPossibleOperationInfo. The CSV records the exact current source status. The 27 API cases prove the gate; only the linked actual-card cases prove the card action.

The response conditions, field-environment tests, persistent/equip helpers and PLAYER_ALL hint calls do not pass a nonnil summon group to SetOperationInfo. They are not group-size defects. Their separate card behavior is not certified by this fact.

Use these reports for the disjoint scopes:

- [Main live script audit](2026-10-01-multi-seat-script-audit.md): owner field returns, Black Dragon Ninja, Combination Attack, Hydor and the other parent-owned repairs.
- [All hand, Deck and Extra Deck hit list](2026-10-01-multi-seat-zone-hit-list.md): global zone actions, count comparisons and selected-opponent pair actions. Its pending static rows remain limits until live evidence is recorded there.
- [Global state and direct recipient hit list](2026-10-01-multi-seat-global-hit-list.md): global flags, direct controller/owner calls and their actual outcomes.

Materialization's transferred-Tag-owner branch remains with the parent and the real-owner API work. No row in this report claims that this unfinished branch is repaired on P61. Spear Cretin's production suffix and tests are owned by the external agent.

## Commands and preserved engine identity

The final 13-file set is:

```text
each-duelist-revival.test.ts
mecha-dog-marron.test.ts
criosphinx.test.ts
each-player-lp-simple.test.ts
each-player-lp-triggers.test.ts
each-player-lp-responses.test.ts
each-player-lp-amounts.test.ts
player-all-lp-pairs.test.ts
player-all-overlay-lp.test.ts
local-controller-lp.test.ts
player-all-operation-info.test.ts
rebirth-emperors.test.ts
each-opponent.test.ts
```

From `packages/duel-server`, run the chosen file set with an absolute preserved core path:

```bash
prlimit --core=1:1 env \
  DUEL_DATA_DIR="$PWD/../../data/duel-engine-next" \
  DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
  NSEAT_WASM="$PWD/domain-core/.build/phase1/gap-overlay/root/p61-standard.wasm" \
  npx vitest run tests/scenarios/multiplayer/local-controller-lp.test.ts --maxWorkers=1
```

For Domain, replace `p61-standard.wasm` with `p61-domain.wasm`. The final set used a private overlay copy via `DUEL_MULTI_SCRIPTS_DIR`. That copy had the exact suffix texts under test and its own manifest. It avoided another agent's temporary manifest gap. No production manifest or generator was changed by this audit.

- Standard P61 SHA-256: `d60c3bb842036e1b6b81ad0d9ffc1c262ace42414087743b23805caa44abf679`.
- Domain P61 SHA-256: `81f6248e65107fa378c1c8da9c1e0dc6d5350031f470f210731602dd6229a717`.

The final results were 282/282 Standard and 282/282 Domain. Before repair, the saved-controller plus Greed Domain set had 26 failures and 30 passes across 56 real cases. The 24 failures were five Standby cards in all four cases, plus Stamping Destruction and Turbo Cannon in FFA3/FFA4. The two Greed failures were both Tag teams. The corrected 56 cases pass on both cores.

A later concurrent host edit added an FFA first-turn draw flag. It was not part of those validated runs and it changes existing fixture hand counts. New fixture failures caused only by that host edit are not counted as card-script defects. The preserved core hashes alone cannot freeze TypeScript host behavior; a replay must use the same host rules as the validated runs.

The suffix loader runs only for more than two duelists. The stock 1v1 scripts remain the source for two duelists. The separate all-zone audit has real 1v1 controls; this LP matrix does not claim a new 1v1 card proof merely from the loader guard.

## Saved local recipient call sites

These eight stock functions are the unit-specific LP subset of the broader saved-local scan. Same-named variables in other functions and the handler's own folded tp are excluded. The first seven need a suffix; Ghost Mourner's event scope already fixes the tested previous controller.

| Card | Exact stock function and line | Suffix functions |
| --- | --- | --- |
| 62472614 Pestilence | s.damop, [c62472614.lua:35](../../data/duel-engine-next/card-scripts/official/c62472614.lua#L35) | damcon, damtg, damop |
| 20765952 Mask of Dispel | s.damop, [c20765952.lua:63](../../data/duel-engine-next/card-scripts/official/c20765952.lua#L63) | damcon, damtg, damop |
| 81385346 Stamping Destruction | s.activate, [c81385346.lua:29](../../data/duel-engine-next/card-scripts/official/c81385346.lua#L29) | activate |
| 56948373 Mask of the Accursed | s.damop, [c56948373.lua:32](../../data/duel-engine-next/card-scripts/official/c56948373.lua#L32) | initial_effect, damcon, damtg, damop |
| 83584898 Darkworld Shackles | s.damop, [c83584898.lua:44](../../data/duel-engine-next/card-scripts/official/c83584898.lua#L44) | damcon, damtg, damop |
| 13574687 Turbo Cannon | s.operation, [c13574687.lua:30](../../data/duel-engine-next/card-scripts/official/c13574687.lua#L30) | target, operation |
| 52038441 Ghost Mourner & Moonlit Chill | s.leaveop, [c52038441.lua:86](../../data/duel-engine-next/card-scripts/official/c52038441.lua#L86) | none |
| 19578592 Axe of Fools | s.damop, [c19578592.lua:40](../../data/duel-engine-next/card-scripts/official/c19578592.lua#L40) | damcon, damtg, damop |
