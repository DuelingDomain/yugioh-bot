# Card status backend contract

All symbols below are exported from `@yugidraft/shared/duels`. The same contract is produced by the legacy 1v1 engine, pinned 1v1 engine, FFA3, FFA4, and Tag. The board and inspector UI that reads it is described in [card status UI](#ui) at the end of this page.

| `DuelCard` field | Type | Meaning |
| --- | --- | --- |
| `hints` | `DuelCardHint[] \| undefined` | Public registered description hints on face-up field cards; omitted when empty. |
| `hints[].descriptionId` | `string` | Decimal unsigned 64-bit engine descriptor; do not convert to a JS number. |
| `hints[].text` | `string` | Text resolved through strings.conf/CDB or the prepared host overlay descriptors; unknown IDs read `Status (<id>)`. |
| `hints[].categories` | `DuelProtectionCategory[]` | One or more legend glyph categories. The full text retains opponent-only, activated-effect, material and other qualifiers. |
| `baseAttack`, `baseDefense` | `number \| undefined` | Live queried base stats before additive modifiers. These can differ from printed stats. Preserve zero and the signed `-2` unknown-stat sentinel. |
| `negated` | `boolean \| undefined` | Existing `STATUS_DISABLED` flag, true only for a face-up field card. |
| `counters` | `DuelCounter[] \| undefined` | Existing wire shape, now a named shared type: `{ type: number; count: number }`. `type` is the complete engine counter ID, including flags. |

Categories map to the approved demo legend as follows:

| Category | Demo legend glyph |
| --- | --- |
| `unaffected-monsters` | `imM` |
| `unaffected-spells` | `imS` |
| `unaffected-traps` | `imT` |
| `unaffected-effects` | `imAll` |
| `cannot-be-destroyed-by-battle` | `noBD` |
| `cannot-be-destroyed-by-effects` | `noED` |
| `cannot-be-targeted` | `noTgt` |
| `cannot-be-attacked` | `noAtk` |
| `status` | Generic `info`; always show the original text |

Negation uses the existing separate `negated` field (`neg` glyph). A combined Spell/Trap hint has two categories; a combined battle/effect destruction hint has two categories. Categories classify registered hint text, never infer that printed card text is currently active. They are a compact visual index, not a substitute for qualified effect text.

`DUEL_COUNTER_CATALOG[type]` and `getDuelCounterMetadata(type)` return `{ key, name, family, glyph }`. The catalog contains all 134 demo types: exactly 17 dedicated glyph keys, and family glyphs for the other 117. Eight `DUEL_COUNTER_FAMILIES` supply names, descriptions, colors and generic glyph keys. `DUEL_COUNTER_GLYPHS` contains the approved 24×24 SVG interiors. The `named` family can optionally render card-name initials, as the demo does. Unknown IDs have a distinct hexadecimal key/name and the `loot` family glyph. IDs and names were checked against the installed strings.conf; common constants and counter flag bits were checked against Lua constants. Provenance hashes are in `counters.ts`.

Hint memory is derived solely from engine message order. Description add/remove messages are reference-counted per card instance; duplicate descriptions display once, sorted by numeric descriptor. Field moves and swaps carry the instance, while departure, face-down resets, removal and reload discard its statuses. Multiplayer rotations bind pre-move removals to the moving instance and retain displaced occupants until their move arrives. Overlay material hints cannot overwrite their host's hints. View projection never mutates this memory, so repeated reads and replay reconstruction use the same hints. Hidden card redaction also removes the new base-stat fields, and face-down cards carry no hint list.

Stock coverage remains limited to cards that emit client hints. The selected staple overlays and their preparation/deployment path are documented in [card-status protection overlays](../engine/card-status-protection-overlays.md). No broad printed-text inference is used.

Verification completed with Node 22.23.3: 224 targeted real-engine cases plus two existing real-core counter decoder cases passed, as did 44 existing installer integration checks. Shared/server builds and typechecks passed. The legacy query decoder now reads counter type before count; nonmatching IDs/counts are checked in public views and single/location queries across all six core variants. The overlay documentation includes resource provenance and rerun instructions; prepared data must be regenerated with the existing `duel:prepare` workflow to install the new suffixes.

## UI

The web client reads this contract in `packages/web/src/components/duel/card-status-model.ts` (one pure model shared by the board and the drawers) and draws it in `card-status.tsx`.

- Board: each face-up card has a status layer below the ATK / DEF plate, the Xyz material count and the equip chip, so those numbers are never covered. Protections are glyphs in an edge rail (top-left for you, bottom-right for a rival; a rail longer than the slots folds into "+N"). Counters are a stack of coins and a total (capped at "99+"); at most 3 coin types show and a "+" follows the total when there are more. The stack sits above the plate. On a turned seat field its offset is the real depth of the turned plate. Every glyph turns back to read upright for the viewer. Under 70px card width, protections are glyph-only (Spell, Trap and Monster immunities differ by shape, not only by colour) and the counters merge into one coin with the total. The layer never takes a click. The zone's accessible name and its tooltip list every item.
- Card drawer (hover or pinned) and Card tab: a status list in this order, negated first, then each protection with its whole engine text, then each counter with its name and count, then (for a monster whose ATK or DEF differs from the printed value) a "Base ATK / DEF" line. On short windows (up to 820px high) the art stands beside the name and the list takes the full width under both, so a card with six long hints and a long effect text does not scroll.
- Fixtures: `?status=1` on the table previews (`/dev/table-preview/{classic,ffa3,ffa4,tag}`) and `/dev/solid-preview` decorates every seat with the cases above, an equipped Xyz with materials and three counter types, a Continuous Spell and a Field Spell with counters. `packages/e2e/tests/table-grid-hit.spec.ts` checks, on classic, ffa3, ffa4 and tag at 1920x1080, 2560x1440 and 1366x768, that no status rail or counter stack touches a plate, a material count or an equip chip, and that the hover drawer (ffa3, ffa4, tag) does not scroll. The classic desktop inspector is a scrolling pane by design; at 1366x768 the longest case can still scroll.
