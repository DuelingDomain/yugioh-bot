# Remote Duels zone rules

The camera shows where the player put a card. The board keeps that zone. Card rules only move a card when the rule is hard. A soft rule never moves a card: it marks the card "Check zone?" (no prompt, no toast).

Card facts come from our card catalog (`type`, `frameType`, `effectText`). Trap Monster text was checked against EDOPro `cards.cdb` (Trap with a Level: 72 cards; the text test "Special Summon this card as a … Monster" finds 73).

## Rules

| Card | Camera zone | Result | Kind |
| --- | --- | --- | --- |
| Any card | GY, Banished, Deck, Extra | That pile | hard |
| Field Spell | not FIELD | FIELD (when FIELD is free) | hard |
| Link Monster | S/T or FIELD | Nearest free M zone | hard |
| Monster | M, EMZ (Extra Deck or Pendulum) | Keep | ok |
| Main Deck monster | EMZ | Keep, "Check zone?" | soft |
| Pendulum Monster | S1 / S5 | Keep (Pendulum Scale) | ok |
| Monster whose own text puts it in S/T (Artifact "Set this card … Spell & Trap Zone", Crystal Beast "place it … as a Continuous Spell") | S/T | Keep (face-down = Set as Spell) | ok |
| Union monster, a monster that equips itself ("equip this card"), or a card on your field that equips monsters ("equip that target to this card") | S/T face-up | Keep (Equip Card) | ok |
| Other monster | S/T | Keep, "Check zone?" | soft |
| Spell / Trap | S/T | Keep | ok |
| Trap Monster text ("Special Summon this card as a … Monster") | M | Keep (Trap Monster) | ok |
| Other Trap, or Spell | M / EMZ | Keep, "Check zone?" | soft |
| Face-down card | any field zone | Keep | ok |

When the camera zone is taken, the card goes to the nearest free zone in the same row (as before). When no zone is free, the player chooses.

## Links and occupancy

- **Trap Monster.** A Trap with Trap Monster text that moves from S/T zone N to an M or EMZ zone keeps S/T zone N occupied (`trapZone: N` on the card). Other Traps hold nothing (they only get "Check zone?"). The board draws "S<N> · TRAP MONSTER <card>" in that zone. The reducer refuses another card there (Pendulum Zone 1/2 = S1/S5), and an Undo that would put a hold onto a used zone (or a card onto a held zone) is refused. The link goes when the card leaves the Monster Zones.
- **Equip.** The card inspector has "Equipped to" for your face-up S/T cards (`equippedTo` on the card). The board shows the link on both cards. The link goes when either card leaves the field.

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

1. **Ghost Belle, GY → S2.** Ghost Belle is the GY top. The player lifts it (hand over the GY) and puts it in S2. The read finishes 4 s later on CPU. The GY ref moves to S2; the GY count drops. Ghost Belle is a monster in S/T with no equip or Set text: it stays in S2 with "Check zone?" (the reason is in the card popup). A 2nd Belle from the hand 3 s after a card was sent on top of a deeper Belle is a new copy.
2. **Artifact Lancea, Set in S3.** Face-down: stays in S3. Revealed: Artifact text says "Set this card … Spell & Trap Zone as a Spell", so it stays in S3 with no mark.
3. **Union equip.** A Union monster (or a monster that an Equip effect on your field equips) in S2 face-up stays in S2. The player can set "Equipped to" in the inspector.
4. **Odion, Trap Monster from S3.** Embodiment of Apophis is activated in S3 and goes to M3. It stays in M3 (Trap Monster text), and S3 shows "Occupied by Embodiment of Apophis (Trap Monster)" until it leaves the field.
5. **Field Spell in S1.** A face-up Field Spell seen in S1 moves to FIELD (hard rule). When FIELD is taken, it stays in S1 with "Check zone?".
