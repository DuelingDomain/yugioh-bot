# Multiplayer card scenarios and forbidden list

Date: 2026-09-30. Updated 2026-10-01 with the card decisions of the product owner and with his answers to the ten triage questions (rules 8 to 11 below). Status: accepted.

Rules: [ADR-0002](../adr/0002-multiplayer-duel-rules.md). Design: [multiplayer core design](2026-09-30-multiplayer-core-design.md).

Data in code:
- P3 Dogmatikamatrix proofs declare before the opponent Extra Deck read and check every seat.
- P3 Branded in Central Dogmatika proofs declare before the opponent Extra Deck read and check every seat.
- Forbidden list and card rules: `packages/duel-server/src/banlists/multiplayer.ts` (`MULTIPLAYER_FORBIDDEN` and `MULTIPLAYER_CARD_RULES`).
- Scenario sketches and script evidence: `packages/duel-server/tests/scenarios/multiplayer/catalog.ts`.
- Check test: `packages/duel-server/tests/scenarios/multiplayer/catalog.test.ts`. It reads every cited line of every script.
- Compare proof: `compare.ts` checks that Raigeki makes a new declaration after Evenly Matched.
- Thundercross proof: `compare.ts` passes the earlier End, Draw and Standby Phase windows, then activates in response to the Normal Summon. Every seat is checked.
- Deck check: `inspectDeck(mode, deck, dir, settings, { table })` in `packages/duel-server/src/deck-legality.ts`. The default table is `"1v1"` and changes nothing.

This page tables are made from the catalog data. Change the data first, then change this page.

## How to read the tables

- **Script evidence**: `cNNN.lua:line` in `data/duel-engine-next/card-scripts/official/`. A line was read and checked for each item.
- **Tables**: 3-FFA (3 players, 8,000 LP each), 4-FFA (4 players, 8,000 LP each), Tag (2v2, shared 16,000 LP, seats P0+P2 against P1+P3).
- **Rule class**: U = unchanged (the script works with the union or the bound opponent with no new rule). C = core rule (a rule in the core makes the script work). O = per-card override (the script needs a patch).
- **Layer 1 sketch**: setup, action and expected result. Seat P0 is the activator. A sketch is data. When a live scenario already proves the card on the real core, the sketch shows as a test in `catalog.test.ts` (list `LIVE_PROOF` in `catalog.ts`). The other sketches stay `todo`.

## Rules that decide the edge cases

These rules come from ADR-0002 and spec section 4.2.

1. **Partner in "each player" and "all" effects.** In Tag, "each player", "all monsters" and other both-sides effects include the partner and the activator. Dark Hole destroys the monsters of the partner. A partner is never "your opponent". "You control" and "your field" include the partner. Hand and Deck stay individual.
2. **Field, GY and banish.** "Opponent" means ALL opponents (union). The card picks from the union of their cards. Exception: count and compare cards use rule 8.
3. **Hand, Deck, Extra Deck, draw and LP.** The activator picks ONE opponent. The pick is the binding. Binding order: explicit pick, then event opponent, then a prompt on the first single-opponent access, then op-info, then the resolution fallback.
4. **Hand and Deck single-pick.** After the pick, `1-tp` means that opponent for hand, Deck, Extra Deck, draw, damage, recover, `SetLP` and `GetLP`. `ConfirmCards(1-tp)` shows the cards to all opponents. `Select*(1-tp)` makes the bound opponent choose (rule 9).
5. **Control of a partner card.** A card under the control of the partner counts as "you control". A summon or a control change to `1-tp` goes to the field of the bound opponent, or to the field of the controller of the target.
6. **Elimination in the middle of a chain.** The cards of an eliminated duelist leave the game. Their chain links resolve with no effect. The chain order is the turn player first, then clockwise.
7. **Negation and the partner (product owner, 2026-09-30).** A card that negates an activation, an effect or a summon (Solemn Judgment, Solemn Warning, Solemn Strike, Ash Blossom, Magic Jammer, Stardust Dragon and similar cards) cannot negate the partner's in Tag. In FFA it can negate any duelist. At all tables it can negate the own activation or summon, as in 1v1. A core rule enforces this for every card with a negate category and a chaining or summon event (spec 1.3, requirement 3). About 260 scripts have no player check and depend on it. Continuous negation and lock effects (Jinzo and similar) affect every duelist, the partner included (rule 1, product owner 2026-09-30).
8. **Count and compare cards (owner answer to triage question 2, 2026-10-01).** A card that compares field, hand or card counts ("your opponent controls more ...", Evenly Matched, Pineapple Blast, about 50 cards) does not add all opponents together. In FFA the activator picks ONE opponent when they activate it, and the card compares with that opponent only. In Tag the card compares with the combined field or hand of the two opposing duelists.
9. **One opponent chooses (owner answer to triage question 5, 2026-10-01).** When the card says "your opponent chooses" in the singular, ONE opponent chooses: the picked (bound) opponent, in FFA and in Tag. All opponents choose only when the card text says "all" or "each". This replaces the old proposal "each affected opponent chooses from their own cards".
10. **Tribute of an opponent monster (owner answer to triage question 8, 2026-10-01).** A Tribute of a monster of an opponent works for the monsters of any opponent, not only seat 1. This includes the Kaiju, Lava Golem and The Winged Dragon of Ra - Sphere Mode. For Ra Sphere Mode, all Tributed monsters come from ONE opponent, and it goes to the field of that opponent.
11. **Turn count (owner answer to triage question 1, 2026-10-01).** Every turn of any opponent counts as one opponent turn (in Tag, only a turn of the two opposing duelists). The turn-count review found no card to ban. The 5 free-for-all turn-count bans in group (c) stay.

## Corpus counts

Method: count of files in `data/duel-engine-next/card-scripts/official/` (13,541 scripts) that match the pattern. Command:
`LC_ALL=C /usr/bin/grep -l -E '<pattern>' official/*.lua | wc -l`. The plain `grep` is an alias of ugrep here, so use `/usr/bin/grep`.

| Risk | Pattern | Files |
|---|---|---|
| Both players in one effect | `PLAYER_ALL` | 226 |
| Alternative win | `Duel\.Win\(` | 20 (25 hits) |
| Global state tables | `GlobalCheck` | 207 |
| Opponent chooses | `Select[A-Za-z]*\(1-tp` | 250 |
| Summon to the opponent field | `SpecialSummon[A-Za-z]*\([^)]*1-tp` | 142 |
| Swap of control | `SwapControl` | 19 |
| Control change | `GetControl\(` | 159 |
| Counted opponent turn | `RESET_OPPO_TURN` | 113 |
| Own turn reset | `RESET_SELF_TURN` | 148 |
| Either turn reset | `RESET_OPPO_TURN\|RESET_SELF_TURN` | 254 |
| Turn counter | `GetTurnCount` | 275 |
| Opponent turn test | `IsTurnPlayer\(1-tp\)` | 500 |
| Turn player read | `Duel\.GetTurnPlayer\(\)` | 245 |
| Skip turn | `EFFECT_SKIP_TURN` | 5 |
| Skip phase | `Duel\.SkipPhase` | 57 |
| Swap Deck and GY | `SwapDeckAndGrave` | 1 |
| Set LP | `Duel\.SetLP\(` | 83 |
| Set LP of the opponent | `Duel\.SetLP\(1-tp` | 25 |
| Read LP of the opponent | `Duel\.GetLP\(1-tp\)` | 97 |
| Damage to the opponent | `Duel\.Damage\(1-tp` | 365 |
| Opponent draws | `Duel\.Draw\(1-tp` | 53 |
| Opponent can draw | `IsPlayerCanDraw\(1-tp` | 59 |
| Cannot draw | `EFFECT_CANNOT_DRAW` | 10 |
| Opponent Deck top | `ConfirmDecktop\(1-tp` | 21 |
| Name a card | `AnnounceCard` | 31 |
| Owner read | `GetOwner\(\)` | 311 |
| Cannot summon | `EFFECT_CANNOT_SUMMON` | 135 |
| Extra attack | `EFFECT_EXTRA_ATTACK` | 215 |
| Attack all | `EFFECT_ATTACK_ALL` | 43 |
| Direct attack | `EFFECT_DIRECT_ATTACK` | 196 |
| Change damage | `EFFECT_CHANGE_DAMAGE` | 89 |
| Loop over two players | `for [a-z_]+ ?= ?0, ?1 do` | 15 |
| Both hands in one query | `LOCATION_HAND, ?LOCATION_HAND` | 24 |
| Both Decks in one query | `LOCATION_DECK, ?LOCATION_DECK` | 13 |
| Swap hand | `SwapHand` | 0 |
| Exile | `Duel\.Exile` | 0 |
| Turn id | `turn_id` | 0 |

Notes on the counts:
- Most `PLAYER_ALL` hits are only in `SetOperationInfo`. Only 16 files use it with no operation info. It is a weak signal.
- The spec (section 1.3) gives 125 for the opponent-chooser pattern and 123 for the summon pattern. The broad patterns above give 250 and 142. To get close to 125, use `SelectMatchingCard\(1-tp`. The spec pattern is narrower. The owner should say which one is the baseline.
- These counts show the size of the risk. They are not the forbidden list. The list below is short on purpose, because it is a product tool.

