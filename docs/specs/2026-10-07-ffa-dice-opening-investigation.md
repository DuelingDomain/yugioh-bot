# FFA dice opening: investigation

Base: `origin/main` at `25665eda`. Branch: `feat/ffa-dice-opening`.

## Result

The full roll order cannot work in FFA4 with the current public seats, facing pairs, and core. Use the task's investigation stop rule. No production code, core, WASM, bundle version, or UI change is made.

This result keeps the current player seats and facing partners. Moving players to new public seats before each game is a possible different approach. It changes who faces whom. The owner has not selected that approach.

## Current opening and start

- `packages/shared/src/duels/opening.ts` has `rps`, `choose`, and `start` phases. The pick window is 30 s. The reveal time is 3 s. A 1v1 choice can swap seats, so the first player takes seat 0.
- `packages/shared/src/services/duels.ts` stores the state in `opening_json`. `room()` builds the opening view for players and spectators. `startOpeningTx` accepts only 1v1.
- `packages/duel-server/src/host.ts` uses `beginGame`, `driveOpening`, and `startGame`. With RPS enabled, only game 1 of 1v1 uses the opening. FFA3, FFA4, and Tag start at once. The opening operations accept player picks or a first/second choice; they do not roll dice.
- `startGame` passes decks to the worker in seat order. `EngineGameOptions`, `workerCreateOptions`, and the core start API have no first-seat or turn-order input. Recovery and replay use the same seat order.
- `packages/shared/src/services/duels.ts` refuses `bestOf: 3` for non-1v1 tables. `duel-series.ts` stores two players and creates two-seat games. FFA series do not exist in this base.

## Core checks

The existing prepare script applied all 98 patches to the pinned core source. No core was compiled. These are the resulting rules:

1. `processor.cpp`, `Startup`: the first turn is engine seat 0.
2. `field.h`, `next_in_turn_order`: the next living seat is the next numeric seat, with wraparound.
3. `field.h`, `across_of`: FFA4 pairs are engine seats 0/1 and 2/3. Patch `0105-ffa4-adjacent-shared-zones.patch` fixes this relation. Shared EMZ, Link arrows, and columns use it.
4. `field.cpp`, `column_peer_of`: FFA3 can use a selected opponent for approved activated column effects with three living players. With two, it uses the remaining opponent. Other formats use `across_of`. General opponent selection in FFA4 does not replace its physical facing pair for column queries.
5. `libdebug.cpp`, `SetupDuelists`: the inputs set the number of players and their teams. They do not set turn order. `SetPlayerInfo` sets LP and draw counts. `ReloadFieldBegin` clears the duel. The Lua turn APIs read the turn; they do not set it. The [pinned core start API](https://raw.githubusercontent.com/edo9300/ygopro-core/efc21aa433b88cd35b7c37db4072a35c58d9d435/ocgapi.cpp) queues the startup processor without a first-seat argument.

### Seat mapping

Let `map[engineSeat]` be the unchanged public seat. Mapping dice ranks to engine seats gives the requested turn order. In FFA3, all six orders can use this map because EMZ and Link fields are separate. Prompts, answers, card controllers, views, clocks, elimination, saved setup, recovery, and replay would also need the map.

In FFA4, the resulting facing pairs are `map[0]/map[1]` and `map[2]/map[3]`. Only 8 of the 24 possible roll orders keep the current pairs. For example, roll order `2,0,3,1` makes public seats 2/0 and 3/1 share zones. A client seat map cannot correct the core's EMZ checks or column queries.

### First-player fallback

A clockwise rotation can choose any first player in FFA3. In FFA4, only rotations that start at seat 0 or 2 keep the current facing pairs. Starting at seat 1 or 3 changes those pairs. A different map can keep the pairs and start with either seat, but changes later clockwise turns. Thus the fallback does not work for both formats with all current rules kept.

A startup script with `EFFECT_SKIP_TURN` is not a valid replacement. The core increments global and per-player turn counts and sends the new-turn event before it checks that effect. It also resets phases and raises the turn-end event. FFA battle limits use the per-player counts, so skipped opening turns can permit battle too early. The normal first-turn draw check also sees the skipped turns; the chosen Standard opener can draw when it should not.

## Options

| Approach | Result |
| --- | --- |
| Set turn order in the core, with public seats kept | Supports all roll orders and keeps facing pairs. Requires the forbidden core/WASM change and bundle compatibility work. |
| Move players to public seats in roll order before each game | Supports all roll orders with the existing core. Changes facing partners. Needs a product decision and seat/view remapping. |
| Map ranks to engine seats with public seats kept | Works for FFA3. Changes FFA4 zone and column relations for 16 of 24 orders. |
| Choose only the first player, then keep clockwise turns | Works for FFA3. Cannot start every FFA4 seat while keeping its current facing pairs. |

## View shape for later work

No new view type is added. If the limits above are resolved, a proposed dice view is:

```ts
{
  phase: "dice" | "start";
  round: number;
  serverNow: number;
  deadlineAt: string; // End of the current 3 s reveal.
  rounds: Array<{ round: number; rolls: Array<number | null> }>;
  order: number[] | null; // Final public seats, highest rank first.
}
```

Each `rolls` array has one entry per public seat. A value is 1 to 6; `null` means that seat did not roll in a tie round. Each tied rank group must be resolved within its original rank. Re-rolls must not compare separate tied groups. `order` stays null until all ranks are unique. Players, bots, and spectators receive the same public rounds. The server would use `crypto.randomInt(1, 7)`, reveal each round for 3 s, and start at the last reveal deadline. Each new FFA game would create fresh state. Existing 1v1 and Tag behavior would stay the same.

## Validation

Run with Node 22.23.3:

```sh
prlimit --core=0 node --test docs/specs/ffa-dice-seat-mapping.test.mjs
```

All four investigation tests passed. They enumerate seat maps and check the FFA4 pair and clockwise constraints. They do not test a dice state machine or a running engine. Feature and host tests were not added because implementation stopped. Real host tests for a future implementation need the built multi cores and card data; CI provides those resources.

## Open questions

1. May players move to new public seats, and get new facing partners, before each FFA game?
2. If seats and facing partners must stay fixed, can the no-core-change limit be removed?
3. Is FFA series support a separate feature? The current series model only supports 1v1.
