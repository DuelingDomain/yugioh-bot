# Three directions for the duel field

Made with the impeccable skill (direction seed `8cbb21d7`, mode: operate, code-led because no image generation is available). All three keep the pinned items in `BRIEF.md`: Nexus layout, bottom phase bar, side panels, and the Obsidian palette. They differ in how the duel is *told*: its information model, interaction, and motion.

## Grounded list (Yu-Gi-Oh players' own world, ordered by resonance)

1. Solid Vision: the anime duel-disk hologram projection. → **Concept B (pick)**
2. The printed card frame as a notation system (frame colours, level stars, attribute seals, the ATK/DEF line).
3. The tournament playmat and its tools (rubber mat, sleeves, the LP calculator, dice).
4. The Battle City broadcast (stadium screens, LP ticker).
5. The Master Duel 3D arena.
6. The judge's match sheet and the pen-and-paper LP tally with strike-throughs. → **Concept A (assigned by the roll)**
7. Binder pages and sleeve collections.

## Challenger verdicts (fused with product facts; judged on audience identification and product clarity)

| Challenger | Verdict | What it gives |
|---|---|---|
| Darkroom under safelight | Competitive (wins clarity) | → **Concept C**: phases as fixed stations, and a preview before every irreversible act |
| Boarding pass + gate board | Competitive (wins clarity) | Held in the re-roll pool: the chain reranks in place, and a change stays lit until it is noticed |
| Emigre bitmap specimen | Declined | Raise to A: a strict numeral size ladder |
| CRT arcade | Declined | Raise to A: state colour is law |
| Sneaker box wall | Declined | Raise to A: piles pull halfway out before they open |
| Mesophotic deep dive | Declined | Raise to A: the active phase owns the only lit band |

---

## A — Match Sheet (assigned)

**Thesis.** The duel is an official record that writes itself live. Locals players track LP on paper and strike through the old values, and judges keep match slips. This concept refuses the default of floating LP numbers plus toast pop-ups: every event is written as a gold-ink line, and LP is a tally where old values are struck through, not replaced.

**Own world.** Obsidian ground with gold hairline rules like a ruled sheet. Purple is the active player's pen.

**Signature.** The LP tally strike-through. The old value is struck by an ink line, the new value is written below it, and the reason goes in the margin ("−4000 · Solemn Judgment").

**Raises from declined challengers:**
- Numeral ladder (bitmap specimen): one numeral face at exactly four sizes.
- Colour law (arcade): purple = your legal action, gold = chain and response, red = only LP loss and destruction.
- Pull-halfway piles (sneaker wall): GY, Banished, and Extra slide half out with the top 3 cards fanned, before the full grid opens.
- One lit band (deep dive): only the current phase row is lit, and the board's gold rules dim on the opponent's turn.

**Risk.** It could read as quiet next to B. Its spectacle is in the ink, not in 3D.

## B — Solid Vision (pick: top of the grounded list)

**Thesis.** The field is a duel-disk projection. Cards lie flat and readable on a slightly tilted obsidian table. At big moments, monsters project into the space above their card, then settle back. It refuses both extremes: a flat web table where nothing ever stands up, and a full 3D board that loses readability.

**Own world.** A three.js layer over a DOM board. Gold projector rings form in the zones, and a purple projection light marks active states.

**Signature.** The Deck Master summon. Dark Magician leaves the dock, rings of gold light form in MZ 3, and the art rises as a projection for about 1 s, then settles.

**Risk.** It is familiar: the anime and Master Duel are nearby. WebGL cost on phones needs a reduced fallback, and the tilt can make the far row harder to read.

## C — Safelight Stations (fused challenger: darkroom)

**Thesis.** A turn is a fixed row of stations. You always know which station you are at, what you can do there, and what the next step is. You see a preview (a "test strip") of every irreversible act before you commit to it. It refuses the default of invisible phases, where players press BP and hope.

**Own world (translated to the pinned Obsidian palette).** The safelight becomes the purple light that lights only the current station. The phase bar becomes a track of 6 stations and offers the next legal step as the main action. Summons "develop": the card rises out of black into full art, like a print in the developer tray.

**Signature.** The test strip. When you focus an attack target or a response, a strip under it shows before → after ("Battle Ox destroyed · LP 8000 → 7200"), marked as a preview.

**Risk.** Previews must be engine-truthful. Show them only where the outcome is certain (battle damage, costs, a known effect), and label them.