## Group (a): the effect touches ALL opponents

Binding: field, GY and banish use the union of the opponents. There is no pick.

| Card | Passcode | Script evidence | 1v1 behavior | 3-FFA | 4-FFA | 2v2 Tag | Class |
|---|---|---|---|---|---|---|---|
| Raigeki | 12580477 | `c12580477.lua:16`, `c12580477.lua:20` | Destroys all monsters of the opponent. | Destroys the monsters of both opponents. | Destroys the monsters of all 3 opponents. | Destroys the monsters of both opposing team members. The partner keeps its monsters. | U |
| Harpie's Feather Duster | 18144506 | `c18144506.lua:19`, `c18144506.lua:24` | Destroys all Spells and Traps of the opponent. | Destroys the Spells and Traps of both opponents. | Destroys the Spells and Traps of all 3 opponents. | Destroys the Spells and Traps of both opposing team members. The partner is safe. | U |
| Dark Hole | 53129443 | `c53129443.lua:15`, `c53129443.lua:20` | Destroys all monsters on the field. | Destroys all monsters of all 3 players. | Destroys all monsters of all 4 players. | Destroys all monsters of all 4 players, the partner and the activator included (ADR-0002, 'all' effects). | U |
| Heavy Storm | 19613556 | `c19613556.lua:19`, `c19613556.lua:24` | Destroys all Spells and Traps on the field. | Destroys the Spells and Traps of all 3 players. | Destroys the Spells and Traps of all 4 players. | Destroys the Spells and Traps of all 4 players, the partner included. | U |
| Giant Trunade | 42703248 | `c42703248.lua:19`, `c42703248.lua:24` | Returns all Spells and Traps on the field to the hand. | Returns the Spells and Traps of all 3 players. | Returns the Spells and Traps of all 4 players. | Returns the Spells and Traps of all 4 players, the partner included. | U |
| Mirror Force | 44095762 | `c44095762.lua:16`, `c44095762.lua:27` | When an opponent monster attacks, destroys all attack position monsters of the opponent. | When any opponent attacks, destroys the attack position monsters of both opponents. | When any opponent attacks, destroys the attack position monsters of all 3 opponents. | When an opposing monster attacks, destroys the attack position monsters of both opposing members. The partner is safe. | C |
| Torrential Tribute | 53582587 | `c53582587.lua:29`, `c53582587.lua:34` | When a monster is Summoned, destroys all monsters on the field. | Destroys all monsters of all 3 players. | Destroys all monsters of all 4 players. | Destroys all monsters of all 4 players, the partner included. | U |
| Dark Magic Attack | 2314238 | `c2314238.lua:17`, `c2314238.lua:24`, `c2314238.lua:29` | If you control Dark Magician, destroys all Spells and Traps of the opponent. | Destroys the Spells and Traps of both opponents. | Destroys the Spells and Traps of all 3 opponents. | Destroys the Spells and Traps of both opposing members. The condition counts Dark Magician of the partner (you control includes the partner). | U |
| Lightning Storm | 14532163 | `c14532163.lua:18`, `c14532163.lua:21`, `c14532163.lua:39` | If you control no face-up cards, choose: destroy all Attack Position monsters or all Spells and Traps of the opponent. | Destroys the chosen card type of both opponents. | Destroys the chosen card type of all 3 opponents. | Destroys the chosen card type of both opposing members. The condition checks the own field, which includes the partner. | U |
| Book of Eclipse | 35480699 | `c35480699.lua:17`, `c35480699.lua:38`, `c35480699.lua:40` | Changes all face-up monsters to face-down. In the End Phase, the opponent flips its face-down monsters and draws one card for each. | The initial flip affects every seat. The End Phase flip and draw affect only the opponent declared at activation. | Same as 3-FFA. | The initial flip affects every seat. Each opposing member flips and draws for its own monsters in the End Phase. | O |
| Cyber Dragon | 70095154 | `c70095154.lua:16`, `c70095154.lua:17` | If only the opponent controls a monster, you can Special Summon this card from the hand. | Legal when P0 controls no monster and any opponent controls one. | Legal when P0 controls no monster and any opponent controls one. | Legal when the team of P0 controls no monster and any opposing member controls one. | U |
| Gameciel, the Sea Turtle Kaiju | 55063751 | `c55063751.lua:5`, `cards_specific_functions.lua:347`, `cards_specific_functions.lua:362` | Tribute 1 monster of the opponent to Special Summon this card to their field. | The Kaiju goes to the field of the player whose monster was Tributed (owner decision 2026-10-01). | Same as 3-FFA. | Goes to the field of the player whose monster was Tributed (an opposing member). | O |
| Gravity Bind | 85742772 | `c85742772.lua:15` | Level 4 or higher monsters cannot attack. | No level 4 or higher monster on any of the 3 fields can attack. | No level 4 or higher monster on any of the 4 fields can attack. | No level 4 or higher monster on any field can attack. The partner is affected too. | U |
| Burden of the Mighty | 44947065 | `c44947065.lua:15`, `c44947065.lua:20` | Opponent monsters lose 100 ATK for each of their Levels. | The monsters of both opponents lose ATK. | The monsters of all 3 opponents lose ATK. | The monsters of both opposing members lose ATK. The partner monsters do not. | U |
| Skill Drain | 82732705 | `c82732705.lua:9`, `c82732705.lua:15` | Pay 1000 LP. Face-up monster effects on the field are negated. | Negates the monsters of all 3 players. | Negates the monsters of all 4 players. | Negates the monsters of all 4 players. The 1000 LP comes from the shared pool. | U |
| Lightning Vortex | 69162969 | `c69162969.lua:21`, `c69162969.lua:25` | Discard 1 card. Destroys all face-up monsters of the opponent. | Destroys all face-up monsters of both opponents. | Destroys all face-up monsters of all 3 opponents. | Destroys all face-up monsters of both opposing members. | U |
| Fissure | 66788016 | `c66788016.lua:15`, `c66788016.lua:16` | Destroys the face-up monster of the opponent with the lowest ATK. | Destroys the lowest ATK face-up monster among both opponents (ties: P0 picks). | Destroys the lowest ATK face-up monster among all 3 opponents. | Destroys the lowest ATK face-up monster among the opposing members. | U |
| Judgment Dragon | 57774843 | `c57774843.lua:58`, `c57774843.lua:62` | Pay 1000 LP to destroy all other cards on the field. | Destroys all other cards of all 3 players. | Destroys all other cards of all 4 players. | Destroys all other cards of all 4 players, the partner included. | U |
| Hammer Shot | 26412047 | `c26412047.lua:18`, `c26412047.lua:24` | Destroys the Attack Position monster with the highest ATK on the field. | Looks at all 3 fields. | Looks at all 4 fields. | Looks at all 4 fields. The monster of the partner can be the target. | U |
| Jinzo | 77585513 | `c77585513.lua:11` | Negates all Trap cards on the field, their effects and their activations. | Negates the Traps of all 3 players. | Negates the Traps of all 4 players. | Negates the Traps of all 4 players, the partner included. | U |
| Vanity's Emptiness | 5851097 | `c5851097.lua:17` | Neither player can Special Summon. | No player can Special Summon. | No player can Special Summon. | No player can Special Summon, the partner included. | U |
| Dimensional Fissure | 81674782 | `c81674782.lua:17`, `c81674782.lua:26` | Monsters that leave the field are banished instead. | Applies to all 3 players. | Applies to all 4 players. | Applies to all 4 players. | U |
| Macro Cosmos | 30241314 | `c30241314.lua:21` | Cards sent to the GY are banished instead. | Applies to all 3 players. | Applies to all 4 players. | Applies to all 4 players. | U |
| Imperial Iron Wall | 30459350 | `c30459350.lua:17`, `c30459350.lua:25` | Neither player can banish cards. | No player can banish cards. | No player can banish cards. | No player can banish cards. | U |
| Anti-Spell Fragrance | 58921041 | `c58921041.lua:16` | Spells must be Set first. A Spell cannot be activated the turn it is Set. | Applies to all 3 players. | Applies to all 4 players. | Applies to all 4 players. | U |
| Royal Decree | 51452091 | `c51452091.lua:16`, `c51452091.lua:31` | Negates all other Trap effects. | Negates the Traps of all 3 players. | Negates the Traps of all 4 players. | Negates the Traps of all 4 players. | U |
| Kycoo the Ghost Destroyer | 88240808 | `c88240808.lua:22`, `c88240808.lua:37` | Banishes up to 2 cards from the monster zone or GY of the opponent. | P0 picks up to 2 targets from the union of both opponent fields and GYs. | P0 picks up to 2 targets from the union of all 3 opponents. | P0 picks up to 2 targets from both opposing members. | U |
| Reinforcement of the Army | 32807846 | `c32807846.lua:26` | Adds a Warrior monster from the Deck to the hand and shows it to the opponent. | Shows the card to both opponents. | Shows the card to all 3 opponents. | Shows the card to both opposing members. The partner may see it by the team rule; the ADR leaves this to Layer 3. | U |
| Royal Tribute | 72405967 | `c72405967.lua:22` | If you control Necrovalley, both players discard any monsters in their hands. | Both opponents discard the monsters in their hand. P0 discards theirs too (owner decision 2026-10-01). | All 3 opponents discard the monsters in their hand. P0 discards theirs too. | Both opposing members discard the monsters in their hand. P0 discards theirs too. The partner discards too: 'both players' means every duelist, the partner included (R-COMMON-EACH-PLAYER, owner decision 2026-10-01). | O |

