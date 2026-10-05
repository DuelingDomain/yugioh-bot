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
| 3D Solid Vision, 3-way, 4-way, Tag | Not the same code path as 2D (see "3D wipes"). Tag, table and lab mounts use `withDestroyCards`. Tested with a mocked canvas, not checked in a browser |

Tests: `packages/web/tests/components/destroy-sequence.test.tsx` (fake timers, a sample of the overlay every
25 ms: one card shown from the first frame to the landing, never two) and
`packages/web/tests/components/destroy-cards.test.ts` (the reason, zone, claim and gap rules of `withDestroyCards`) and
`packages/web/tests/components/destroy-scene.test.tsx` (scene layer, reduced motion: `useFx3d` is mocked and the test checks what
the scene receives).

## 3D wipes

A wipe piece (Feather Duster, Heavy Storm, Raigeki) in 3D goes to the scene layer (`planScene`), not to the 2D
break. Two rules keep the zone right until the scene takes the card:

- A victim that is face-down at the source is sent to the scene with code 0. The canvas then draws the sleeve.
  `withDestroyCards` fills `event.card` for the Graveyard move, so `destroy-fx.tsx` reads the face state from the
  DOM (`[data-card-art]` without an image) and not from the event. The card may turn face-up only at the break or
  the move.
- Each victim gets a wipe ghost (`WipeGhost`) over its zone until `startAt + takeMs`. A face-down victim has no
  image source, so its ghost shows the sleeve art as a CSS background.

## Reduced motion

A "fade" plan under reduced motion (`standsInAtSource` in `move-plan.ts`) now stands in at the source too, destroy
or not. `MoveFx` puts a stand-in on the source zone (opacity 1 from the first frame, the pose and face the card
had, the sleeve for a Set card). It waits there until `startAt` and fades out on the zone while the card fades in
on its pile. The card does not travel, so the reduced-motion rule holds. Before this, the zone was blank for the
whole wait (1650 ms in the MST case) and the card showed on the Graveyard for 100 ms.

## Card of a card-less destroy

The server sends no card in the destroy event for a face-down card. `withDestroyCards` takes the card from the
move to the Graveyard, and only if that move has reason "destroy", has a known card, leaves the same zone, is at most
6 event ids away, and no other destroy has claimed it. A destroy that names its card claims its own move first.
When the match is not clear, the destroy stays card-less and the sleeve shows.

## Caps

`move-fx.tsx` `MAX_GHOSTS` is 48 and `summon-fx.tsx` `MAX_ITEMS` is 44, so a 4-way wipe (up to 40 cards) does not
drop the oldest stand-in and leave a blank zone.

## Not covered

- A Set card that is destroyed in 3D (not a wipe) uses the 2D stand-in with its sleeve until the break. A turn
  from sleeve to face at the break in 3D is a new look and is not built.
- A bounce that rises from a strip or a pile (not from the zone) keeps its own showcase.
