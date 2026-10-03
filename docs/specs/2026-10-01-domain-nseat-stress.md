# Domain engine proof at three and four seats

This work uses P61 and the Domain layer. It does not change the installed cores.
Tests use new `domain-nseat-stress*.ts` files. Core changes, if needed, use
`packages/duel-server/domain-core/.build/phase1/gap-domain/`.

## Rule list and expected results

Sources: ADR-0002; `2026-09-30-multiplayer-core-design.md`, section 8;
`domain-core/pins.json`; `domain_master.cpp`; `apply-domain-patch.mjs`;
`apply-domain-multi.mjs`; `lua/domain.lua`.

PASS below means live proof on the private P61 core with the three exported
patches. The tests use the frozen script overlay at commit `a3297e3`.
OTHER means work assigned to another agent. The final board is preserved when
a result ends the duel; continuing FFA elimination removes real cards.

| Rule | FFA3 and FFA4 | Tag | Status at more than two seats |
|---|---|---|---|
| One Deck Master and zone per seat | 3 or 4 separate owners and zones | 4 separate owners and zones | PASS: all-seat boards and raw FFA queries |
| The zone is 0x4000, not hand, field, or Extra Deck | Ordinary field effects and counts exclude it | Partner field counts exclude the partner zone | PASS: counts, effects, materials, direct attacks, and Extra Deck queries |
| A Deck Master occupies one location | A summon empties only the owner's zone | Same, including the partner | PASS: summons, movement, theft, and raw queries |
| Normal Summon and Monster Set use the normal rules | Own turn and own summon limit | Own turn; partner cards can pay costs | PASS: summon and Set; existing partner-cost Domain cases are separate |
| Main monster inherent Special Summon uses its procedure | Own zone; normal procedure | Own zone; team field where rules allow | PASS: Cyber Dragon and field master counts |
| Fusion, Synchro, Xyz, Link, and Ritual use proper summon rules | Proper mechanic may see own master | Partner master stays in its own zone; legal partner materials count | PASS: Fusion, Synchro, Xyz, Ritual; Tag partner Fusion and Synchro; OTHER: Link |
| A bounded Extra Deck bridge needs the proper mechanic and a successful card filter | Type-only queries do not see the master | Same | PASS: valid Fusion, incompatible Fusion, and type-only refusal |
| Activated effects in the zone are blocked, except main Pendulum scale activation | Owner only | Owner only | OTHER: ability work; Pendulum summon cases pass |
| Materials cannot come directly from the zone | First summon the master | Partner zone is also excluded | PASS: matching own and partner Fusion materials; OTHER: Link |
| Main Deck masters may Pendulum Summon when legal; Extra Deck Pendulum masters need their proper mechanic | Own master and zones | Same | PASS: main Normal, main Pendulum, and excluded Extra Pendulum |
| First leave is free; each completed return adds 500 LP to the next leave | Own LP | Shared team LP | OTHER: tax; first free leave passes in these cases |
| Costs accumulate; normal LP cost modifiers apply | Own LP | Team LP | OTHER: tax and Tag PayLPCost |
| Recall follows a location-kind change, after chains and triggers at open state | Living owners in turn order | Separate living owners in turn order | PASS: movement with refusal; OTHER: full recall order and Link recall |
| Field and overlay locations block recall; refusal consumes the change | Owner keeps current location | Same | PASS: control return, destruction, banishment, and attached Xyz material |
| Elimination removes all owned cards, stolen cards, and ongoing effects | Remove the lost seat's master too; no residual zone | Loss applies to both team members and ends the duel | PASS: real FFA zones, stolen masters, dead chain links; final Tag board stays frozen |
| A pending loser has no new chain effect; simultaneous losses are applied together | Survivors continue; last survivor wins; no survivors draw | One surviving team wins; both teams lost draw | PASS: open response windows, loss sets, deck-out, and final results |
| LP, damage, and recovery use the correct seat | Separate 8000 LP by default | Two shared 16000 LP pools by default | PASS: battle, direct attack, damage effects, and recovery |
| Turns skip eliminated seats; first draw follows duel mode and Master Rule | Clockwise; the last living duelist in the first round has the first Battle Phase | 0,1,2,3; first Battle Phase is turn 4; first draw follows duel mode and Master Rule | First draw: follow the final evening owner answer. First Battle Phase: requires C2 integration. |
| Activated effects on "your opponent" declare one opponent in FFA; continuous effects apply to all eligible opponents | A master on the field counts for its controller | Field comparisons use the opposing team; the partner is not an opponent | The one-opponent field proofs require C3 integration. |
| Domain does not change Standard or 1v1 rules | N-seat changes require n > 2 | Same | PASS: guarded patches, Standard raw regressions, seven two-seat Domain controls, five driver comparisons |

The owner decision of 2026-10-02 replaces the first-draw rule in the table above.
Domain in every seat layout (1v1, Tag, FFA3, FFA4): every duelist draws on their first turn, including the turn-1 duelist. Standard MR1/MR2: the turn-1 duelist also draws. Standard MR3/MR4/MR5: only the turn-1 duelist skips the draw. MR3 removed that draw on 21 March 2014. The table records the earlier P61 proof.