### Layer 1 sketches for group (a)

| Card | Setup | Action | Expected |
|---|---|---|---|
| Raigeki | P0 holds Raigeki. Each other seat controls one monster. In Tag, P2 (partner) controls one monster. | P0 activates Raigeki. | All opponent monsters go to the GY. The monster of the partner stays on the field. |
| Harpie's Feather Duster | Each other seat controls one set Spell. The partner (Tag) controls one set Spell. | P0 activates Harpie's Feather Duster. | All opponent Spells and Traps are destroyed. The partner Spell stays. |
| Dark Hole | Each seat controls one monster. | P0 activates Dark Hole. | All monsters, including the ones of P0 and the partner, go to the GY. |
| Heavy Storm | Each seat controls one Spell or Trap. | P0 activates Heavy Storm. | Every Spell and Trap other than Heavy Storm is destroyed. |
| Giant Trunade | Each seat controls one Spell or Trap. | P0 activates Giant Trunade. | Each card returns to the hand of its owner. |
| Mirror Force | P0 has Mirror Force set. P1 and P2 each control one attack position monster. P1 is the turn player. | P1 attacks. P0 activates Mirror Force. | The attack position monsters of P1 and P2 are destroyed. The trigger test uses the turn player, so it works for P1 and P2 alike (core rule: 'opponent turn' means any opponent). |
| Torrential Tribute | P0 has Torrential Tribute set. P1 controls one monster. P2 and P3 (or the partner) control one monster each. | P1 Normal Summons a monster. P0 activates Torrential Tribute. | All monsters on the field are destroyed. |
| Dark Magic Attack | Tag: the partner controls face-up Dark Magician and P0 controls none. All opponents control one Spell or Trap. | P0 activates Dark Magic Attack. | The activation is legal only in Tag through the partner. All opponent Spells and Traps are destroyed. |
| Lightning Storm | P0 controls no face-up card. Each opponent controls one attack position monster and one Spell. | P0 activates Lightning Storm and chooses the monster option. | Attack position monsters of all opponents are destroyed. Spells stay. |
| Book of Eclipse | Each seat controls one face-up monster. | P0 activates Book of Eclipse and declares one opponent in FFA. The turn ends. | All face-up monsters become face-down. In FFA, only the declared opponent flips and draws for its own monsters. In Tag, each opposing member flips and draws for its own monsters. |
| Cyber Dragon | P0 has Cyber Dragon in hand and no monster. Only P2 controls a monster. | P0 tries to Special Summon Cyber Dragon. | The summon is legal. In Tag, it is illegal if the partner controls a monster. |
| Gameciel, the Sea Turtle Kaiju | P1 and P2 control one monster each. P0 has Gameciel in hand. | P0 Tributes the monster of P2 to summon Gameciel. | Gameciel appears on the field of P2 (target-controller binding). The same rule holds for the other 6 Kaiju and the Lava cards (see "Card rules"). |
| Gravity Bind | Each seat controls one level 4 monster. P0 controls Gravity Bind. | Each seat tries to declare an attack on its turn. | No attack is possible for any seat. |
| Burden of the Mighty | Each other seat controls one level 4 monster with 1800 ATK. | P0 activates Burden of the Mighty. | Each opponent monster has 1400 ATK. The monster of the partner has 1800 ATK. |
| Skill Drain | Each seat controls one effect monster. P0 has Skill Drain set. | P0 activates Skill Drain. | The effect of each face-up monster is negated. LP of P0 drops by 1000 (Tag: team LP drops by 1000). |
| Lightning Vortex | Each other seat controls one face-up monster. | P0 discards a card and activates Lightning Vortex. | All opponent face-up monsters are destroyed. |
| Fissure | P1 controls a monster with 1500 ATK. P2 controls a monster with 1000 ATK. | P0 activates Fissure. | The monster of P2 is destroyed (lowest ATK in the union). |
| Judgment Dragon | Each seat controls one monster and one Spell. | P0 activates the effect of Judgment Dragon. | Every other card on the field goes to the GY. |
| Hammer Shot | P0 and P1 control monsters with 2000 and 2500 ATK. P3 controls one with 1800 ATK. | P0 activates Hammer Shot. | The monster with 2500 ATK is destroyed. |
| Jinzo | P1 has a Trap set. P0 controls Jinzo. | P1 tries to activate the Trap. | P1 cannot activate the Trap. The partner cannot activate a Trap either. |
| Vanity's Emptiness | P0 controls Vanity's Emptiness. | P1, P2 and P3 try to Special Summon. | All attempts are illegal. |
| Dimensional Fissure | P0 controls Dimensional Fissure. P3 controls one monster. | The monster of P3 is destroyed. | The monster is banished. |
| Macro Cosmos | P0 controls Macro Cosmos. P2 controls one monster. | The monster of P2 is destroyed. | The monster is banished. |
| Imperial Iron Wall | P0 controls Imperial Iron Wall. | P2 tries to banish a card. | The banish is illegal. |
| Anti-Spell Fragrance | P0 controls Anti-Spell Fragrance. P1 has a Spell in hand. | P1 tries to activate the Spell from the hand. | The activation is illegal. The player can Set it and activate it next turn. |
| Royal Decree | P0 controls Royal Decree. P1 activates a Trap. | P1 tries to activate a Trap. | The Trap effect is negated. |
| Kycoo the Ghost Destroyer | P1 has a card in the GY. P2 controls one monster. | P0 activates Kycoo and picks the GY card of P1 and the monster of P2. | Both targets are banished. The partner cards are not valid targets. |
| Reinforcement of the Army | P0 has a Warrior in the Deck. | P0 activates Reinforcement of the Army. | All opponents see the added card (ConfirmCards(1-tp) reaches all opponents). |
| Royal Tribute | P0 controls Necrovalley. Each other seat holds one monster and one Spell. | P0 activates Royal Tribute. | Every monster in every hand goes to the GY. The Spells stay in the hands. There is no opponent pick. |

## Group (b): the effect touches ONE opponent

Binding source (spec 4.2): **explicit pick** (the activator chooses one opponent), **event opponent** (the player who did the event), or **target controller** (the controller of the chosen card).

