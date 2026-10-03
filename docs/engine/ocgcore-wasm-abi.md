# ocgcore-wasm ABI audit

Wrapper: `ocgcore-wasm@0.1.2`, patched by `patches/ocgcore-wasm+0.1.2.patch` (patch-package, edits the minified `dist/index.js`).
Core: EDOPro ygopro-core `efc21aa` (API 11.0), sources in `packages/duel-server/domain-core/dist/generated/ygo/` (paths below are relative to it).
Tests: `packages/duel-server/tests/ocgcore-wrapper-abi.test.ts` (crafted bytes through the patched parsers, plus a real duel query with the TYPE flag) and `tests/card-data-abi.test.ts`.

Message frame: `u32 length`, `u8 id`, payload. The wrapper parses each message from a bounded sub-reader, so an unread tail is harmless and a short read throws `eof` for that message only.

## Fixed in the wrapper patch

| Item | Core format | Wrapper before | Status |
| --- | --- | --- | --- |
| Query fields (`readQuery`, `function Q`) | `u16 size` (includes the flag), `u32 flag`, payload; end marker size 4 + flag 0x80000000 (`ocgapi.cpp`, `card.cpp` `get_infos`) | Payload read straight from the main reader. An unknown flag or a size mismatch left the payload unread and desynced every later field | Fixed. Each field reads from `sub(size-4)`. Unknown flags, odd sizes and truncated fields are skipped. A truncated field is dropped, the stream stays aligned |
| Query TYPE (flag 0x8) | `card.cpp` `CHECK_AND_INSERT(QUERY_TYPE, get_type())`: u32 | No branch. Payload unread, desync | Fixed. Result has `type` (u32). `views.ts` does not request TYPE today |
| Query COUNTERS | `card.cpp` `get_infos`: per entry `u32 = type + (count << 16)`, so u16 type then u16 count on the wire | count then type (swapped) | Fixed earlier (type first). Covered by a test |
| ANNOUNCE_ATTRIB (141) | `playerop.cpp:961-964`: u8 player, u8 count, **u32** available | `available` read as u8 | Fixed. `available` is u32. `prompts.ts` passes it to `ocgAttributeParse`, unchanged |
| `duelGetMessage` | `duel.cpp` message buffer | One thrown parse error (`eof`) lost the whole batch | Fixed. try/catch per message, `console.warn` with the message id, loop continues. Unknown ids already returned null + warn |
| SHUFFLE_SET_CARD (36) | `libduel.cpp:1423-1430`, `operations.cpp:2970`: u8 location, u8 n, n loc_info (from), n loc_info (to) | Wrong layout | Fixed earlier |
| SELECT_SUM (23) | `playerop.cpp:796+` | Field order and position | Fixed earlier |
| OcgCardData | `ocgapi_types.h` (wasm32) | Missing rscale/link_marker offsets | Fixed earlier |

## Checked, no change needed

