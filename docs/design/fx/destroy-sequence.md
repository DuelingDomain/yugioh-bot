# Destroy and move sequence

Rule: when an effect hits a card, the card stays on screen in its zone, in its real pose, until its own
break or lift starts. Then the same card breaks (destroy) or lifts and flies (any other move) to its
destination. The zone is never empty before the card leaves, and the card is never shown twice.

The board commits the new engine state at once. The FX layers replay the events after that. So any wait
between "commit" and "the FX shows the card" is a gap where the card is gone.

## Causes

1. **Gap between break and pieces.** The whole-card break (`destroyBreakMs`) and the pieces of the move
   ghost were separated by `destroyFlashMs` (420 ms) in `effect-sequence.ts` and `destroy-fx.tsx`. The zone
   was empty for that time. Now the pieces take over at the break; the flash plays over them.
2. **Hidden card of a face-down destroy.** The server sends the opponent a `destroy` event with no `card`
   for a face-down card. No stand-in was drawn, so a Set card or a face-down Defense monster vanished
   until its move to the Graveyard. `destroy-cards.ts` (`withDestroyCards`) copies the card from the
   nearest move that leaves the same zone (the move is public). The FX layers use it; history and
   feedback keep the raw events.
3. **No stand-in while a move waits.** A non-destroy move from the field (return to Deck, bounce, banish,
   send) waited for its start time with an empty zone. The ghost now mounts at once over the zone, in the
   pose the card had (sleeve or face, Attack or Defense), holds there, and lifts from there
   (`standsInAtSource` in `move-plan.ts`; `delay` in `move-fx.tsx`, `live-flight.ts`, `add-fx.tsx`).
4. **Face-down stand-in showed the face.** The break stand-in always showed the card face. A card that
   lay face-down now shows its sleeve until the cracks start, then its face (`summon-fx.tsx`). This uses
   the existing sleeve art.

No new animation look was added. Only timing and the stand-in pose changed.

## Cases

| Case | Result |
| --- | --- |
| Mystical Space Typhoon on a Set card | Fixed (causes 1, 2, 4) |
| Flip effect destroys a face-down Defense monster | Fixed (causes 1, 2, 4) |
| Effect destroys a face-up Defense monster | Fixed (cause 1) |
| Phoenix Wing Wind Blast (return to Deck top) | Fixed (cause 3) |
| Bounce to hand (style "add", rises from the zone) | Fixed (cause 3) |
| Banish, send, material send (Fusion/Synchro/Xyz/Link) from the field | Fixed (cause 3) |
| Batch with two targets | Fixed, each card keeps its own timing |
| Equip Spell / replaced Field Spell sent by rule | Checked, no gap found |
| Tribute | Checked, no gap found |
| Battle destroy | Checked in a 2D harness, no gap found |
| Discard, mill, draw | Not field departures. Not changed |
| 3D Solid Vision, 3-way, 4-way, Tag | Same code path. Tag, table and lab mounts use `withDestroyCards`. Not checked in a browser |

Tests: `packages/web/tests/components/destroy-sequence.test.tsx` (fake timers, a sample of the overlay every
25 ms: one card shown from the first frame to the landing, never two).

## Not covered

- Reduced motion: stand-ins at the source are not drawn (the card fades). Not changed.
- A bounce that rises from a strip or a pile (not from the zone) keeps its own showcase.