| Card | Passcode | Binding | Script evidence | 1v1 behavior | 3-FFA | 4-FFA | 2v2 Tag | Class |
|---|---|---|---|---|---|---|---|---|
| Mind Crush | 15800838 | explicit-pick | `c15800838.lua:16`, `c15800838.lua:26`, `c15800838.lua:30` | Name a card. If the opponent has it in hand, they discard all copies. If not, you discard 1 card at random. | P0 picks one opponent. Only that hand is read. | P0 picks one of 3 opponents. | P0 picks one opposing member. The partner hand is never read. | U |
| Snatch Steal | 45986603 | target-controller | `c45986603.lua:33`, `c45986603.lua:37`, `c45986603.lua:39` | Take control of a monster. The opponent recovers 1000 LP each Standby Phase. | The owner of the monster gains the LP, in the own Standby Phase of that owner (owner decision 2026-10-01). No other opponent gains LP. | Same as 3-FFA. | The owner of the monster (an opposing member) gains the LP, in the Standby Phase of the own duelist turn of that owner. The team LP gains. | O |
| Change of Heart | 4031928 | target-controller | `c4031928.lua:16`, `c4031928.lua:25` | Target 1 monster of the opponent. Take control until the End Phase. | P0 targets a monster of any opponent. Control returns to the original controller. | Same as 3-FFA. | P0 targets a monster of an opposing member. It moves to the field of P0. | C |
| Mind Control | 37520316 | target-controller | `c37520316.lua:16`, `c37520316.lua:25` | Target 1 monster of the opponent. Take control until the End Phase. It cannot attack. | P0 targets a monster of any opponent. | Same as 3-FFA. | P0 targets a monster of an opposing member. | C |
| Brain Control | 87910978 | target-controller | `c87910978.lua:23`, `c87910978.lua:29` | Pay 800 LP. Take control of a monster until the End Phase. | P0 targets a monster of any opponent. | Same as 3-FFA. | P0 targets a monster of an opposing member. The 800 LP comes from the shared pool. | C |
| Enemy Controller | 98045062 | target-controller | `c98045062.lua:60`, `c98045062.lua:73` | Change an opponent monster position, or Tribute 1 monster to take control of one. | P0 targets a monster of any opponent. | Same as 3-FFA. | P0 targets a monster of an opposing member. | C |
| Ookazi | 19523799 | explicit-pick | `c19523799.lua:17`, `c19523799.lua:18` | Inflicts 800 damage to the opponent. | P0 picks one opponent. Only that player takes damage. | P0 picks one of 3 opponents. | Damage to the shared LP of the opposing team. | U |
| Hinotama | 46130346 | explicit-pick | `c46130346.lua:17`, `c46130346.lua:18` | Inflicts 500 damage to the opponent. | P0 picks one opponent. | P0 picks one of 3 opponents. | Damage to the shared LP of the opposing team. | U |
| Final Flame | 73134081 | explicit-pick | `c73134081.lua:17`, `c73134081.lua:19` | Inflicts 600 damage to the opponent. Requires a Pyro monster. | P0 picks one opponent. | P0 picks one of 3 opponents. | Damage to the shared LP of the opposing team. | U |
| Thestalos the Firestorm Monarch | 26205777 | explicit-pick | `c26205777.lua:24`, `c26205777.lua:30` | When Tribute Summoned, the opponent discards 1 random card. Damage equals 100 times its Level. | P0 picks one opponent. Only that hand is used. | P0 picks one of 3 opponents. | P0 picks one opposing member. | U |
| Don Zaloog | 76922029 | event-opponent | `c76922029.lua:10`, `c76922029.lua:34`, `c76922029.lua:40` | When it damages the opponent by attack, choose: discard 1 random card, or send 2 cards from the Deck to the GY. | The player who took the damage is the target. | Same as 3-FFA. | The opposing member who took the damage. | U |
| Dark Bribe | 77538567 | event-opponent | `c77538567.lua:19`, `c77538567.lua:27`, `c77538567.lua:30` | Negate an opponent Spell or Trap. That opponent draws 1 card. | The player who activated the negated card draws. | Same as 3-FFA. | The opposing member who activated the card draws. | U |
| Soul Taker | 81510157 | target-controller | `c81510157.lua:22`, `c81510157.lua:30` | Destroy 1 monster of the opponent. The opponent gains 1000 LP. | The controller of the target gains 1000 LP. | Same as 3-FFA. | The shared LP of the opposing team gains 1000. | U |
| Sakuretsu Armor | 56120475 | event-opponent | `c56120475.lua:17` | When an opponent monster attacks, destroy the attacking monster. | Works against the attacker of any opponent. | Same as 3-FFA. | Works against an attacker of an opposing member. | C |
| Dimensional Prison | 70342110 | event-opponent | `c70342110.lua:17` | When an opponent monster attacks, banish the attacker. | Works against the attacker of any opponent. | Same as 3-FFA. | Works against an attacker of an opposing member. | C |
| Infinite Impermanence | 10045474 | target-controller | `c10045474.lua:24`, `c10045474.lua:28` | Negate the effects of 1 face-up monster of the opponent. | P0 targets a monster of any opponent. | Same as 3-FFA. | P0 targets a monster of an opposing member. | U |
| Dust Tornado | 60082869 | target-controller | `c60082869.lua:21`, `c60082869.lua:23` | Destroy 1 Spell or Trap of the opponent. You may Set 1 Spell or Trap from your hand. | P0 targets a card of any opponent. | Same as 3-FFA. | P0 targets a card of an opposing member. | U |
| Stop Defense | 63102017 | target-controller | `c63102017.lua:16`, `c63102017.lua:19` | Change 1 Defense Position monster of the opponent to Attack Position. | P0 targets a monster of any opponent. | Same as 3-FFA. | P0 targets a monster of an opposing member. | U |
| Effect Veiler | 97268402 | target-controller | `c97268402.lua:22`, `c97268402.lua:31` | During the opponent Main Phase, negate the effects of 1 face-up monster of the opponent. | Works in the Main Phase of any opponent. | Same as 3-FFA. | Works in the Main Phase of an opposing member. | C |
| Confiscation | 17375316 | explicit-pick | `c17375316.lua:11`, `c17375316.lua:17`, `c17375316.lua:23` | Pay 1000 LP. Look at the opponent hand and discard 1 card. | P0 picks one opponent. Only that hand is shown. | P0 picks one of 3 opponents. | P0 picks one opposing member. The LP cost is paid from the shared pool. | U |
| Delinquent Duo | 44763025 | explicit-pick | `c44763025.lua:11`, `c44763025.lua:25`, `c44763025.lua:30` | Pay 1000 LP. The opponent discards 1 random card and 1 card of their choice. | P0 picks one opponent. That player chooses the second discard. | P0 picks one of 3 opponents. | P0 picks one opposing member. | U |
| Monster Reborn | 83764718 | target-controller | `c83764718.lua:21`, `c83764718.lua:23`, `c83764718.lua:29` | Special Summon 1 monster from either GY. | P0 picks from the union of all GYs. No opponent pick. The monster goes to the field of P0. | Same as 3-FFA. | The union of all GYs. The monster goes to the field of P0 (Tag: P0 or the partner by the summon rules). | C |
| Maxx "C" | 23434538 | event-opponent | `c23434538.lua:48`, `c23434538.lua:52`, `c23434538.lua:67` | When the opponent Special Summons, draw 1 card for each summon. | Triggers on a summon by any opponent. P0 draws for himself. | Same as 3-FFA. | Triggers on a summon by an opposing member. A summon by the partner does not trigger it. | U |
| Ojama Trio | 29843091 | explicit-pick | `c29843091.lua:17`, `c29843091.lua:27`, `c29843091.lua:50` | Special Summon 3 Ojama Tokens to the field of the opponent. Damage 300 when each token leaves. | P0 picks one opponent. The tokens go to that field. The damage goes to the previous controller. | P0 picks one of 3 opponents. | P0 picks one opposing member. The tokens go to that field (3 empty zones). | O |
| Ash Blossom & Joyous Spring | 14558127 | event-opponent | `c14558127.lua:8`, `c14558127.lua:10`, `c14558127.lua:32` | Negates a card effect that searches, adds from the Deck or sends from the Deck. It can negate an effect of the owner. | Can negate an effect of any duelist, P0 included. The script has no check for the activating player. | Same as 3-FFA. | Cannot negate an effect of the partner (core rule, rule 7). Can negate an effect of an opposing member or of P0. | C |
| Solemn Judgment | 41420027 | event-opponent | `c41420027.lua:7`, `c41420027.lua:23`, `c41420027.lua:33`, `c41420027.lua:37`, `c41420027.lua:49` | Pay half your LP. Negate a summon, or the activation of a Spell or Trap Card, and destroy that card. It can negate a summon or activation of the owner. | Can negate a summon or activation of any duelist, P0 included. The script has no player check. | Same as 3-FFA. | Cannot negate a summon or activation of the partner (core rule, rule 7). Can negate one of an opposing member or of P0. The cost is half of the team LP. | C |
| Card of Safe Return | 57953380 | explicit-pick | `c57953380.lua:24`, `c57953380.lua:27` | If a monster is Special Summoned from your GY, draw 1 card. | Only for summons from the own GY. No opponent is involved. | Same as 3-FFA. | Only for summons from the own GY. A summon from the partner GY does not count. | U |
| Trap Dustshoot | 64697231 | explicit-pick | `c64697231.lua:22`, `c64697231.lua:26` | If the opponent has 4 or more cards in hand, look at it and send 1 Monster to the Deck. | P0 picks one opponent with 4 or more cards. | P0 picks one of 3 opponents. | P0 picks one opposing member. | U |
| Soul Exchange | 68005187 | target-controller | `c68005187.lua:35`, `c68005187.lua:45` | Target 1 monster the opponent controls. This turn, you may Tribute that monster as if you controlled it. No Battle Phase. | P0 targets a monster of any opponent (owner decision 2026-10-01). | Same as 3-FFA. | P0 targets a monster of an opposing member. The partner monsters are not valid targets. | C |
| Lava Golem | 102380 | target-controller | `c102380.lua:7`, `cards_specific_functions.lua:356`, `cards_specific_functions.lua:362` | Special Summon from the hand to the field of the opponent by Tributing 2 monsters they control. | P0 Tributes 2 monsters of the same opponent. Lava Golem goes to the field of that opponent (owner decision 2026-10-01). | Same as 3-FFA. | P0 Tributes 2 monsters of the same opposing member. Lava Golem goes to the field of that member. | O |
| Ring of Destruction | 83555666 | target-controller | `c83555666.lua:19`, `c83555666.lua:25`, `c83555666.lua:41` | Destroy a monster. Both players take damage equal to its ATK. | Forbidden. Test of a future override: damage to P0 and to the controller of the target only. | Forbidden. Same as 3-FFA. | Not forbidden in Tag. | O |
| Creature Swap | 31036355 | explicit-pick | `c31036355.lua:28`, `c31036355.lua:31`, `c31036355.lua:35` | Each player picks 1 monster. The players swap control of them. | Forbidden. Test of a future override: swap with the one picked opponent. | Forbidden. Same as 3-FFA. | Not forbidden in Tag. | O |
| Evenly Matched | 15693423 | explicit-pick | `c15693423.lua:28`, `c15693423.lua:38` | Destroys opponent cards until they control as many as you. | P0 picks one opponent. The card compares P0 with that opponent only, and only that opponent's cards are banished. That opponent chooses their own cards (owner decision 2026-10-01). | Same as 3-FFA. The other 2 opponents are not affected. | The fields of the two opposing members are joined. The count uses the cards of both together against the cards of the own team. The picked opposing duelist chooses from the joined field (one chooser, rule 9). | O |
| Pineapple Blast | 90669991 | explicit-pick | `c90669991.lua:17`, `c90669991.lua:30` | If the opponent has more monsters, destroys monsters of the opponent until the counts match. | P0 picks one opponent. The card compares P0 with that opponent only, and only that opponent's monsters are destroyed. That opponent chooses their own monsters (owner decision 2026-10-01). | Same as 3-FFA. The other 2 opponents are not affected. | The fields of the two opposing members are joined. The count uses the monsters of both together against the monsters of the own team. The picked opposing duelist chooses from the joined field (one chooser, rule 9). | O |