**Known deviation, accepted by the owner on 2026-10-02:** The default legacy 1v1 engine keeps the stock Master Rule draw rule in Standard and Domain. In Domain MR3, MR4 and MR5, the turn-1 duelist does not draw. This is an accepted exception to the Domain draw rule. The pinned engine follows the Domain draw rule. The saved `firstTurnDraw` flag records the actual engine behavior; it is `false` for legacy Domain MR3 through MR5.

Deck construction also uses these rules per seat in all three formats: one
playable monster as Deck Master, exactly 60 Main Deck cards, at most 15 Extra
Deck cards, no Side Deck, one copy per card identity across Main and Extra,
and no copy of the Deck Master in those decks. Monster membership follows the
master's Domain (Type, Attribute, archetype, or a named card; Divine cards are
included). No banlist applies by default. When the host selects a banlist, it
applies per deck. The multiplayer safety list always applies. These checks
and the Domain card restriction are outside this engine audit. The other agent
owns the restriction and the host and lobby paths. Fuzz deliberately uses
60-card engine decks with Deck Masters and varied cards; it does not prove
competitive deck legality.

## Work sequence

1. Run live scenarios on installed P61. Check all seats after each decisive action.
2. For each failure, find the cause before a change. Prove the test fails on P61.
3. Make one fix and its tests per commit. Generate the overlay manifest if needed.
4. Build core fixes only in the private tree with the local Emscripten 4.0.9 image.
   Export unnumbered patches and commit messages. Do not install the core.
5. Run Domain fuzz for FFA3, FFA4, and Tag, 150 seeds each. Treat every error,
   hang, or wrong result as a failure. Add a live case for each engine defect.
6. Record proof, gaps, and hashes. Delete only this task's build and scratch files.

## Results

The initial P61 run passes 27 live scenarios and 4 direct core checks. They prove destruction,
banishment, theft, battle damage, first-turn rules, simultaneous losses, and
inherent summons. Every decisive board check includes all seats. The direct
core checks also prove that a lost FFA seat has no cards in any real zone.

A final Tag loss ends the duel at once. The core preserves the final board;
it does not remove cards or finish the active chain after that result. A Tag
draw also has no individual elimination messages. The tests check this result
and the LP of all four seats. These are the existing core termination rules.

The fuzz driver now counts real Deck Master leaves and returns per seat. A live
seed in each format proves that the report includes actual Deck Master play.
The new tests failed before this report change and pass after it. Deck creation
already supports Domain decks. The later chain-loop fix changes the answer policy.

P61 also passes 40 summon cases at FFA3 seat 2, FFA4 seat 3, and Tag seats 2
and 3. These prove Monster Set, Fusion, Synchro, Xyz, Ritual, and Pendulum
Summons. Both Normal and Pendulum main-deck masters can Pendulum Summon. An
Extra Deck Pendulum master is excluded from the scale activation and Pendulum
Summon. All cases check the Deck Master zone and the board of every seat.

P61 passes 25 control and loss cases. They prove temporary control return,
battle damage to the controller of a stolen master, a return to the owner's
hand, and count effects that include a master on the field. They also prove
empty-Deck losses, LP recovery, all-seat simultaneous losses, and the first
battle window after a seat loses before its first turn. A lost FFA thief sends
the living owner's master to that owner's Graveyard. Tag count effects use
the joined opposing field. LP recovery reaches both views of the same team.

The first full fuzz run used P61 and the overlay at commit `a3297e3`. FFA3
and FFA4 each passed 150 seeds. Tag passed 149 seeds. Seed 60 found a driver
loop: Borreload Liberator Dragon repeatedly tried to destroy the partner's
Metaion. Metaion cannot be destroyed. The legal action had no result and its
chain limit reset after each chain. Two passes advanced the phase to Main 1.

The driver now passes optional chain prompts after eight consecutive answers
with the same board. It still fails if the engine does not advance. Replay
and the two-seat answer policy stay unchanged. The live seed test failed at
step 287 before the fix and reaches a final result after it. Seven live and
checker tests pass. No engine or Lua patch is needed for this driver defect.

Eight more material cases pass on P61. A master in its zone cannot be Fusion
material. A master on the field can be Xyz material and remains attached,
with no recall prompt. The Fusion cases also prove that Fusion Conscription,
which uses an ordinary Extra Deck filter, cannot see the master in the zone,
while Polymerization can use the proper Fusion procedure. Monster Set uses
the normal summon limit at every tested late seat.

Eight summon boundary cases pass on P61. Proper Fusion procedures reject an
incompatible master at every late seat. In Tag, a matching partner master is
not a material while it is in the Domain zone. After a real Normal Summon,
that same partner master is a valid Fusion material. Both teams
pass, and every board check includes all four seats.

