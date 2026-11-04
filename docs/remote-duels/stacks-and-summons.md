# Stacks and summons (Remote Duels)

Branch `feat/remote-stack`. Scope: a card on top of a card, on the field and on the GY/banished pile.

## Today (the problem)

- Watcher (`packages/vision/src/field-watcher.ts`): a track with no outline in 2 full scans, no hand and a clear spot is
  removed; the glue moves it to the hand. A covered card is kept only by chance (`spotSeen`: another outline overlaps
  its spot). Worse, the outline of the top card can be matched to the covered track (it is closer). The covered track
  then "changes" identity and the real top card loses its outline and goes to the hand.
- So for an Xyz Summon: the Xyz takes over the material's ref, the other material goes to the hand.
- Temple of the Kings partly covered: kept while the cover's outline overlaps it; else removed after 2 scans.
- GY: a new top is pushed only when a read of it finishes and wins the "is this a lifted/old card" checks. A read that
  fails or is unsure can leave the count low.

## Rules (what we build)

1. **Under.** A field track with no outline is *under* another live track when the top is in the same zone, is
   settled (identified, or still for 300 ms), has about the same size (area ratio 0.6-1.7, not a card held up), covers
   >= 40% of its last box and its centre: `track.under = <top id>`, hidden, never removed. The watcher emits `covered` once.
   When the top leaves or moves off, `under` clears and the normal rules apply (seen again = visible; not seen in 2
   scans = removed). An identified track whose look matches an outline wins that outline over a closer track whose
   look does not match (the top card keeps its own ref). A new outline over a confirmed card that reads as that card,
   or reads not sure but has the same look (other light, a turn), merges back into it: no new ref, no `placed`. A new
   look with an unsure read is a new card (best match). Any battle position.
2. **Summon window (glue, 5 s).** The glue keeps, per seat: covered monsters (face-up, M/EMZ) and *vanished* monsters
   (face-up M/EMZ removed events). Vanished cards still go to the hand at once (rule 4); a summon re-routes them.
3. **Xyz Summon.** An Xyz Monster (catalog type) placed in M/EMZ, with 2+ materials (covered under it, or vanished up
   to 5 s before its first outline / 5 s after its placement): `twin.place` carries `summon: {kind:"xyz", materialRefs}`
   (or `twin.attach` when it is already placed). Materials stay twin cards in zone `material` with `materialOf`; the Xyz
   has `materials: ref[]` (refs, not card ids, so copies, names, privacy and Undo keep working). Rank-up: an Xyz used as
   a material brings its own materials; an Xyz with materials alone is enough (cards in zone `material` are not
   counted alone). A camera lift of the Xyz to the hand keeps its materials for 30 s (it may come back). When the Xyz leaves the field or turns face-down, its materials go to the GY
   (in order). `twin.detach` sends one material to the GY (or another pile).
4. **Synchro / Link / Fusion.** Same window; materials go to the GY in the same undoable action (log line
   "Synchro Summon: X + Y → Z (materials to GY)"). Link: at most `link rating` materials (the newest vanished); never
   more than the vanished/covered cards; no rating = no camera summon. Synchro/Fusion need 2+, Link 1+. A vanished
   card counts only while it is still out of view in the hand. After placement, attach only while below the minimum
   (Xyz: only a card over the Xyz box). Invalid materials in a camera `twin.place` are skipped, not fatal.
5. **Default.** Outside a summon, a vanished card goes to the hand as today. A card moved on top of another card
   waits 5 s for a summon. Then, only if the camera still sees the same stack (nothing on top, the top not moved
   back), the card under it goes to the hand ("Name → hand (covered)") and the top card moves. One Undo reverts both;
   the camera then leaves that stack alone. An Xyz put on the stack later (30 s) still takes the card from the hand.
   An Xyz material put in the GY / banished pile is detached there (no second copy).
6. **GY/banished pile (a log, not a picture).** The camera only confirms the top and adds new tops.
   - Pile lift (`pile.lift`, toast with Undo) only after >= 2 s of sharp frames (blur gate from `feat/remote-detect-fix`
     only), no hand, no outline, and a spot that no longer looks like the pile.
   - A top that looks the same = no change. A lower card seen on top = the cards above it left (existing rule).
   - A top that cannot be read: unsure reads get a best match (as on the field); a low match pushes an unnamed card.
   - A new pile card needs entry evidence (camera running > 2 s, and a hand over the pile from 10 s before, or a sure
     read that differs from the current top); a re-read
     after a restart binds to the current top. An unread "Unknown" top is a log entry too (never renamed by the next).
   - Pile viewer: newer/older (`pile.order`), "Name it" (`card.identified`), "Remove from pile" (`twin.remove`).
     For 3 s after a reorder the camera does not take cards out of that pile.
   Earlier text of this rule: Each new top (new outline or a changed top look after a hand passed) is read with priority and
   pushed once in order. Idempotent: the same physical top (same look as the known top) is never pushed again. If the
   new top cannot be read in 3 s, the glue pushes an unnamed face-up card ("Unknown card") so the count stays right;
   the player names it later (pile viewer). The board shows the pile count; the pile viewer lists all cards in order.

## Shared state (`packages/shared/src/remote`)

- `TwinCard.materials?: string[]` (Xyz, bottom first), `TwinCard.materialOf?: string`; zone `material` (pile shape,
  public, never a physical slot).
- Actions: `twin.place.summon?`, `twin.attach {cardRef, materialRefs, kind}`, `twin.detach {cardRef, materialRef, zone}`,
  `pile.order {zone, cardRefs}` (owner fixes the pile order).
  A material must be the actor's card on the field (M/EMZ) or in the hand with `departedFrom` M/EMZ within 30 s.
- One reducer path `applySummon` for place and attach; links are cleaned after each action (like Equip links).

## UI

- Board card: "2 mat." badge. Inspector: list of materials with Detach. Voice: "detach" detaches the bottom material
  of the only Xyz with materials, or of the named one ("detach material from <name>").
- Debug labels: one short line above the box (`#c-74 M3 id up`), 9px; the reason shows on hover / in a title.

## Tests (lean)

- Fenrir scenario (`packages/vision/src/board.test.ts`): Xyz over two stacked materials (one moved from M4), Temple
  partly covered stays, 3-card GY sequence (Apophis → Temple → Man with the Mark, hands over the pile) count 3, in order.
- Shared reducer test (`preserves slot metadata ...`): Xyz place with materials, rank-up, detach, Xyz leaves → GY,
  Synchro materials to GY, Undo.

## Limits

- A card that turns and also reads sure as a different card is a new card on top (rare: a sure read needs the art).
- A same-zone cover that is not a summon is the default of rule 5.

## Not in scope

Opponent cards under my cards; Pendulum/Link arrows; material identity reads from under a card.