### Layer 1 sketches for group (b)

| Card | Setup | Action | Expected |
|---|---|---|---|
| Mind Crush | P1 and P2 hold different cards. P0 names a card in the hand of P2. | P0 activates Mind Crush and picks P2. | P2 discards every copy. P1 is not affected. |
| Snatch Steal | P1 controls a monster. P0 equips Snatch Steal and takes control of it. | Advance to the Standby Phase of each opponent. | P1 owns the monster. P1 gains 1000 LP in the Standby Phase of P1. P2 has a Standby Phase and P1 gains nothing then. Tag: the team of P1 gains 1000 LP. |
| Change of Heart | P1 and P2 each control one monster. | P0 targets the monster of P2. | The monster is on the field of P0 until the End Phase, then returns to P2. |
| Mind Control | P3 controls one monster. | P0 targets the monster of P3. | The monster is on the field of P0 until the End Phase and cannot attack. |
| Brain Control | P2 controls one monster. | P0 targets the monster of P2. | The monster is on the field of P0 until the End Phase. |
| Enemy Controller | P1 controls one face-up monster. P0 controls one monster. | P0 activates the control option and targets the monster of P1. | P0 gets control of the monster of P1 until the End Phase. |
| Ookazi | All players at full LP. | P0 activates Ookazi and picks P3. | P3 has 7200 LP. Others are unchanged. Tag: the opposing team has 15200 LP. |
| Hinotama | All players at full LP. | P0 activates Hinotama and picks P1. | P1 has 7500 LP. Others are unchanged. |
| Final Flame | P0 controls a Fire monster. All players at full LP. | P0 activates Final Flame and picks P2. | P2 has 7400 LP. |
| Thestalos the Firestorm Monarch | P1 and P2 hold 3 cards each. | P0 Tribute Summons Thestalos and picks P1. | P1 discards 1 random card and takes damage. P2 is unchanged. |
| Don Zaloog | P0 attacks P2 directly with Don Zaloog. | The battle damage step ends. | The effect affects P2 only (event opponent). P1 is unchanged. |
| Dark Bribe | P2 activates a Spell. P0 has Dark Bribe set. | P0 activates Dark Bribe in response. | The Spell is negated. P2 draws 1 card. P1 draws nothing. |
| Soul Taker | P1 and P2 control one monster each. | P0 targets the monster of P2. | The monster is destroyed. P2 gains 1000 LP. P1 is unchanged. |
| Sakuretsu Armor | P0 has Sakuretsu Armor set. P1 attacks with one monster. | P0 activates Sakuretsu Armor. | The attacker of P1 is destroyed. |
| Dimensional Prison | P0 has Dimensional Prison set. P3 attacks with one monster. | P0 activates Dimensional Prison. | The attacker of P3 is banished. |
| Infinite Impermanence | P1 and P2 control one effect monster each. | P0 targets the monster of P2. | The effects of the monster of P2 are negated. |
| Dust Tornado | P1 and P3 control one Trap each. | P0 targets the Trap of P3. | The Trap of P3 is destroyed. P1 is unchanged. |
| Stop Defense | P2 controls a Defense Position monster. | P0 targets it. | The monster changes to Attack Position. |
| Effect Veiler | It is the Main Phase of P2. P0 holds Effect Veiler. P2 controls one effect monster. | P0 discards Effect Veiler and targets the monster of P2. | The effects of that monster are negated. The condition is true for P1, P2 and P3 turns. |
| Confiscation | P1 and P2 hold cards. | P0 activates Confiscation and picks P1. | P0 sees only the hand of P1 and discards one card from it. |
| Delinquent Duo | P1 holds 3 cards. P2 holds 3 cards. | P0 activates Delinquent Duo and picks P2. | P2 discards one random card and one chosen card. P1 is unchanged. |
| Monster Reborn | P1 and P3 have one monster in the GY each. | P0 activates Monster Reborn and picks the monster of P3. | The monster of P3 is on the field of P0. The GY is a field-class query, so the card picked is the choice. |
| Maxx "C" | P0 has Maxx "C" in hand. P1 Special Summons a monster. | P0 activates Maxx "C". | P0 draws 1 card. The same test with a summon by the partner does not trigger the card. |
| Ojama Trio | P1 and P2 have 3 empty monster zones. | P0 activates Ojama Trio and picks P2. | P2 controls 3 Ojama Tokens. When one is destroyed, P2 takes 300 damage. |
| Ash Blossom & Joyous Spring | P2 activates a card that searches. P0 holds Ash Blossom. | P0 tries to activate Ash Blossom in response. | FFA: the effect of P2 is negated. Tag: P2 is the partner, so Ash Blossom cannot be activated. A search by P1 can be negated at all tables. |
| Solemn Judgment | P0 has Solemn Judgment set. P2 Normal Summons a monster. Later P1 Normal Summons a monster. | P0 tries to activate Solemn Judgment on each summon. | FFA: P0 can negate both summons. Tag: P2 is the partner, so Solemn Judgment cannot be activated on the summon of P2. It negates the summon of P1, and the team LP goes from 16000 to 8000. |
| Card of Safe Return | P0 controls Card of Safe Return and has one monster in the GY. | P0 summons the monster from the GY. | P0 draws 1 card. A summon from the GY of the partner gives no draw. |
| Trap Dustshoot | P1 holds 5 cards. P2 holds 3 cards. | P0 activates Trap Dustshoot. | Only P1 is a valid pick. |
| Soul Exchange | P1 and P2 control one monster each. P0 holds a monster that needs a Tribute. | P0 activates Soul Exchange on the monster of P2 and Tribute Summons using it. | The monster of P2 is Tributed. P1 is unchanged. |
| Lava Golem | P1 controls one monster. P2 controls two monsters. P0 has Lava Golem in hand. | P0 tries to summon Lava Golem by Tributing the monster of P1 and one monster of P2. | The summon is illegal. P0 Tributes the 2 monsters of P2 instead and Lava Golem appears on the field of P2. |
| Ring of Destruction | P1 controls a monster with 1000 ATK. | P0 activates Ring of Destruction on it. | PENDING: no override exists. The card is on the forbidden list. |
| Creature Swap | P0 and P1 control one monster each. | P0 activates Creature Swap. | PENDING: no override exists. The card is on the forbidden list. |
| Evenly Matched | P0 controls 1 card. P1 controls 3 cards. P2 controls 3 cards. | P0 activates Evenly Matched and picks P1. | P0 (1 card) is compared with P1 (3 cards) only. P1 chooses 2 of their own cards and they are banished face-down. P2 is not affected. Tag: the 2 opposing members are joined, and the picked opposing duelist chooses the cards to banish from the joined field. |
| Pineapple Blast | P0 controls 1 monster. P1 controls 3 monsters. P2 controls 3 monsters. | P0 activates Pineapple Blast after an opponent Special Summon and picks P1. | P0 (1 monster) is compared with P1 (3 monsters) only. P1 keeps 1 monster of their choice and the other 2 are destroyed. P2 is not affected. Tag: the 2 opposing members are joined, and the picked opposing duelist chooses the monsters from the joined field. |

Finding: the old spec text said Ash Blossom checks `rp==1-tp`. The script has no such check (lines 32 to 38 of `c14558127.lua`), and Solemn Judgment has none either. Ash Blossom can negate effects of the owner in 1v1. The product owner then decided (2026-09-30) that in Tag these cards cannot negate the partner. The fold alone does not do this, so a core rule does it (rule 7). The spec and ADR-0002 now say this.

## Group (c): forbidden in free-for-all

The deck check refuses these cards at the listed tables. "Tag too" says if the card also breaks in 2v2 Tag. Alternate-art passcodes are caught through the `alias` column of `cards.cdb` (for example Exodia 33396949, 33396950 and 33396951).

Categories: symmetry (two equal sides), hand-swap (both hands), control-swap, turn-count (counts opponent turns), turn-order (skips a turn), alt-win (ends the duel with a plain win; forbidden in every format by the owner decision of 2026-10-01), global-state (two-slot player tables), chooser (asks one opponent), lp-reset (sets or compares the LP of two players).

