# Domain engine proof at three and four seats

This work uses P61 and the Domain layer. It does not change the installed cores.
Tests use new `domain-nseat-stress*.ts` files. Core changes, if needed, use
`packages/duel-server/domain-core/.build/phase1/gap-domain/`.

## Rule list and expected results

Sources: ADR-0002; `2026-09-30-multiplayer-core-design.md`, section 8;
`domain-core/pins.json`; `domain_master.cpp`; `apply-domain-patch.mjs`;
`apply-domain-multi.mjs`; `lua/domain.lua`.

| Rule | FFA3 and FFA4 | Tag | Proof plan |
|---|---|---|---|
| One Deck Master and zone per seat | 3 or 4 separate owners and zones | 4 separate owners and zones | Existing summon tests; new removal tests |
| The zone is 0x4000, not hand, field, or Extra Deck | Ordinary field effects and counts exclude it | Partner field counts exclude the partner zone | New count and destruction tests |
| A Deck Master occupies one location | A summon empties only the owner's zone | Same, including the partner | Existing tests; new control tests |
| Normal Summon and Monster Set use the normal rules | Own turn and own summon limit | Own turn; partner cards can pay costs | Existing summon tests; new Set tests |
| Main monster inherent Special Summon uses its procedure | Own zone; normal procedure | Own zone; team field where rules allow | Existing rules; new summon proof |
| Fusion, Synchro, Xyz, Link, and Ritual use proper summon rules | Proper mechanic may see own master | Partner master stays in its own zone | Link work belongs to the other agent; new Fusion and Ritual proof |
| A bounded Extra Deck bridge needs the proper mechanic and a successful card filter | Type-only queries do not see the master | Same | Existing 1v1 bridge tests; n-seat gap to check |
| Activated effects in the zone are blocked, except main Pendulum scale activation | Owner only | Owner only | Other agent owns ability work |
| Materials cannot come directly from the zone | First summon the master | Partner zone is also excluded | Other agent owns Link work; existing rules |
| Main Deck masters may Pendulum Summon when legal; Extra Deck Pendulum masters need their proper mechanic | Own master and zones | Same | New Pendulum proof |
| First leave is free; each completed return adds 500 LP to the next leave | Own LP | Shared team LP | Other agent owns tax work |
| Costs accumulate; normal LP cost modifiers apply | Own LP | Team LP | Other agent owns tax and Tag PayLPCost work |
| Recall follows a location-kind change, after chains and triggers at open state | Living owners in turn order | Separate living owners in turn order | Other agent owns recall; movement tests refuse it |
| Field and overlay locations block recall; refusal consumes the change | Owner keeps current location | Same | New control and destruction proof |
| Elimination removes all owned cards, stolen cards, and ongoing effects | Remove the lost seat's master too; no residual zone | Loss applies to both team members | New removal and stolen-master proof |
| A pending loser has no new chain effect; simultaneous losses are applied together | Survivors continue; last survivor wins; no survivors draw | One surviving team wins; both teams lost draw | New loss proof |
| LP, damage, and recovery use the correct seat | Separate 8000 LP by default | Two shared 16000 LP pools by default | New battle and effect proof |
| Turns skip eliminated seats; only the first duelist skips its first draw | Clockwise; no battle until all living seats had a turn | 0,1,2,3; battle starts on turn 4 | New first-turn proof |
| Opponent field effects include all opponents; compare effects pick one in FFA | Master on field counts for its controller | Compare joined team fields; partner is not an opponent | New count and battle proof |
| Domain does not change Standard or 1v1 rules | N-seat changes require n > 2 | Same | Guard review and live 1v1 controls if core changes |

Deck construction and the Domain card restriction are outside this engine audit.
The other agent owns the restriction and the host and lobby paths.

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

P61 passes 27 live scenarios and 4 direct core checks. They prove destruction,
banishment, theft, battle damage, first-turn rules, simultaneous losses, and
inherent summons. Every decisive board check includes all seats. The direct
core checks also prove that a lost FFA seat has no cards in any real zone.

A final Tag loss ends the duel at once. The core preserves the final board;
it does not remove cards or finish the active chain after that result. A Tag
draw also has no individual elimination messages. The tests check this result
and the LP of all four seats. These are the existing core termination rules.
