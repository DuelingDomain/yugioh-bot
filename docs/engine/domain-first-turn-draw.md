# Domain first-turn draw

Domain Format rulebook v1.4 says each player draws on their first turn,
except the first player in a two-player duel.

## Real-engine verification (2026-10-11)

On unmodified host code at `bc8a421ae`, Domain FFA3 and FFA4 both give the
first player six cards after turn 1's Draw Phase: five opening cards plus
one turn draw, leaving 34 of the 40 Main Deck cards. Other players still
have five cards. Each Deck Master is created separately in the Deck Master
Zone and does not reduce the opening hand. Both legacy and pinned Domain
1v1 engines leave the first player's hand at five and deck at 35.

The focused real-engine assertions are in
`packages/duel-server/tests/engine-domain-first-turn-draw.test.ts`. They
check turn 1, the first player, completion of the Draw Phase, hand/deck
counts, Deck Master placement, and the separate turn draw event.

These assertions passed on the installed P98 Domain multi core (SHA256
`51e41ea7e8620b46fbdb5685341d2b20eae224bfb0870aec6fea52c09d15cac4`)
and a fresh build of this branch's full patch series. No draw bug was
reproduced and no core change is needed.

Patch 0015's note that the first-turn draw check was unchanged does not
mean the core always skips the draw. The Turn processor draws when
`is_flag(DUEL_1ST_TURN_DRAW) || infos.turn_id > 1`. The host's
`OcgDuelMode.FIRST_TURN_DRAW` sets that same flag. This check has no
multiplayer exception.

Run from `packages/duel-server`, with built shared and installed cores:

```sh
DUEL_REQUIRE_CORES=1 npx vitest run tests/engine-domain-first-turn-draw.test.ts --testTimeout=30000
```
