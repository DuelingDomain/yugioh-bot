# Tag shared EMZ UI contract

Owner decision 2026-10-07: p0=1A and p2=1B are the bottom team; p1=2A and p3=2B are the top team. The facing pairs are p0/p1 and p2/p3. Each pair has two physical Extra Monster Zones; the table has four physical EMZ in total.

The new multi and multi-domain bundles advertise `tag-facing-extra-zones` in the binary's `.SOURCE` file. `readCoreCapabilities` checks that file's SHA-256 against the actual loaded WASM. `projectView` then publishes `DuelEngineView.seats[].sharedExtraWith` as `[1,0,3,2]` for Tag, independent of viewer. Older/unmarked/mismatched cores publish null. Existing FFA4 capability remains independent. Eliminated seats and their facing ends publish null.

Snapshots retain one card in its actual controller's `seats[controller].monsters[sequence]`, with sequences 5 and 6 for EMZ. `DuelCard.controller` is the current controller. The snapshot does not expose a separate original-owner field; use controller and sequence for placement. No duplicate card or synthetic zone owner is sent. Place prompt options likewise retain the actual `controller`, `location=4` (MZONE), and `sequence`. `disabledZones` uses per-seat bit masks: bits 5/6 are the EMZ and are already mirrored by the engine.

The UI worker must:

1. Extend `sharedExtraPairs` in `packages/web/src/components/duel/multi-seat.ts` to accept Tag and pass the actual format to `sharedExtraSeatOf`. Use reciprocal `sharedExtraWith` metadata, preserving its existing fallback for old cores and conflicting occupancy.
2. In `packages/web/src/components/duel/tag/tag-stage.tsx`, replace each field's current `emz: "own"` rendering with `emz: "none"` when its facing pair is shared. Render one two-cell shared EMZ band between 1A/2A and another between 1B/2B; keep the main fields and Field Zones per member. Reuse the FFA4 shared cell logic in `packages/web/src/components/duel/opponent-board.tsx` (`SharedExtraZones`), or adapt it to the rooftop field renderer.
3. For a pair (a,b), merge a.monsters[5] with b.monsters[6] into one physical cell, and a.monsters[6] with b.monsters[5] into the other. For p0/p1 this means p0:5 ↔ p1:6 and p0:6 ↔ p1:5; repeat for p2/p3. Display the occupied card's actual controller and preserve its card identity for inspection. Do not merge teammates p0/p2 or p1/p3.
4. Give each shared cell both exact zone keys (`zoneKey(a,4,seq)` and `zoneKey(b,4,11-seq)`); resolve clicks using the actual legal prompt option, including the option's controller and sequence. Keep exact card keys for targets/inspection and preserve selection and animation anchors. Rotate/mirror the band for the viewer without changing server seat or sequence ids. Reuse disabled-cell handling across the two mirrored per-seat masks.
5. Add UI tests for all player viewpoints and spectator, both pairs, occupancy from either facing player, place/target clicks, disabled EMZ and old-core null metadata. Field Spell replacement needs no combined Field Zone widget: the snapshot clears the partner's Field Zone and adds that card to its owner's GY. Direct attacks use the engine's legal options; remove any UI assumption that an empty opposing member alone permits one.

Engine scenarios cover the rules and snapshot tests cover the metadata; this task does not change web rendering.
