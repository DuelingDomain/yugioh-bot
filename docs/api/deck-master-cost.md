# Deck Master LP cost

Domain duel views expose the current cost in `engine.seats[seat].deckMaster`:

```ts
deckMaster?: {
  card: DuelCardInfo;
  inZone: boolean;
  returns: number;
  nextCost: number;
}
```

This state is public. Each player and spectator receives the same Deck Master
state for each seat. Standard games omit it. `card` identifies the Deck Master.
`inZone` is true while the card is in the Deck Master Zone (DMZ). `returns` is the
number of completed returns to the DMZ. `nextCost` is the LP cost of the next
summon, monster set, or pendulum activation from that zone. It equals
`returns * 500`: the first action costs 0 LP, the second costs 500 LP, and the
third costs 1000 LP. The counter persists when the card leaves the DMZ.

For example, after the first return:

```json
{
  "inZone": true,
  "returns": 1,
  "nextCost": 500
}
```

The example omits `card`. A client can show `Summon: costs 500 LP` beside the
public DMZ card before the player chooses an action. Show this cost when
`inZone` is true. A summon from the hand or another zone does not pay the DMZ
cost. Each Tag seat has its own counter; payment uses the team's LP pool.

`SELECT_IDLECMD` options for DMZ normal summons, special summons, monster sets,
and pendulum activations include `(costs N LP)` in `label`. Their `location`
is `0x4000`. The server restores this location because the core message uses a
one-byte location field. Option IDs and response indices stay the same.
The displayed amount is the DMZ cost. Other card costs can also apply.

The recall prompt uses `context.type = "deck-master-recall"`. Its `returns`
value is the count before the player accepts the return. Its `nextCost` is
`(returns + 1) * 500`, the cost after that return. Its `description` says
`Next summon or activation from the Deck Master Zone costs N LP.` Returning
the card does not deduct LP.

The core checks and pays the cost. The action is not offered when the player
cannot pay it. Spell Economics does not waive this action cost. The view is
information for the client; the client must not deduct LP itself.

The rule source is the Deck Master section of Domain Format Rulebook v1.4,
commit `adc1594fc`, including “Cost to summon”. No UI change is included here.

## Core and bundle impact

This change does not change core source, patch inputs, core pins, or the engine
bundle version. The existing Domain cores deduct the required LP and enforce
affordability. Fresh legacy and pinned 1v1 builds retain their installed hashes.
The multiplayer builds use the current patch series and fixed Lua seed from
`build-domain-core.ts`; their test artifacts are not a bundle release.

A bundle version bump is not needed for this server prompt change. Do not
publish the local test builds as a new engine bundle without owner approval.
