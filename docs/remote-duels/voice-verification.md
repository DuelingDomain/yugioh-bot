# Remote voice verification

Node v22.23.3. 77/77 phrase cases passed. Shared parser agreement checked for phases, turn, Undo and rejected phrases.

| Phrase | Context | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| draw phase | main2 | phase:draw | phase:draw | PASS |
| standby phase | main2 | phase:standby | phase:standby | PASS |
| main phase | before Battle | phase:main1 | phase:main1 | PASS |
| main phase one | main2 | phase:main1 | phase:main1 | PASS |
| main phase 1 | main2 | phase:main1 | phase:main1 | PASS |
| main one | main2 | phase:main1 | phase:main1 | PASS |
| first main phase | main2 | phase:main1 | phase:main1 | PASS |
| main phase two | main2 | phase:main2 | phase:main2 | PASS |
| main phase 2 | main2 | phase:main2 | phase:main2 | PASS |
| main two | main2 | phase:main2 | phase:main2 | PASS |
| second main phase | main2 | phase:main2 | phase:main2 | PASS |
| battle phase | main2 | phase:battle | phase:battle | PASS |
| battle step | main2 | phase:battle | phase:battle | PASS |
| end phase | main2 | phase:end | phase:end | PASS |
| end turn | main2 | turn | turn | PASS |
| pass turn | main2 | turn | turn | PASS |
| turn end | main2 | turn | turn | PASS |
| mane phase | standby | phase:main1 | phase:main1 | PASS |
| main face | standby | phase:main1 | phase:main1 | PASS |
| battle face | main2 | phase:battle | phase:battle | PASS |
| and phase | main2 | phase:end | phase:end | PASS |
| stand by phase | main2 | phase:standby | phase:standby | PASS |
| main phase won | main2 | phase:main1 | phase:main1 | PASS |
| main phase too | main2 | phase:main2 | phase:main2 | PASS |
| go back a phase | main2 | phase:battle | phase:battle | PASS |
| previous phase | main2 | phase:battle | phase:battle | PASS |
| back to main phase one | main2 | phase:main1 | phase:main1 | PASS |
| undo phase | main2 | phase:battle | phase:battle | PASS |
| undo | main2 | undo | undo | PASS |
| undo that | main2 | undo | undo | PASS |
| take that back | main2 | undo | undo | PASS |
| main | main2 | none | none | PASS |
| standby | main2 | none | none | PASS |
| battle | main2 | none | none | PASS |
| end | main2 | none | none | PASS |
| draw | main2 | none | none | PASS |
| main deck | main2 | none | none | PASS |
| battle damage | main2 | none | none | PASS |
| the main phase is next | main2 | none | none | PASS |
| don't end turn | main2 | none | none | PASS |
| undo phase later | main2 | none | none | PASS |
| battle phase or end phase | main2 | none | none | PASS |
| main phase three | main2 | none | none | PASS |
| phase | main2 | none | none | PASS |
| end phase dragon | main2 | none | none | PASS |
| undo that later | main2 | none | none | PASS |
| back to end phase | main2 | none | none | PASS |
| back to main phase two | main2 | none | none | PASS |
| set | main2 | move:set | move:set | PASS |
| monster zone two | main2 | move:monster | move:monster | PASS |
| set in trap zone one | main2 | move:spell-trap | move:spell-trap | PASS |
| Dark Magician to spell zone three | main2 | move:spell-trap | move:spell-trap | PASS |
| extra monster zone left | main2 | move:extra-monster | move:extra-monster | PASS |
| graveyard | main2 | move:graveyard | move:graveyard | PASS |
| defense position | main2 | move:defense | move:defense | PASS |
| attack position | main2 | move:attack | move:attack | PASS |
| Blue-Eyes attacks Dark Magician | main2 | attack:unique | attack:unique | PASS |
| direct attack on Alice | main2 | attack:unique | attack:unique | PASS |
| Blue Ice attacks Dark Magician | main2 | attack:unique | attack:unique | PASS |
| Alice minus five hundred | main2 | lp:0:-500 | lp:0:-500 | PASS |
| I gain one thousand | main2 | lp:1:1000 | lp:1:1000 | PASS |
| pay 800 LP | main2 | lp:1:-800 | lp:1:-800 | PASS |
| Bob 500 LP | main2 | lp:1:-500 | lp:1:-500 | PASS |
| main phase | in Battle | phase:main2 | phase:main2 | PASS |
| main phase | after Battle | phase:main2 | phase:main2 | PASS |
| main phase | after back to Main 1 | phase:main2 | phase:main2 | PASS |
| main phase | End, Battle skipped | phase:main1 | phase:main1 | PASS |
| go back a phase | at Draw | none | none | PASS |
| previous phase | opening turn | phase:main1 | phase:main1 | PASS |
| Please go to the main phase! | standby | phase:main1 | phase:main1 | PASS |
| set phase to main two | main2 | phase:main2 | phase:main2 | PASS |
| main 1 phase | main2 | phase:main1 | phase:main1 | PASS |
| move to main phase | standby | phase:main1 | phase:main1 | PASS |
| move to battle phase | main2 | phase:battle | phase:battle | PASS |
| phase main one | main2 | phase:main1 | phase:main1 | PASS |
| phase battle | main2 | phase:battle | phase:battle | PASS |
| go back to main phase | end | phase:main1 | phase:main1 | PASS |

Reducer checks passed: same-turn phase back, Undo restoration/expiry, actor restrictions, pending attacks, opening-turn Battle skip, next-turn history reset, deterministic event replay. Tray precedence and suggestion helper checks passed.

Shared and web typechecks passed with Node 22.23.3. Existing targeted tests: 12 shared remote foundation/solo tests and 1 web activation grammar test passed. No test files added or modified. No services or ports were started or stopped.

UI integration contract:

- Phase back: `phase.set` with `actorSeat` equal to `state.turnSeat` and an earlier phase ID. `previousYgoPhase(state)` returns the previous available phase or `null` at Draw. The normal action bus supplies idempotency/time metadata and the existing five-second Undo applies.
- Unrecognized speech returns `{ kind: "none" }`; `suggestCommands(transcript, context)` provides three labels for explicit user picks, never automatic execution.
- Legacy snapshots without Battle-entry history infer it from their current phase. Newly reduced turns preserve actual Battle entry across same-turn corrections and reset it on passing; Undo restores the previous history.