Three pending-loss chain view cases pass on P61. FFA preserves the response window
of a living seat. The lost seat's Dust Tornado has no effect, Pot of Greed
finishes, and the lost master's reported zone is removed. In Tag, p2, the living partner of the turn player p0,
keeps its response window until the loss is applied. The team result
then ends the duel, with the unfinished chain and final board preserved.
Two direct core checks found a hidden P61 defect after the FFA chain cases:
Dust Tornado returned to the lost owner's Graveyard. Elimination removed the
card but kept it in `leave_confirmed`. Chain cleanup then sent it to the
Graveyard again. The private patch removes the card from that queue and clears
its leave status. The elimination function already returns with two seats.

The raw Domain and Standard cases fail on P61 and pass on the private wasm.
Five two-seat Domain controls also pass on that same wasm. The build uses P61,
the Domain layer, and local Emscripten 4.0.9. No core was installed. The patch
and `commit-message.txt` are in `gap-domain/out`, with tracked copies under
`domain-core/proposals/domain-nseat-stress/`. No overlay change is needed.

Three direct-attack cases pass on the private wasm. A master in the Domain
zone is not an attack target and does not block a direct attack. Damage goes
to the selected opponent in FFA and the shared opposing LP pool in Tag.
The master remains in its zone. Every seat is checked.

Six more Synchro cases close the Tag partner gap. On P61, a Synchro master
cannot use a legal monster of its partner. Both late-seat cases fail at the
real summon prompt. This task adopts the existing Tag audit patch from
`gap-tag2/out/0001-tag-synchro.patch`, without changes to that agent's files.
The patch uses team membership at more than two seats and keeps the stock
two-seat check. Both teams now summon the master. FFA3, FFA4, and both Tag
teams still reject opponent materials. Two extra two-seat cases prove the
same boundary. All 177 tests pass on the final private wasm. The second
unnumbered patch and its commit message are under `gap-domain/out/tag-partner-synchro/`,
with tracked copies under the matching proposal folder.

Review found one two-seat change in the adopted Synchro patch. It queried a
material effect before it compared controllers. Stock skips that query for
own material. An effect condition can change Lua state and effect IDs. A live
two-seat probe with a counting condition fails with the adopted patch and
passes on P61. The correction compares controllers or teams first, then
queries the effect only for another controller or team. The probe now passes,
followed by a real master summon and both-seat checks. All 177 tests and the
focused type check pass on the reviewed private wasm. The third unnumbered
patch is under `gap-domain/out/synchro-effect-order/`, with a tracked copy.

## Final proof and limits

The reviewed private wasm passes 177 tests in 12 files: 131 new live checks
and 46 existing checks. Every new decisive board check includes all seats.
The raw checks include Standard regressions. Seven two-seat Domain controls
run on the same private wasm. Five driver comparisons have the same two-seat
hashes, journals, and step counts. Review has no remaining finding.

The final Domain fuzz run completes all 450 duels, with seeds 1 through 150
in each format, Master Rule 5, 1000 steps per duel, and elimination rate 0.5.
Strict mode reports no Lua error, engine error, hang, winner-check failure,
or unfinished duel.

| Format | Ended | Steps | Master leaves | Returns |
|---|---:|---:|---:|---:|
| FFA3 | 150/150 | 50033 | 654 | 336 |
| FFA4 | 150/150 | 73245 | 901 | 486 |
| Tag | 150/150 | 49206 | 846 | 439 |
| Total | 450/450 | 172484 | 2401 | 1261 |

The run has 1650 masters, with real master leaves and returns at every seat.
The reviewed wasm SHA256 is
`a695f5e895dc31745c54aad73fbe417874942e3ae750c6f381d4d2e913915abe`.
Its base is P61 core commit `adff5f1`; its tested head is `538916e`.
The frozen overlay is from commit `a3297e3`. Its manifest SHA256 is
`c4df9c0388c813b443edb51b8f93aff7a1e282a983b96d2b07c22d5fc31d414f`.
An earlier run stopped when another agent changed the live overlay during
manifest loading. That setup race is excluded from the final result.

The focused type check passes. The package type check fails in concurrent
audit files because of `.ts` import extensions and missing scenario tags.
There is no type error in this task's files. The latest concurrent overlay
changes are outside this frozen proof. Assigned ability, Link, recall, tax,
restriction, Tag PayLPCost, and host/lobby work are also outside this audit.
The initial P61 reference needs the exported fixes. During cleanup, the
installed Domain wasm changed outside this task. Its final SHA256 is
`9c2257e99767a637a1d3c60542ccc0e80b6c2ab4783efe91ffae183f7c6731d3`.
This task did not install a core. This later installed binary is outside the
private proof.

Commit `37f6923` also contains three files that another agent had staged in
the shared index. This task did not edit them. The history is preserved.
All later commits use explicit path-only commits.

The private build, binaries, frozen overlay, debug replay, and scratch logs
are removed. The unnumbered patches, commit messages, build details, compact
proof record, and selected proof logs remain in `gap-domain/out`. Tracked
proposal copies also remain. This task did not change installed cores or
external services.