| Card | Passcode | Category | Reason | Script evidence | Tables | Tag too |
|---|---|---|---|---|---|---|
| Hand Destruction | 74519184 | hand-swap | Turn player and one other player draw and discard. The other players do nothing. | `c74519184.lua:16`, `c74519184.lua:28`, `c74519184.lua:39` | 3-FFA, 4-FFA | no |
| Card Destruction | 72892473 | hand-swap | Both hands go to the GY, but only two players draw. | `c72892473.lua:18`, `c72892473.lua:27` | 3-FFA, 4-FFA | no |
| Morphing Jar | 33508719 | hand-swap | It discards all hands, but only two players draw 5 cards. In Tag, the partner discards and does not draw. | `c33508719.lua:19`, `c33508719.lua:23` | 3-FFA, 4-FFA, Tag | yes |
| Multiple Destruction | 14057297 | hand-swap | It reads two hands and two LP totals only. Other players are not part of the cost or the draw. | `c14057297.lua:21`, `c14057297.lua:44` | 3-FFA, 4-FFA, Tag | yes |
| Exchange of the Spirit | 17484499 | hand-swap | The script swaps the Deck and GY of exactly two players. The condition reads one GY on each side. | `c17484499.lua:15`, `c17484499.lua:16` | 3-FFA, 4-FFA, Tag | yes |
| Chaos Emperor Dragon - Envoy of the End | 82301904 | symmetry | It sends both sides and damages both players. More than two players have no defined split. | `c82301904.lua:96`, `c82301904.lua:105` | 3-FFA, 4-FFA | no |
| Kaiser Colosseum | 35059553 | symmetry | It compares the monster count of two sides to limit summons. | `c35059553.lua:16`, `c35059553.lua:30` | 3-FFA, 4-FFA | no |
| Skull Invitation | 98139712 | symmetry | Damage goes by card owner to 'you' and 'the opponent' only. | `c98139712.lua:19`, `c98139712.lua:27` | 3-FFA, 4-FFA | no |
| Ring of Destruction | 83555666 | symmetry | It damages the activator and one opponent. The opponent LP check reads one player. | `c83555666.lua:25`, `c83555666.lua:41` | 3-FFA, 4-FFA | no |
| Swords of Revealing Light | 72302403 | turn-count | It lasts for 3 'opponent turns'. In FFA, one round has more than one opponent turn. | `c72302403.lua:41`, `c72302403.lua:63` | 3-FFA, 4-FFA | no |
| Doom Virus Dragon | 22804644 | turn-count | Its effect lasts 3 'opponent turns'. | `c22804644.lua:48`, `c22804644.lua:56` | 3-FFA, 4-FFA | no |
| The Wicked Avatar | 21208154 | turn-count | Its effect lasts 2 'opponent turns'. | `c21208154.lua:62`, `c21208154.lua:71` | 3-FFA, 4-FFA | no |
| Grisaille Prison | 22888900 | turn-count | Its effect lasts 2 'opponent turns'. | `c22888900.lua:28`, `c22888900.lua:45` | 3-FFA, 4-FFA | no |
| Million-Century Ice Prison | 23746827 | turn-count | Its effect lasts 2 'opponent turns'. | `c23746827.lua:48` | 3-FFA, 4-FFA | no |
| Tellarknight Ptolemaeus | 18326736 | turn-order | It skips a turn. FFA turn order has no 'the opponent's turn'. | `c18326736.lua:73` | 3-FFA, 4-FFA | no |
| Arcana Force XXI - The World | 23846921 | turn-order | It skips a turn. FFA turn order has no 'the opponent's turn'. | `c23846921.lua:76` | 3-FFA, 4-FFA | no |
| Gamble | 37313786 | turn-order | It skips a turn. FFA turn order has no 'the opponent's turn'. | `c37313786.lua:33` | 3-FFA, 4-FFA | no |
| The Six Shinobi | 6357341 | turn-order | It skips a turn. FFA turn order has no 'the opponent's turn'. | `c6357341.lua:28` | 3-FFA, 4-FFA | no |
| Mischief of the Time Goddess | 92182447 | turn-order | It skips a turn. FFA turn order has no 'the opponent's turn'. | `c92182447.lua:52` | 3-FFA, 4-FFA | no |
| Exodia the Forbidden One | 33396948 | alt-win | It reads both hands and ends the duel with win, loss or draw for two sides. | `c33396948.lua:34`, `c33396948.lua:40` | 3-FFA, 4-FFA, Tag | yes |
| Final Countdown | 95308449 | alt-win | It keeps one counter for each of two players and then ends the duel. | `c95308449.lua:12`, `c95308449.lua:39` | 3-FFA, 4-FFA, Tag | yes |
| Last Turn | 28566710 | alt-win | It compares two players and ends the duel with win, loss or draw. | `c28566710.lua:64`, `c28566710.lua:66` | 3-FFA, 4-FFA, Tag | yes |
| True Exodia | 37984331 | alt-win | It ends the duel with a win for 'the opponent of the controller'. FFA and Tag have no single opponent. | `c37984331.lua:23` | 3-FFA, 4-FFA, Tag | yes |
| Relay Soul | 42776960 | alt-win | It ends the duel with a win for one saved player when its monster leaves the field. A 'you win' effect has no defined result for the other players. | `c42776960.lua:56` | 3-FFA, 4-FFA, Tag | yes |
| Exodius the Ultimate Forbidden Lord | 13893596 | alt-win | It ends the duel with a win for its controller when 5 Forbidden One monsters are in the GY. A 'you win' effect has no defined result for the other players. | `c13893596.lua:75` | 3-FFA, 4-FFA, Tag | yes |
| Holactie the Creator of Light | 10000040 | alt-win | The player who Special Summons it wins the duel. A 'you win' effect has no defined result for the other players. | `c10000040.lua:29` | 3-FFA, 4-FFA, Tag | yes |
| Number iC1000: Numerounius Numerounia | 15862758 | alt-win | It ends the duel with a win for its controller when it has not battled in an opponent turn. A 'you win' effect has no defined result for the other players. | `c15862758.lua:71` | 3-FFA, 4-FFA, Tag | yes |
| Exodia, the Legendary Defender | 5008836 | alt-win | It ends the duel with a win for its controller when it destroys a DARK Fiend of an opponent by battle. A 'you win' effect has no defined result for the other players. | `c5008836.lua:50` | 3-FFA, 4-FFA, Tag | yes |
| Ghostrick Angel of Mischief | 53334641 | alt-win | It ends the duel with a win for its controller when it has 10 Xyz Materials. A 'you win' effect has no defined result for the other players. | `c53334641.lua:47` | 3-FFA, 4-FFA, Tag | yes |
| Number C88: Gimmick Puppet Disaster Leo | 6165656 | alt-win | It ends the duel with a win for its controller in their turn when one opponent has 2000 LP or less. A 'you win' effect has no defined result for the other players. | `c6165656.lua:84` | 3-FFA, 4-FFA, Tag | yes |
| Flying Elephant | 66765023 | alt-win | It ends the duel with a win for its controller when it deals battle damage with a direct attack. A 'you win' effect has no defined result for the other players. | `c66765023.lua:50` | 3-FFA, 4-FFA, Tag | yes |
| F.A. Winners | 69553552 | alt-win | It ends the duel with a win for its controller when 3 of its banished cards have different names. A 'you win' effect has no defined result for the other players. | `c69553552.lua:61` | 3-FFA, 4-FFA, Tag | yes |
| Summer Schoolwork Successful! | 77751766 | alt-win | It ends the duel with a win for its controller when their Deck has 1 card or less after its effect. A 'you win' effect has no defined result for the other players. | `c77751766.lua:58` | 3-FFA, 4-FFA, Tag | yes |
| Vennominaga the Deity of Poisonous Snakes | 8062132 | alt-win | It ends the duel with a win for its controller when it has 3 counters. A 'you win' effect has no defined result for the other players. | `c8062132.lua:105` | 3-FFA, 4-FFA, Tag | yes |
| Jackpot 7 | 81171949 | alt-win | It ends the duel with a win for its controller when 3 copies are banished. A 'you win' effect has no defined result for the other players. | `c81171949.lua:52` | 3-FFA, 4-FFA, Tag | yes |
| Destiny Board | 94212438 | alt-win | It ends the duel with a win for its controller when 4 Spirit Message cards are on their field. A 'you win' effect has no defined result for the other players. | `c94212438.lua:122` | 3-FFA, 4-FFA, Tag | yes |
| Musical Sumo Dice Games | 96637156 | alt-win | It ends the duel with a win for its controller when it gets its 7th Xyz Material. A 'you win' effect has no defined result for the other players. | `c96637156.lua:57` | 3-FFA, 4-FFA, Tag | yes |
| Phantasm Spiral Assault | 97795930 | alt-win | It ends the duel with a win for its controller when its counter reaches 3. A 'you win' effect has no defined result for the other players. | `c97795930.lua:77` | 3-FFA, 4-FFA, Tag | yes |
| Number 88: Gimmick Puppet of Leo | 48995978 | alt-win | It ends the duel with a win for its controller when it has 3 counters. A 'you win' effect has no defined result for the other players. | `c48995978.lua:58` | 3-FFA, 4-FFA, Tag | yes |
| Nibiru, the Primal Being | 27204311 | global-state | It counts summons in a flag for each of two players and reads the flag of 'the opponent'. | `c27204311.lua:34`, `c27204311.lua:38` | 3-FFA, 4-FFA | no |
| Droll & Lock Bird | 94145021 | global-state | It keeps a two-slot table of draws for each player. | `c94145021.lua:17`, `c94145021.lua:42` | 3-FFA, 4-FFA | no |
| Crush Card Virus | 57728570 | chooser | It reads the opponent hand, field and Deck, and asks one opponent to choose. | `c57728570.lua:43`, `c57728570.lua:52` | 3-FFA, 4-FFA | no |
| Creature Swap | 31036355 | control-swap | The script swaps control between the activator and one named opponent. | `c31036355.lua:31`, `c31036355.lua:35` | 3-FFA, 4-FFA | no |
| Creature Seizure | 15305240 | control-swap | The script swaps control between the activator and one named opponent. | `c15305240.lua:30`, `c15305240.lua:34` | 3-FFA, 4-FFA | no |
| Switcheroroo | 30426226 | control-swap | It needs equal monster counts on two sides and swaps all of them. | `c30426226.lua:19`, `c30426226.lua:29` | 3-FFA, 4-FFA | no |
| Dummy Golem | 13532663 | control-swap | The script swaps control between the activator and a monster chosen by one named opponent. | `c13532663.lua:25`, `c13532663.lua:26` | 3-FFA, 4-FFA | no |
| Life Equalizer | 17178486 | lp-reset | It sets the LP of one named opponent and compares two LP totals. | `c17178486.lua:18` | 3-FFA, 4-FFA | no |