| Item | Core format | Wrapper | Status |
| --- | --- | --- | --- |
| SWAP_GRAVE_DECK (35) | `field.cpp:1076-1130`: u8 player, **u32 extra-deck count** (`list_extra.size() - extra_p_count`), u32 bitmap byte length, bitmap bytes (`progressivebuffer.h`, zero padded) | u8, u32 (`deck_size`), u32 length, bytes | Matches. An earlier audit said the core writes only one u32. That was wrong: the first u32 is the extra count, not the byte length. The field name `deck_size` is a misnomer for that count. Test added |
| WIN (5) | `processor.cpp:4445-4452`, `4737-4744`: u8 player, u8 reason | same | Matches |
| DAMAGE / RECOVER / PAY_LPCOST (91/92/100) | `operations.cpp:604,675,751`: u8, u32 | same | Matches |
| LPUPDATE (94) | `libduel.cpp:48`, `field.cpp:1268`: u8, u32 | same | Matches |
| MATCH_KILL (170) | `operations.cpp:610`: u32 code | same | Matches |
| HINT (2) | u8 type, u8 player, u64 (every site: `operations.cpp`, `processor.cpp`, `libduel.cpp`, `playerop.cpp`). `processor.cpp:5141` | u8, u8, u64 (or u32 if 4 bytes remain) | Matches |
| CARD_HINT (160) | `libcard.cpp:2061`, `card.cpp:1802,1890,2110`, `field.cpp:1006`: loc_info, u8, u64 | same | Matches |
| PLAYER_HINT (165) | `field.cpp:1360-1427`: u8, u8, u64 | same | Matches |
| DRAW (90), DECK_TOP (38) | `operations.cpp:475-483`, `4429`, `libduel.cpp:825`, `libcard.cpp:2073`, `processor.cpp:4955,5121` | same | Matches |
| CONFIRM_CARDS (31), CONFIRM_DECKTOP (30), CONFIRM_EXTRATOP (42) | `operations.cpp:491,2948`, `libduel.cpp:832,862,891`: u8, u32 n, n x (u32 code, u8, u8, u32) | same | Matches |
| MOVE (50) | `operations.cpp:1014,4463,4516,4565,4826,5094`, `processor.cpp:5106`, `libduel.cpp:746`, `field.cpp:291-497`: u32 code, loc_info from, loc_info to, u32 reason | reads code, from, to | Matches. The reason u32 stays unread |
| POS_CHANGE (53) | `operations.cpp:5326`: u32, u8, u8, u8, u8 prev, u8 pos | same | Matches |
| SET (54), SUMMONING (60), SPSUMMONING (62), FLIPSUMMONING (64) | `operations.cpp:2246,2380,2754,2816,2937,3157,3376,3643`: u32 code (0 for face-down Special Summon), loc_info | same | Matches |
| SUMMONED/SPSUMMONED/FLIPSUMMONED (61/63/65), CHAIN_END (74), DAMAGE_STEP_START/END (113/114), ATTACK_DISABLED (112), REVERSE_DECK (37) | no payload | no payload | Matches |
| NEW_TURN (40), NEW_PHASE (41) | `processor.cpp:3357`: u8; `2810-3603`: u16 phase | same | Matches |
| CHAINING (70) | `processor.cpp:3725`: u32, loc_info, u8, u8, u32, u64, u32 chain size | same | Matches |
| CHAINED/CHAIN_SOLVING/CHAIN_SOLVED/CHAIN_NEGATED/CHAIN_DISABLED (71-73,75,76) | `processor.cpp:3918,4138,4201,4304`, `operations.cpp:37,59`: u8 chain count | u8 | Matches |
| MISSED_EFFECT (120) | `processor.cpp:4399`: loc_info, u32 code | same | Matches |
| FIELD_DISABLED (56) | `processor.cpp:4501,4666`: u32 | same | Matches |
| ATTACK (110) | `processor.cpp:2141,2909`, `libduel.cpp:1491`: loc_info, then target loc_info or empty | null when empty | Matches |
| BATTLE (111) | `processor.cpp:2467`: loc_info, u32 atk, u32 def, u8 destroyed, then the same for the target (zeros when none) | same | Matches |
| CARD_SELECTED (80), BECOME_TARGET (83), RANDOM_SELECTED (81), REMOVE_CARDS (190) | `processor.cpp:2054`, `libduel.cpp:536-552,3073`, `libgroup.cpp:326`, `operations.cpp:94`: [u8 player for 81], u32 n, n loc_info | same | Matches |
| EQUIP (93), CARD_TARGET (96), CANCEL_TARGET (97) | `card.cpp:1559,2354,2367`: loc_info, loc_info | same | Matches |
| ADD_COUNTER (101), REMOVE_COUNTER (102) | `card.cpp:1880,2033,2250,2274`, `libcard.cpp:1777`: u16 type, u8, u8, u8, u16 count | same | Matches |
| TOSS_COIN (130), TOSS_DICE (131) | `operations.cpp:6082-6196`: u8 player, u8 n, n x u8 | same | Matches |
| ROCK_PAPER_SCISSORS (132), HAND_RES (133) | `playerop.cpp:1134-1155`: u8 player; u8 `hand0 + (hand1 << 2)` | same | Matches |
| ANNOUNCE_RACE (140), ANNOUNCE_CARD (142), ANNOUNCE_NUMBER (143) | `playerop.cpp:926,1078,1102`: u8, u8, u64 (x n for 142/143) | same | Matches |
| SELECT_COUNTER (22), SELECT_TRIBUTE (20), SORT_CARD/SORT_CHAIN (25/21), SELECT_POSITION (19) | `playerop.cpp:665,741,887,624` | same | Matches |
| AI_NAME (163), SHOW_HINT (164) | `libdebug.cpp:197-213`: u16 length, bytes, NUL | u16 length, decoded bytes | Matches. Only Lua `Debug.SetAIName` and `Debug.ShowHint` emit them |
| SWAP (55) | `field.cpp:475`: u32, loc_info, u32, loc_info | same | Matches |
| TAG_SWAP (161), RELOAD_FIELD (162) | `field.cpp:1189-1275`, `field.cpp:79-130` | same | Matches |
| Other SELECT_* messages | `playerop.cpp` | see `src/prompts.ts` | Matches (earlier audit) |

