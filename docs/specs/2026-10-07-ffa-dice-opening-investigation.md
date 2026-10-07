# FFA dice opening: investigation

Base: `origin/main` at `25665eda`. Branch: `feat/ffa-dice-opening`.

## Chosen approach

The owner selected option 2: move players to public seats in dice rank order before the game starts. Rank 1 takes seat 0, rank 2 takes seat 1, and so on. FFA4 facing partners can change. The existing core then starts seat 0 and advances through the numeric seats. No core, WASM, or bundle version change is needed.

The implementation applies only to FFA3 and FFA4. Every new FFA game rolls again. The 1v1 RPS opening and Tag start behavior stay the same. Series remain 1v1 only.

## Opening and start

- The shared dice state records all rounds in `opening_json`. Rolls keep the original lobby seat indices. Rank groups split by descending d6 values; only groups with more than one seat roll again. Groups never cross their earlier rank.
- The server service uses `crypto.randomInt(1, 7)`. The pure shared rules require a die source, so browser imports do not load Node crypto.
- The first round is rolled when Start is accepted. Each round stays in the `dice` phase for 3 seconds. The final order can be visible during the final reveal. At its deadline the service changes to `start` and moves the seats in one transaction. A late tie step gives the new round a full 3-second reveal.
- The host schedules each deadline and starts the duel after the final seat move. Room reads and the sweep can finish an overdue opening after a lost timer or host restart. A failed table start clears the opening and keeps the moved seats; another Start makes fresh rolls.
- Players, bots, and spectators receive the same public dice view. The opening screen shows plain roll, order, seat, and countdown text. A separate UI task will add the real dice screen.

## Seat audit

| Seat-bound data | Handling |
| --- | --- |
| Player/session seats, ready flags, bot flags, decks | Move complete `duel_seats` rows through a temporary range in the same transaction. Player IDs and organizer ID remain stable. Decks have no separate seat-keyed link table. |
| Stored clocks | Move `remainingMs` and `activeSeat` to the new seats. The host creates the game clock after the move. |
| Saved setup | Move `botPolicies` keys and `surrenderedSeats`. Other setup fields have no seat index. Scenario startup scripts stay on the existing preset path, which creates an active scenario directly and does not use the lobby dice opening. |
| WebSocket tokens | The room hook depends on `mySeat`. A moved seat closes the old subscription and requests a new token from `/connection`, which reads the moved row. |
| Presence | Fresh tokens carry the new seat. The WS renewal handler replaces that player's seat in its occupancy map. Sidebar observers never count as occupants. |
| Bot actions and elimination | Host actions use the moved session rows. Bot answers, surrender, elimination, and results use the final public seat. No active game exists before the move. |
| Recovery and replay | Saved decks, seed, setup, and subsequent command seats all use the final public order. Recovery needs no engine/public seat map. Tests cover these inputs; real worker start, recovery, and replay tests are added for CI. |

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
| Move players to public seats in roll order before each game | Supports all roll orders with the existing core. Changes facing partners. Selected by the owner. The service moves public seats and publishes the mapping. |
| Map ranks to engine seats with public seats kept | Works for FFA3. Changes FFA4 zone and column relations for 16 of 24 orders. |
| Choose only the first player, then keep clockwise turns | Works for FFA3. Cannot start every FFA4 seat while keeping its current facing pairs. |

## Dice view

`DuelOpeningView` is a union of the unchanged RPS view and `DuelDiceOpeningView`:

```ts
{
  phase: "dice" | "start";
  round: number;
  serverNow: number;
  deadlineAt: string; // End of the current 3-second reveal.
  rounds: Array<{ round: number; rolls: Array<number | null> }>;
  order: number[] | null; // Rank -> original lobby seat.
  finalSeats: number[] | null; // Original lobby seat -> public seat after the move.
}
```

For example, `order: [2, 0, 1]` gives `finalSeats: [1, 2, 0]`. The player who rolled in lobby seat 2 moves to public seat 0. Every `rolls` array stays indexed by the original lobby seat. `null` means that player did not roll in that tie round. Both order fields stay null until all ranks are resolved.

## Validation

All local tests use Node 22.23.3 and `prlimit --core=0`. Only targeted files run. No web build or service port is used.

- Shared tests cover two-seat ties inside FFA, a three-way tie, two tied pairs, final order, reveal deadlines, public views, seat rows, bots, decks, clocks, setup, restart inputs, results, repeated settlement, and transaction rollback.
- New host unit tests cover FFA3/FFA4 starts with the rolled player in seat 0, tie reveals, missing timers, bot seat moves, fresh rolls after failure, and unchanged Tag behavior.
- Existing host fixtures use a test helper to finish the dice reveal before their active-game checks. Their deterministic rolls preserve their original seat fixtures. Local fake-worker tests use an isolated temporary resource fixture with core availability marker files; they do not run a WASM engine.
- New real worker tests cover FFA3/FFA4 initial hands, the first prompt, recovery, and replay. They use the repository core gate. The coordinator confirmed that both pass with the main repository's cores selected through `DUEL_DATA_DIR`. They must run in CI with `DUEL_REQUIRE_CORES=1`.
- Client tests cover plain dice text, spectators, all player names, token re-issue after the move, and the socket reconnect. WS tests cover presence after a moved-seat renewal. Existing RPS tests remain in the targeted set.
- Browser fixtures that require fixed seats seed an ordered dice opening in the isolated Playwright database when the browser sends Start. They keep the real 3-second reveal. Four unit tests cover FFA3, FFA4, Tag, and 1v1. Browser tests did not run.
- The initial targeted results are 114 shared, 178 host, 62 client/route, 5 WS presence, and 4 browser-fixture unit tests passed: 363 total. Both new real-core tests also pass with the main repository's cores through `DUEL_DATA_DIR` (coordinator validation). Five existing real-core coin tests were outside the selected fake-worker test name.
- Shared, duel-server, web, WS, and E2E type checks passed. The obsolete standalone `.mjs` seat-mapping proof is removed.

The six review findings are covered by follow-up changes: dice ties stop after 10 rounds and remaining tied ranks use a crypto-random shuffle; the plain RPS settler rejects dice with a clear error; seat moves check row counts and roll back on skipped rows; host fixtures reset descending rolls after each opening; and opening names use seat numbers. Follow-up checks passed: 31 shared, 8 host, 43 client, and 5 browser-fixture tests (87 total), plus shared, duel-server, web, and E2E type checks. The 16 existing real-core multiplayer-stack cases skipped because this worktree has no engine bundle.

The CI-ready `packages/e2e/tests/duel-dice-opening.spec.ts` uses rolls `[1, 6, 3]`, checks the moved players' private hands and public names, and uses the winning player's seat-0 prompt to summon a card. Its fixture unit test passes and Playwright discovers it in slot 2. The browser test was not run locally: this worktree has no prepared web build or engine resources, so starting the stack is not cheap.

## Open questions

None for this implementation. The owner approved changing FFA4 facing partners. FFA series and the full dice screen are separate tasks.