Turn-count rows: these 5 bans stay (owner answer 2026-10-01). Other cards with an opponent-turn count are legal and follow rule 11; the review is in `.status/multiplayer-turncount-review.md`.

Total: 47 cards. 3-FFA and 4-FFA: 47 cards (24 only in free-for-all). Tag: 23 cards.

Error message format: `<card> is forbidden in 4-player free-for-all: <reason>`. The table name is "3-player free-for-all", "4-player free-for-all" or "2v2 Tag Duel".

### Card rules (owner decisions, 2026-10-01)

The deck check does NOT refuse these cards and does NOT read this list. The list is `MULTIPLAYER_CARD_RULES` in `multiplayer.ts`. `rule` is the decided rule. `engine` is `"native"` when the engine (a core patch or an overlay script) does the rule AND a live scenario proves it for this card. `engine` is `"pending"` when no live scenario proves it for this card yet. `proven` names the tables that a live scenario proves. The check test compares both fields with the live scenarios (`LIVE_PROOF` in `catalog.ts`). Only a card with a scenario of its own is `native`. A card that shares script code with a proven card stays `pending` until it has its own scenario.

Live proof, by card (status 2026-10-01):

| Card | Tables proven by a live scenario |
|---|---|
| Gameciel, the Sea Turtle Kaiju (Tribute goes to the field of the Tributed player, no Tribute needs a Kaiju of an opponent, bound opponent eliminated: no summon, stays in hand) | 3-FFA, 4-FFA, Tag |
| Lava Golem | 3-FFA, 4-FFA, Tag |
| Volcanic Queen | 3-FFA |
| The Winged Dragon of Ra - Sphere Mode | 3-FFA |
| Pineapple Blast, Evenly Matched | 3-FFA, 4-FFA, Tag |
| Ojama Trio, Black Garden, Foolish Revival | 3-FFA, Tag |
| Mimighoul Slime | 3-FFA |
| Mystic Mine, Number 100: Numeron Dragon, Ultimate Sky | 3-FFA |
| Dice Jar, Royal Tribute, Messenger of Peace | 3-FFA, 4-FFA, Tag |

No scenario proves these rules yet (`pending`): the other 6 Kaiju, Alien Skull, Santa Claws, Surgical Striker - H.A.M.P., Jormungardr the Nordic Serpent, Fenrir the Nordic Wolf, Grinder Golem, Fallen of Argyros, Soul Exchange, Snatch Steal, and the cards with an effect that summons to the field of an opponent (Ojama Trio, Black Garden, Mimighoul Slime and Foolish Revival above are the exceptions). The Tag result of Volcanic Queen, Ra, Mimighoul Slime, Mystic Mine, Numeron Dragon and Ultimate Sky also has no scenario. The target cap of Ultimate Sky has no scenario, so this page does not claim it.

Decision 2: Kaiju and Lava Golem. The card goes to the field of the player whose monster was Tributed. If the opponent that was picked for the Tribute is eliminated before the summon is done, the card is not summoned and stays in the hand (lead decision 2026-10-01, proven for Gameciel in 3-FFA and 4-FFA). The scan of `data/duel-engine-next/card-scripts` found 12 cards that use `aux.AddKaijuProcedure` or `aux.AddLavaProcedure`, and the catalog test checks that every one has a rule entry. The Winged Dragon of Ra - Sphere Mode is added to this table by the owner answer of 2026-10-01 (it has its own Tribute procedure). In Tag, the Tributed monster belongs to an opposing member, so the card goes to that member's field. The Kaiju summon with no Tribute (an opponent controls a Kaiju) goes to your own field.

| Card | Passcode | Rule | Script evidence |
|---|---|---|---|
| Gameciel, the Sea Turtle Kaiju | 55063751 | Kaiju rule | `c55063751.lua:5`, `cards_specific_functions.lua:347`, `cards_specific_functions.lua:362` |
| Radian, the Multidimensional Kaiju | 28674152 | Kaiju rule | `c28674152.lua:5` |
| Kumongous, the Sticky String Kaiju | 29726552 | Kaiju rule | `c29726552.lua:5` |
| Gadarla, the Mystery Dust Kaiju | 36956512 | Kaiju rule | `c36956512.lua:5` |
| Thunder King, the Lightningstrike Kaiju | 48770333 | Kaiju rule | `c48770333.lua:7` |
| Jizukiru, the Star Destroying Kaiju | 63941210 | Kaiju rule | `c63941210.lua:5` |
| Dogoran, the Mad Flame Kaiju | 93332803 | Kaiju rule | `c93332803.lua:5` |
| Lava Golem | 102380 | Goes to the field of the player whose monster was Tributed. It must Tribute 2 monsters of the same opponent. | `c102380.lua:7`, `cards_specific_functions.lua:362` |
| Volcanic Queen | 63014935 | Goes to the field of the player whose monster was Tributed. | `c63014935.lua:7` |
| Alien Skull | 25920413 | Goes to the field of the player whose monster was Tributed. | `c25920413.lua:6` |
| Santa Claws | 46565218 | Goes to the field of the player whose monster was Tributed. | `c46565218.lua:6` |
| Surgical Striker - H.A.M.P. | 33331231 | In the procedure for an opponent field, goes to the field of the player whose monster was Tributed. | `c33331231.lua:19` |
| The Winged Dragon of Ra - Sphere Mode | 10000080 | All Tributed monsters come from ONE opponent, and it goes to the field of that opponent (owner answer 2026-10-01). In Tag, that opponent is an opposing member. It has its own procedure, not `aux.AddKaijuProcedure`. It does not use the rule of a summon to the field of an opponent (the summoning player picks one opponent): the Tribute decides the field. | `c10000080.lua:12` |

Decision 3: count rules (one opponent in free-for-all, joined fields in Tag). These two cards are now in group (b), with an explicit pick. The same rule holds for all count and compare cards (rule 8). In Tag, the picked opposing duelist is the one chooser (rule 9).

| Card | Passcode | Rule | Script evidence |
|---|---|---|---|
| Pineapple Blast | 90669991 | In free-for-all, you pick one opponent when you activate it. The card compares you with that opponent only. Only the monsters of that opponent are destroyed, and that opponent chooses their own monsters, as in 1v1. In Tag, the fields of the two opposing members are joined, the count uses the monsters of both together, and the picked opposing duelist chooses from the joined field (one chooser). | `c90669991.lua:17`, `c90669991.lua:30` |
| Evenly Matched | 15693423 | The same rule, with the cards of that opponent (banished) instead of monsters. | `c15693423.lua:28`, `c15693423.lua:38` |

Decision 5: a summon to the field of an opponent. The summoning player picks one opponent when they summon, and the card or the tokens go to the field of that opponent. In Tag, that opponent is an opposing member. The scan of the card scripts found two groups. The catalog test repeats the scan and fails when a card is in neither the rule list nor the forbidden list.

- 4 cards with their own Special Summon procedure (`SetTargetRange(position,1)`):

| Card | Passcode | Script evidence |
|---|---|---|
| Jormungardr the Nordic Serpent | 64203620 | `c64203620.lua:13` |
| Fenrir the Nordic Wolf | 91697229 | `c91697229.lua:13` |
| Grinder Golem | 75732622 | `c75732622.lua:12` |
| Fallen of Argyros | 82090807 | `c82090807.lua:20` |

- 102 cards with an effect that calls `Duel.SpecialSummon` or `Duel.SpecialSummonStep` with summoning player `tp` and target player `1-tp`. The first four by passcode are Miracle Flipper, Poisonous Viper, Branded Expulsion, Arcana Force V - The Hierophant. The full list is `OPPONENT_FIELD_EFFECT_SUMMON` in `multiplayer.ts`. The script line of each effect is in `OPPONENT_FIELD_LINES` in `catalog.ts`. The Winged Dragon of Ra - Sphere Mode is not in this group. It Tributes monsters of an opponent, so it uses the Tribute rule (owner answer 2026-10-01, rule 10).

Decision 6: cards that compare with the opponents or roll against one (lead decisions 2026-10-01, the user may override).