## Not parsed or never written

| Item | Core | Wrapper | Status |
| --- | --- | --- | --- |
| UNEQUIP (95) | The core never writes it. `MSG_UNEQUIP` appears only in `ocgapi_constants.h`. `card::unequip()` sends no message | No case, returns null + warn if it ever appears | No parser added. Not needed. No payload is defined to parse |
| WAITING (3), START (4), UPDATE_DATA (6), UPDATE_CARD (7), REQUEST_DECK (8), BE_CHAIN_TARGET (121), CREATE_RELATION (122), RELEASE_RELATION (123), CUSTOM_MSG (180) | Never written by this core | WAITING/START/UPDATE_*/REQUEST_DECK: no case. 121-123, 180: `{ type }` only | No action |
| Response SORT_CARD | `playerop.cpp` sort: indices from byte 0, no length byte | Wrapper writes a length byte first | Not patched. `prompts.ts` `sortCardResponse` sends the order as raw SELECT_PLACE bytes |
| Response SELECT_CARD_CODES | `playerop.cpp`: u32 type, u32 count, u32 **indices** | Field is called `codes` | Callers pass indices |
| Duel mode constants | `ocgapi_constants.h` has newer DUEL_* flags | `OcgDuelMode` stops at 0x200000000 | Options are u64, layout matches. Use raw bigint literals for newer flags |

## Legacy message mode

The patch keeps main's old message layout behind `createCore({ legacyMessages: true })`. The 1v1 legacy engine (`DUEL_1V1_ENGINE=legacy`, see `docs/deployment/duel-engine-switch.md`) sets it. It changes ANNOUNCE_ATTRIB (u8 instead of u32), the SWAP_GRAVE_DECK bit limit, the MOVE message layout and whether a message parse error is rethrown. `tests/ocgcore-wrapper-abi.test.ts` covers both modes.

## Bundle check

`src/engine-bundle.ts` `verifyEngineBundle(dataDirectory)` runs at startup in `src/server.ts`. It checks `manifest.json` (with `bundleVersion`), both wasm files, `cards.cdb` and `card-scripts/`. It also checks `integrity.domainLegacyWasm` and `integrity.domainLegacyLua` (the legacy 1v1 files; required only when `DUEL_1V1_ENGINE` is `legacy`). It checks `integrity.standardWasm`, `integrity.domainWasm` and `integrity.wrapper` (sha256 of the resolved `ocgcore-wasm/dist/index.js`) when they are present. After any change to the wrapper patch, refresh the manifest (`npm run duel:prepare`, or `scripts/build-standard-core.sh`, which re-records `integrity.wrapper` and `bundleVersion`).
