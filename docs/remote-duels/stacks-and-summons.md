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

1. **Under.** A field track with no outline whose last box is overlapped (IoU >= 0.1) by the outline of another live
   track is *under* that track: `track.under = <top id>`, hidden, never removed. The watcher emits `covered` once.
   When the top leaves or moves off, `under` clears and the normal rules apply (seen again = visible; not seen in 2
   scans = removed). An identified track whose look matches an outline wins that outline over a closer track whose
   look does not match (the top card keeps its own ref).
2. **Summon window (glue, 5 s).** The glue keeps, per seat: covered monsters (face-up, M/EMZ) and *vanished* monsters
   (face-up M/EMZ removed events). Vanished cards still go to the hand at once (rule 4); a summon re-routes them.
3. **Xyz Summon.** An Xyz Monster (catalog type) placed in M/EMZ, with 2+ materials (covered under it, or vanished up
   to 5 s before its first outline / 5 s after its placement): `twin.place` carries `summon: {kind:"xyz", materialRefs}`
   (or `twin.attach` when it is already placed). Materials stay twin cards in zone `material` with `materialOf`; the Xyz
   has `materials: ref[]` (refs, not card ids, so copies, names, privacy and Undo keep working). Rank-up: an Xyz used as
   a material brings its own materials. When the Xyz leaves the field or turns face-down, its materials go to the GY
   (in order). `twin.detach` sends one material to the GY (or another pile).
4. **Synchro / Link / Fusion.** Same window; materials go to the GY in the same undoable action (log line
   "Synchro Summon: X + Y → Z (materials to GY)"). Link: at most `link rating` materials (the newest vanished); never
   more than the vanished/covered cards. Synchro/Fusion need 2+, Link 1+.
5. **Default.** Outside a summon, a vanished card goes to the hand as today. A covered card stays on the field.
6. **GY/banished pile.** Each new top (new outline or a changed top look after a hand passed) is read with priority and
   pushed once in order. Idempotent: the same physical top (same look as the known top) is never pushed again. If the
   new top cannot be read in 3 s, the glue pushes an unnamed face-up card ("Unknown card") so the count stays right;
   the player names it later (pile viewer). The board shows the pile count; the pile viewer lists all cards in order.

## Shared state (`packages/shared/src/remote`)

- `TwinCard.materials?: string[]` (Xyz, bottom first), `TwinCard.materialOf?: string`; zone `material` (pile shape,
  public, never a physical slot).
- Actions: `twin.place.summon?`, `twin.attach {cardRef, materialRefs, kind}`, `twin.detach {cardRef, materialRef, zone}`.
  A material must be the actor's card on the field (M/EMZ) or in the hand with `departedFrom` M/EMZ within 30 s.
- One reducer path `applySummon` for place and attach; links are cleaned after each action (like Equip links).

## UI

- Board card: "2 mat." badge. Inspector: list of materials with Detach. Voice: "detach" (selected/only Xyz).
- Debug labels: one short line above the box (`#c-74 M3 id up`), 9px; the reason shows on hover / in a title.

## Tests (lean)

- Fenrir scenario (`packages/vision/src/board.test.ts`): Xyz over two stacked materials (one moved from M4), Temple
  partly covered stays, 3-card GY sequence (Apophis → Temple → Man with the Mark, hands over the pile) count 3, in order.
- Shared reducer test (`preserves slot metadata ...`): Xyz place with materials, rank-up, detach, Xyz leaves → GY,
  Synchro materials to GY, Undo.

## Not in scope

Opponent cards under my cards; Pendulum/Link arrows; material identity reads from under a card.
