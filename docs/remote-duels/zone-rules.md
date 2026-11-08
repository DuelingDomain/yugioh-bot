# Remote Duels zone rules

The zone is **legal by card type** by default. A card that the camera sees in a row its type does not allow goes to the nearest free legal zone of the same column (M3 → S3, EMZ1 → M2). The action log says why ("Infinite Impermanence: Trap → S3"). There is no prompt. Only cards whose facts allow the other row are exceptions. An exception card in an odd spot stays where the camera saw it and gets "Check zone?" (the reason is in the card popup).

Card facts come from one resolver (`/api/cards/resolve`): the EDOPro engine `cards.cdb` type bits first (Spell/Trap subtype, a Trap with a Level is a Trap Monster, Link), then our catalog row, then the card database API. Face-down cards keep their row: the camera cannot see their type.

## Rules

| Card | Legal zones | Seen elsewhere |
| --- | --- | --- |
| Any card in GY, Banished, Deck, Extra | That pile | — |
| Field Spell | FIELD | → FIELD; when FIELD is taken: S/T, "Check zone?" |
| Spell, Trap | S/T | → S/T, same column |
| Trap Monster (cdb Trap with a Level, or "Special Summon this card as a … Monster") | S/T, M | EMZ → M |
| Monster | M | S/T or FIELD → M, same column |
| Extra Deck or Pendulum Monster | M, EMZ | — |
| Link Monster | M, EMZ | → M |
| Main Deck monster | M | EMZ → M (EMZ1 → M2, EMZ2 → M4) |
| Monster Set as a Spell by its text (Artifact, Crystal Beast) | M, S/T | — |
| Card logic: a monster that equips itself (Union, Agnumday-style Link/Fusion) or a monster that an Equip effect on your field equips | M, S/T face-up | face-down in S/T: "Check zone?" |
| Pendulum Monster | M, S1/S5 (scales) | S2–S4: kept, "Check zone?" |

A face-up monster with none of these reasons (a plain monster) seen in S/T is not kept there. It moves to the same column in M and the table offers "Zones look shifted — Recalibrate?" at once, because the whole zone grid is probably one row off (PR #535 kept such a card in S/T with "Check zone?").

**Card logic** comes from the engine data, not from card text: `packages/duel-server/scripts/build-card-logic.ts` reads `cards.cdb` (Union type bit) and the card scripts (`Duel.Equip`, `EquipByEffect*`, `Duel.GetControl`, `SwapControl`, `CATEGORY_CONTROL`, "Special Summon from a Graveyard") and writes `packages/web/src/lib/remote/card-logic-data.ts` (card ids only, about 4 KB). Run it again after an engine data update. A card that is not in a list is plain. The card text rules stay as a fallback for cards the lists do not know.

When the target zone is taken, the card goes to the nearest free zone in that row. When the row is full, the player chooses. A card that the camera sees now and that is in an illegal row on the board (from before) is moved the same way. Cards moved by hand on the board are the player's choice: they are not moved, and the manual move only shows a warning.

**Grid check.** When the card type contradicts the camera row for 2 or more cards within 2 minutes, the zones are probably shifted by one row. The watcher shows one hint, "Zones look shifted — Recalibrate?", with a Recalibrate button.

## Links and occupancy

- **Trap Monster.** A Trap with Trap Monster text that moves from S/T zone N to an M or EMZ zone keeps S/T zone N occupied (`trapZone: N` on the card). Other Traps hold nothing (they only get "Check zone?"). The board draws "S<N> · TRAP MONSTER <card>" in that zone. The reducer refuses another card there (Pendulum Zone 1/2 = S1/S5), and an Undo that would put a hold onto a used zone (or a card onto a held zone) is refused. The link goes when the card leaves the Monster Zones.
- **Equip.** The card inspector has "Equipped to" for your face-up S/T cards (`equippedTo` on the card). The board shows the link on both cards. The link goes when either card leaves the field.

- **Control change.** A card revived from an opponent's Graveyard, or taken from an opponent's field, ends on the taker's side. `twin.control` moves the twin card to the other seat and marks it `ownerSeat` (its owner). The card menu has "Take control" (an opponent's monster or Graveyard card) and "Return control" (a card with `ownerSeat`). When an activated card is known to revive from a Graveyard (Monster Reborn) or to take control (Snatch Steal, Change of Heart), the table asks "Revive from which Graveyard?" or "Take control of which monster?" and lists the opponents' cards. The player picks; nothing is guessed. A card with `ownerSeat` that goes to the GY or banished, or leaves the field, returns to its owner's pile. It is never flagged as "not in your decklist", and the opponents' public cards are priors for the camera reader.
- **Equip by card logic.** A self-equip monster seen face-up in S/T is linked to the only monster on the table; with more than one monster the table shows a notice and the player picks "Equipped to".

