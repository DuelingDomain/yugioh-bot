# Card status backend contract

All symbols below are exported from `@yugidraft/shared/duels`. The same contract is produced by the legacy 1v1 engine, pinned 1v1 engine, FFA3, FFA4, and Tag. No UI is included.

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

Stock coverage remains limited to cards that emit client hints. The selected staple overlays and their preparation/deployment path are documented in [card-status protection overlays](card-status-protection-overlays.md). No broad printed-text inference is used.

Verification completed with Node 22.23.3: 224 targeted real-engine cases plus two existing real-core counter decoder cases passed, as did 44 existing installer integration checks. Shared/server builds and typechecks passed. The legacy query decoder now reads counter type before count; nonmatching IDs/counts are checked in public views and single/location queries across all six core variants. No UI was built. The overlay documentation includes resource provenance and rerun instructions; prepared data must be regenerated with the existing `duel:prepare` workflow to install the new suffixes.
