# Duel pace: readable activations

Owner report: duel animations are too fast to follow, trap cards most of all. Trap Hole answering a
summon "just happens". Each step (what was activated, by whom, what it did) has to register.

All numbers are measured in the FX lab (`/dev/fx-lab#pace-*`, the real board and effects with a scripted
engine) at 1x, ms from the start of the scenario, from timestamps logged where each piece actually
starts (chain pump, banner queue, activation ghost, move plans, destroy scene). The lab scenarios are in
`fx-lab/pace-scenarios.ts` and follow the server event order.

## Root cause

1. **The activation had no beat of its own.** The chain's activate beat was 950 ms
   (`CHAIN_TIMING.activateMs`, `duel-timing.ts`), of which the card turning over took ~320 ms, so a set
   trap's face was readable for ~610 ms before the link was already "resolving". The `Activate` banner was
   2000 ms (`BANNER_TIMING.activateMs`, `duel-timing.ts`), about twice the beat, so it was still up while
   the link resolved and the monster broke under it, and the viewer's eye was on the wrong thing.
2. **The Trap Hole set piece was the shortest in the game.** The pit opened in 250 ms and broke the monster
   at 300 ms (`TRAP_HOLE_OPEN_MS`, `fx3d/scene-plan.ts:168`). The "destroy" lasted a blink.
3. **A trap sprang before the summon it answered had landed.** The server sends the summon and the trap
   in one batch. The `activate` branch of `effect-sequence.ts` had no gate on the earlier landings, so the
   trap flipped ~120 ms in while the summon landed at ~670 ms.
4. **A backlog squeezed the readable beats.** `chainStepDelay` (`chain-state.ts`) pushed every beat to
   `floorMs` (320 ms) over `backlogBeats`, and `pacedCueDuration` (`event-queue.ts`) squeezed banners to
   `minCueMs`/half length. Activation and resolution got the same floor as "link cleared". The banner queue
   also drifts from the chain clock, so in a long chain activation banners lagged the chain.

## Changes

- One activation length, `ACTIVATION_BEAT_MS` = 320 ms flip + 850 ms face hold = 1170 ms, shared by the
  ghost (`CARD_FX.activationMs`), the chain's activate beat and the activate banner. The banner ends exactly
  as its link starts to resolve (`activationEndAt` in `chain-beats.ts`; `feedback.tsx` caps the banner there
  and drops one that would be shorter than `minCueMs`; the badge and chain list already announced it).
- `CHAIN_TIMING.readableFloorMs` (activate 700, resolving 520, negated 700): a backlog squeezes link-cleared
  and chain-end beats to `floorMs` but not these, in `chainStepDelay` and `pacedCueDuration`.
- `effectLeadMs` 440 to 500: the effect starts after the "is resolving" label has been read.
- `effect-sequence.ts`: a spell or trap that answers a summon or set in the same batch waits for that card to
  land. Cards that landed in earlier batches never delay it.
- Set pieces: pit open 250 to 600 (`TRAP_HOLE_OPEN_MS`), bottomless 450 to 600, trap glyph 380 to 520, spell
  sigil 350 to 500, monster travel 360 to 480. Their sound cues moved with them.
- Reduced motion: activation banner 960 ms (was 1500); the ghost keeps its 0.4 flip split and a 0.25 fade.
- Not touched: placing a card, phase changes, zone prompts (#121), explicit chain links and the left chain
  list (#122). The player's own summons and sets take the same time as before.

## Before and after (1x)

"Face readable" is the time the face-up card is on screen before its link starts to resolve. "Overlap" is
how long the Activate banner is on screen together with the effect/destroy piece.

| Scenario | Metric | Before | After |
| --- | --- | --- | --- |
| Trap Hole, summon then trap 1.5 s later | trap flips | 1567 | 1546 |
| | face readable before resolving | ~610 ms (beat 932) | ~830 ms (beat 1151) |
| | Activate banner | 1567 to 3567 (2000) | 1545 to 2697 (1152) |
| | link starts to resolve | 2499 | 2697 |
| | destroy piece starts | 2938 | 3198 |
| | monster breaks | 3238 (300 ms into the piece) | 3848 (650 ms into the piece) |
| | banner/destroy overlap | 629 ms | 0 (500 ms gap) |
| | chain over | 4958 | 5567 (+609) |
| Trap Hole, same batch as the summon | summon lands | 673 | 709 |
| | trap flips | 125 (summon still in flight) | 720 (after it lands) |
| | link starts to resolve | 1062 | 1886 |
| | monster breaks | 1802 | 3029 |
| | chain over | 3522 | 4749 (+1227) |
| Quick-play Mystical Space Typhoon | activate | 716 | 718 |
| | Activate banner | 701 to 2701 | 706 to 1876 |
| | link starts to resolve | 1651 (beat 935) | 1876 (beat 1158) |
| | destroy piece starts | 2091 | 2375 |
| | target breaks | 2491 | 2925 |
| | banner/destroy overlap | 610 ms | 0 |
| | chain over | 4211 | 4646 (+435) |
| Normal spell Pot of Greed | activate | 705 | 726 |
| | Activate banner | 752 to 2752 | 712 to 1882 |
| | link starts to resolve | 1655 (beat 950) | 1882 (beat 1156) |
| | first draw starts | 2061 | 2338 |
| | banner/draw overlap | 691 ms | 0 |
| | chain over | 3948 | 4236 (+288) |
| Chain of 2 (Trap Hole, Solemn Judgment) | Solemn activates | 4259 | 4244 |
| | link 2 starts to resolve | 5188 (beat 929) | 5401 (beat 1157) |
| | link 1 negated | 8201 | 8416 |
| | destroy piece starts | 8725 | 9142 |
| | chain over | 11143 | 11700 (+557) |

Speed preference, Trap Hole separate batches (activation beat, then wait until the destroy piece starts):

| Setting | Activation beat | Resolving to destroy piece |
| --- | --- | --- |
| 0.5x | 2327 ms | 1000 ms |
| 1x | 1151 ms | 501 ms |
| 2x | 573 ms | 250 ms |
| Reduced motion | 933 ms | 193 ms |

Every beat scales with the speed slider as before.

## Frames

Trap Hole against a summon, after the change (`pace-trap-hole`, each frame is one point in the timeline):

1. `1-flip-banner-arrives.png`: the set trap turns over, the Activate banner fades in.
2. `2-face-held-announced.png`: face up, "Trap Hole is activating", Chain 1 badge, chain list entry.
3. `3-face-still-held.png`: the face is still held, banner still up, nothing resolved yet.
4. `4-link-resolving-no-effect-yet.png`: the banner is gone, "Trap Hole is resolving", the monster is intact.
5. `5-pit-opens.png`: only now the pit opens under the monster.
6. `6-monster-falls.png`: the monster breaks and falls into the pit.