## Pile exits

A card X that the camera sees on the field while X is in that seat's GY or banished pile is a move from the pile, never a 2nd copy, when the pile shows that X left:

- the pile outline is gone (missing pile), or
- a hand was over the pile at most 2.5 s before the read ended (any pile card: a revive can take a card from under the top; this is the old rule), or
- X is the pile **top** and a hand was over the pile from 10 s before to 1 s after X showed on the field (slow CPU reads), or X is the top and the top the camera saw changed.

A deeper X with only an older touch stays in the pile: the new card is a 2nd copy. With no sign at all (for example, a 2nd Ash Blossom from the hand), the card is a new copy. Limit: when X is the pile top and a hand put a card on that pile less than 10 s before, a 2nd X from the hand can be read as the pile X. Undo fixes it, and re-sync does not redo it.

## Board re-sync

Every 4 s on GPU and 8 s on CPU the watcher compares what the last full detector pass saw (on CPU it can be some seconds old) with the board and fixes what differs: a known card in a different zone moves (rules above), a field copy X plus a pile X with a pile-exit sign merge into the field card, and a known card that the board does not show is placed again. Cards that leave the camera view are removed by the "out of view is gone" rule, not by re-sync.

- Each fix is its own undoable action. The log gets one note, "Board re-synced (n changes)", that is not an undo step, so Undo reverts the last fix.
- A card that the player moved by hand or touched with an Undo stays as the player left it until the camera shows a new physical change of that card.
- Each fix is tried once per board state. When the board changes, a fix can run again.
- A refused write is logged only (no notice, no Retry banner); the other fixes continue, and the next cycle tries it again (3 times at most).
- No prompts. "Scan field" in the camera bar forces a full detector pass, waits for it (3 s at most) and then runs the same check ("Scanning…").

## Examples

1. **Ghost Belle, GY → S2.** Ghost Belle is the GY top. The player lifts it (hand over the GY) and puts it in S2. The read finishes 4 s later on CPU. The GY ref moves out of the GY; Ghost Belle is a monster with no equip or Set text, so it goes to M2 ("Monster → M2"). A 2nd Belle from the hand 3 s after a card was sent on top of a deeper Belle is a new copy.
2. **Infinite Impermanence seen in M3.** A normal Trap: it goes to S3 ("Trap → S3").
3. **Artifact Lancea, Set in S3.** Face-down: stays in S3. Revealed: Artifact text says "Set this card … Spell & Trap Zone as a Spell", so it stays in S3 with no mark.
4. **Union equip.** A Union monster (or a monster that an Equip effect on your field equips) in S2 face-up stays in S2. The player can set "Equipped to" in the inspector.
5. **Odion, Trap Monster from S3.** Embodiment of Apophis is activated in S3 and goes to M3. It stays in M3 (Trap Monster text), and S3 shows "Occupied by Embodiment of Apophis (Trap Monster)" until it leaves the field.
6. **Field Spell in S1.** A face-up Field Spell seen in S1 moves to FIELD ("Field Spell → Field Zone"). When FIELD is taken, it stays in S1 with "Check zone?".