| Card | Passcode | Rule | Script evidence |
|---|---|---|---|
| Mystic Mine | 76375976 | Only an opponent that alone controls more monsters than you is locked (no monster effect, no attack). The sum of two opponents does not count. It destroys itself in the End Phase when your count equals the count of any one opponent. | `c76375976.lua:53`, `c76375976.lua:57`, `c76375976.lua:63` |
| Number 100: Numeron Dragon | 57314798 | It is offered only when a direct attack goes at YOU (in Tag, at your team). A direct attack at another seat does not offer it. Each duelist Sets from its own Graveyard. | `c57314798.lua:98` |
| Ultimate Sky | 38817295 | In free-for-all, you pick one opponent when you activate it. It is offered when ONE opponent controls more monsters than you, and it reads only that opponent. | `c38817295.lua:15`, `c38817295.lua:30` |
| Dice Jar | 3549275 | You and one opponent, picked when it flips, each roll a die. Only the side that loses the roll takes the damage. In Tag, the team LP takes it. | `c3549275.lua:22`, `c3549275.lua:26`, `c3549275.lua:32` |

The same direct-attack rule holds for the other cards that start with "your opponent's monster declares a direct attack": they are offered only when the attack goes at you (in Tag, at your team). In the overlay these are the cards of class ATTACK (they use `aux.MPAttackedAtMe`). `tests/scenarios/multiplayer/attack-direct.ts` has 22 scenarios in 3-FFA and 1 in Tag (a counter card offered to the partner). Most cards of the class have no scenario of their own yet.

Decision 4: the other cards use the defaults.

| Card | Passcode | Rule | Script evidence |
|---|---|---|---|
| Messenger of Peace | 44656491 | You pay the 100 LP only in your own Standby Phase. In Tag, only the Standby Phase of your own duelist turn counts, and the team LP pays. | `c44656491.lua:33`, `c44656491.lua:37` |
| Royal Tribute | 72405967 | Every opponent discards the monsters in their hand. You discard yours too, as in 1v1. In Tag, 'both players' means every duelist, the partner included (R-COMMON-EACH-PLAYER, owner decision 2026-10-01). | `c72405967.lua:22` |
| Soul Exchange | 68005187 | You may target 1 monster of any opponent. This turn, a Tribute may use it as if you controlled it. | `c68005187.lua:35`, `c68005187.lua:45` |
| Snatch Steal | 45986603 | The owner of the monster gains the 1000 LP, in the own Standby Phase of that owner. In Tag, the Standby Phase of the own duelist turn counts, and the team LP gains. | `c45986603.lua:33`, `c45986603.lua:37` |
| Book of Eclipse | 35480699 | The initial flip affects every seat. In FFA, the End Phase flip and draw affect only the opponent declared at activation (R-FFA-OPP-ONE, owner decision 2026-10-02). An eliminated declared opponent gives no result. In Tag, each opposing member flips and draws for its own monsters. The suffix retains the declared opponent for the delayed effect. | `c35480699.lua:37` |
| Prediction Princess Astromorrigan | 5010422 | In FFA, declare one opponent when the flip effect enters the chain. In the End Phase, destroy that opponent's Defense Position monsters and deal 500 damage for each destroyed monster (R-FFA-OPP-ONE, owner decision 2026-10-02). Tag uses both opposing fields and their shared LP pool. | `c5010422.lua:25`, `c5010422.lua:30` |

Decision 7: cards that were legal but gave a wrong result at 3 or more duelists (cross-seat review, 2026-10-01). Each row names the live proof (FFA3, FFA4 and Tag, Standard and Domain cores). "Fixed" means an overlay in `domain-core/multi-scripts`; "proven" means the stock script is right and a live scenario shows it.

| Card | Passcode | Result | Proof |
|---|---|---|---|
| Rebirth of the Seventh Emperors | 83888009 | Fixed: only the controller of the Tribute Summoned monster is affected. | `rebirth-emperors.ts` |
| Invincible Demise Lord | 71108540 | Fixed: its 3000 ATK and the effect-proof bonus come after a battle kill at any seat (the stock global check wrote slot 0). | `demise-lord.ts` |
| Mementotlan Shleepy, Mementotlan Fusion | 50042011, 66518509 | Fixed: the flag and the effect bind to the real controller. | `memento-flags.ts` |
| Soul Taker | 81510157 | Fixed: the 1000 LP go to the controller of the destroyed monster (in Tag, its team). Stock asked "Choose an opponent". | `event-binding-staples.ts` |
| Ante, Tri-and-Guess, Self-Destruct Button | n/a | Proven correct: no change. | `lp-pair-cards.ts` |
| Foolish Trap Hole | n/a | Proven. | `foolish-trap-hole.ts` |
| Chaos Archfiend, Chaos Beast, Sangen Kaiho, Dragions, True Draco Heritage, Utopia the Envoy of Light | n/a | Proven. | `flag-atk-cards.ts`, `attack-flag-cards.ts`, `true-draco-heritage.ts`, `utopia-envoy.ts` |
| Dark Bribe, Don Zaloog, Maxx "C", Effect Veiler, Infinite Impermanence | 77538567, 76922029, 23434538, 97268402, 10045474 | Proven: the core binds the event player, only the duelist of the event is hit. | `event-binding-staples.ts` |

The following cards also have live proofs in FFA3, FFA4 and Tag. Each listed scenario id has a Domain variant with the `-domain` suffix. Each proof answers real prompts and checks every seat.

| Card | Proof file | Scenario ids |
|---|---|---|
| Monster Rebirth | `monster-rebirth.ts` | `monster-rebirth-ffa3-p2-revives-after-p1-battle-destruction`, `monster-rebirth-ffa4-p3-revives-after-p1-battle-destruction`, `monster-rebirth-tag-p3-revives-after-p1-battle-destruction` |
| Favorite HERO Flame Wingman | `flame-wingman.ts` | `flame-wingman-ffa3-late-seat-fusion-after-battle-kill`, `flame-wingman-ffa4-late-seat-fusion-after-battle-kill`, `flame-wingman-tag-late-seat-fusion-after-battle-kill` |
| Token Support | `token-support.ts` | `token-support-ffa3-late-seat-replaces-two-battle-destroyed-tokens`, `token-support-ffa4-late-seat-replaces-two-battle-destroyed-tokens`, `token-support-tag-late-seat-replaces-two-battle-destroyed-tokens` |
| Penetration Fusion | `penetration-fusion.ts` | `penetration-fusion-ffa3-late-seat-fusion-and-tribute-after-battle-kill`, `penetration-fusion-ffa4-late-seat-fusion-and-tribute-after-battle-kill`, `penetration-fusion-tag-late-seat-fusion-and-tribute-after-battle-kill` |
| Divine Arsenal AA-ZEUS - Sky Thunder | `aa-zeus.ts` | `aa-zeus-ffa3-p2-xyz-battle-permits-summon`, `aa-zeus-ffa4-p3-xyz-battle-permits-summon`, `aa-zeus-tag-p3-xyz-battle-permits-summon` |
| Red Nova Dragon - Burning Soul | `red-nova-burning-soul.ts` | `red-nova-burning-soul-ffa3-p2-own-synchro-gives-recovery-and-bonus`, `red-nova-burning-soul-ffa4-p3-own-synchro-gives-recovery-and-bonus`, `red-nova-burning-soul-tag-p3-own-synchro-gives-recovery-and-bonus` |
| Vanquish Soul Rocks | `vanquish-soul-rocks.ts` | `vanquish-soul-rocks-ffa3-p2-vanquish-battle-permits-one-summon`, `vanquish-soul-rocks-ffa4-p3-vanquish-battle-permits-one-summon`, `vanquish-soul-rocks-tag-p3-vanquish-battle-permits-one-summon` |

The Vanquish Soul Rocks scenarios prove an Xyz Summon after Razen battles. Seat 0 is in each battle. A proof of the `regop` fix with seat 0 absent from the battle is still required.

Not live-tested (same wrapper overlay as a proven card): Kairo Ryu-Ge Emva, Kyoro Ryu-Ge Kaiva, Battlefield Tragedy, Superconductive Plasma Blast, Red-Eyes Exceed, Swiftwind Panther Warrior. Artifact Lancea has no overlay.

The Domain n-seat Deck Master rules (summon, Link material, recall) are proven in `domain-nseat-gaps.ts` and `domain-ffa4-deck-master.ts`.

## Open questions for the product owner

Answered on 2026-10-01 (see "Card rules", the alt-win rows in group (c) and rules 8 to 11 above; the ten triage questions are in ADR-0002): Evenly Matched and Pineapple Blast (one opponent in free-for-all, joined fields in Tag), Snatch Steal, Lava Golem and the Kaiju cards, summons to the field of an opponent (Jormungardr, Fenrir, Grinder Golem and the same cards), Messenger of Peace, Royal Tribute (partner included), Soul Exchange and all alternative-win cards.

Still open:
1. Chaos Emperor Dragon and Skull Invitation: how to split the damage. The list forbids them for now.
2. Spec corrections: Ash Blossom has no `rp==1-tp` check (done: the partner rule is now rule 7). The Crush Card Virus lines are about 43 to 63, not 46 to 63. The spec pattern counts (125 and 123) are lower than the broad pattern counts (250 and 142).
3. Is `packages/duel-server/src/banlists/` the right home for this list, or should it move to `packages/shared` so that the web deck builder can show it?
