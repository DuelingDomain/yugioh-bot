# FFA3 columns: rule and handoff

Owner decision: 2026-10-05. Rule: **R-FFA-THREE-COLUMNS**. Base: `origin/main` at `049a4df7`.

With three living duelists, an activated effect that affects opponent cards selects one living opponent before card or zone choices. With two, all column logic uses the remaining opponent and gives no opponent prompt. Main column `s` faces `4-s`. EMZ sequences 5 and 6 map to columns 1 and 3. FFA3 EMZ remain separate: two independently occupied mirrored EMZ can contribute two cards to one column. Link arrows do not change. FFA4 keeps seats 0/1 and 2/3, without re-facing after a loss. Tag and 1v1 do not change.

A chain keeps its bound peer if that peer leaves. Its column reads see the departed seat's empty field; they do not switch to the survivor. Before a peer is bound, column reads use the same pending-loss eligibility as the opponent pick. Infinite Impermanence saves the negated target's controller at resolution and uses that seat for its lasting column negation.

## Card groups

A card can occur in both (a) and (c): classify each effect, not the whole card. These lists come from the pinned stock scripts. They do not add cards to the production database.

### (a) Three live duelists: activated opponent column effects (48 cards)

The named operations opt into column peers. Their target checks use the existing opponent probe. A sole opponent that passes the target probe is bound without a menu; existing causal response bindings remain in force. Sunlit Sentinel registers its effect later, so its registration wrapper runs in `regop`.

| Card | Code | Activated operation |
|---|---:|---|
| Aeropixthree | 83094004 | `seqop` |
| Angelechy Bastion | 28904860 | `banop` |
| Angelechy Destrier | 55393975 | `banop` |
| Angelechy Enlisted | 81797573 | `banop` |
| Beast King Unleashed | 50675040 | `thop` |
| Bingo Card | 99505609 | `desop` |
| Blasting Fuse | 99788587 | `activate` |
| Bomber Place | 71750854 | `effop` |
| Broken Line | 88086137 | `activate` |
| Distrust Paranoia | 81965543 | `activate` |
| Fantastic Striborg | 79176962 | `thop` |
| Foolish Trap Hole | 10529441 | `activate` |
| Fuse Line | 51091138 | `activate` |
| Gold Pride - Nytro Blaster | 58884063 | `desop` |
| Gold Pride - Nytro Head | 59900655 | `desop` |
| Goldilocks the Battle Landscaper | 24521754 | `seqop` |
| Infinite Impermanence | 10045474 | `activate`, including its lasting column negation |
| Iron Dragon Tiamaton | 46247282 | `desop` |
| Iron Thunder | 12682213 | `activate` |
| Junora the Power Patron of Tuning | 5914858 | `effop` |
| Kai-Den Kendo Spirit | 71614230 | `gyop` |
| Kuro-Obi Karate Spirit | 77511331 | `gyop` |
| Magical Musket - Crooked Crown | 47810543 | `spop` |
| Mekk-Knight Red Moon | 56809158 | `operation` |
| Mekk-Knight Yellow Star | 29415459 | `operation` |
| Metalrokket Dragon | 32472237 | `desop` |
| Parallel Panzer | 93394164 | `doperation` |
| Prey of the Jirai Gumo | 33055499 | `spop` |
| Procession of the Tea Jar | 12612470 | `posop` |
| Regenesis Commands | 95382988 | `activate` |
| Reversible Beetle | 45702357 | `tdop`, `posop` |
| S-Force Lapcewell | 27383719 | `desop` |
| Shelrokket Dragon | 5087128 | `desop` |
| Small Scuffle | 15967552 | `spop` |
| Solving for Pendulum | 5208118 | `moveop` |
| Sour Scheduling - Red Vinegar Vamoose | 65107325 | `actop` |
| Sprind the Irondash Dragon | 1906812 | `seqop` |
| Staring Contest | 97729135 | `mvop1` |
| Storm Shooter | 39188539 | `thop` |
| Sunlit Sentinel | 78360952 | `spop` |
| Thunder Ball | 84813516 | `desop` |
| Tsuru-Puru-Purun | 84635192 | `spop` |
| Vanquish Soul Pantera | 66401502 | `vsop` |
| Vanquish Soul Razen | 29302858 | `vsop` |
| Vanquish Soul Trinity Burst | 53330789 | `activate` |
| Vaylantz World - Konig Wissen | 75952542 | `plop` |
| Yajiro Invader | 10852583 | `mvop` |
| Yoko-Zuna Sumo Spirit | 40516623 | `gyop` |

### (b) Two live duelists: all column logic (99 distinct cards)

Outside an already bound chain, all cards in (a) and (c) use the remaining opponent. The stock scan also has these 10 column readers. They use the same core/Lua column functions with two live seats:

Early Palm Gets the Win (58995660), Girsu, the Orcust Mekk-Knight (69811710), Han-Shi Kyudo Spirit (53270092), Magical Musketeer Calamity (68024506), Magical Musketeer Kidbrave (5230799), Magical Musketeer Starfire (31629407), Magical Musketeer Wild (94418111), S-Force Bridgehead (23377425), S-Force Signify (19951423), S-Force Specimen (82977464).

Full-column checks count all six separate positions in an EMZ column. Bingo Card and Blasting Fuse require both mirrored EMZ to be occupied; tests also reject a missing Main Monster Zone or Spell/Trap Zone.

Live tests cover Purple Nightfall, Infinite Impermanence (activation and continuous negation), Small Scuffle and Fuse Line for each surviving pair: 0/1, 0/2 and 1/2. They also cover Disablaster, Distrust Paranoia, Yajiro Invader, Crooked Crown and Bingo Card. Each expected card/zone/action prompt proves that no opponent menu occurs.

### (c) Three live duelists: non-activated column logic (47 cards)

These column parts stay on the own field. This includes summon procedures, continuous effects, immunity, and event registration. Other effects of these cards can be in (a).

Alien Infiltrator (76573247), Defense Zone (59687381), Disablaster the Negation Fortress (58707981), Distrust Paranoia (81965543), Ghost Bird of Bewitchment (15419596), Imposter Shift (89027418), Iron Dragon Tiamaton (46247282), Magical Musketeer Caspar (32841045), Magical Musketeer Doc (68246154), Mekk-Knight Blue Sky (20537097), Mekk-Knight Green Horizon (66022706), Mekk-Knight Indigo Eclipse (92204263), Mekk-Knight Orange Sunset (93020401), Mekk-Knight Purple Nightfall (28692962), Mekk-Knight Red Moon (56809158), Mekk-Knight Spectrum Supreme (38502358), Mekk-Knight Yellow Star (29415459), Mekk-Knight of the Morning Star (72006609), Procession of the Tea Jar (12612470), Rampaging Rhynos (3784434), Red Hared Hasty Horse (19636995), S-Force Dog Tag (65479980), S-Force Edge Razor (91864689), S-Force Gravitino (21368442), S-Force Mystify (4611341), S-Force Nightchaser (20515672), S-Force Orrafist (95974848), S-Force Pla-Tina (58363151), S-Force Professor DiGamma (58589739), S-Force Rappa Chiyomaru (22180094), Scareclaw Acro (46877100), Scareclaw Astra (83488497), Scareclaw Belone (19882096), Scareclaw Reichheart (82361809), Sour Scheduling - Red Vinegar Vamoose (65107325), The Weather Auroral Canvas (52834429), The Weather Cloudy Canvas (53956001), The Weather Rainbowed Canvas (74218258), The Weather Rainy Canvas (27561302), The Weather Snowy Canvas (80577258), The Weather Sunny Canvas (89355716), The Weather Thundery Canvas (16849715), Wattkingdom (41790641), World Legacy - "World Shield" (55787576), World Legacy Key (2930675), World Legacy Whispers (62530723), World Legacy's Secret (98935722).

### Own-only activated effects: interpretation to confirm

The owner limited (a) to effects that affect opponent cards. This implementation leaves activated effects that affect only own cards on the own field with three live seats; they do not ask for an opponent. The existing Kidbrave scenario now checks that interpretation. Examples include Girsu, S-Force Signify and Magical Musketeer draw/search effects. An optional owner question was sent for this case. All their column logic uses the remaining opponent with two live seats.

### Deferred menu refinement (review item 6)

The target probe excludes an opponent when that opponent's `chk==0` check fails. An own-card choice can make that Boolean check pass for every opponent. Such effects can still show an opponent menu. A general `MPTarget` change cannot safely identify which side supplied the legal choice. The optional refinement is deferred; no target callbacks or menus were changed for it.

## Host and web

No host or preset change is needed for prompt order. `aux.MPTarget` uses the current opponent probe and `aux.MPOne` binding. The host already maps the `0xFFFE0000 | seat` SELECT_OPTION values to `context.type = "opponent"`, then processes the next card or zone prompt. The live tests exercise this path.

The UI agent on `feat/ffa3-pass` should:

- Show the existing opponent menu first. Use real seat IDs from its options. Exclude eliminated seats.
- Show only the selected opponent as the column peer during this effect. Highlight own column `s` with peer column `4-s`. Map own EMZ 5 to column 1 and EMZ 6 to column 3; mirror the peer in the same way.
- Keep the three fields, EMZ ownership and Link arrows in place. A column highlight must not move fields or imply shared EMZ.
- With two live seats, derive the peer from the living seats. Show no opponent menu.
- Clear a temporary highlight when the effect ends, is cancelled, or its prompt is replaced. Use current seat/card/zone options as the source of legal choices. Do not infer legality from the highlight.
- For spectator/reconnect highlights across own-zone-only prompts, add explicit per-effect peer metadata if required. `DuelPrompt` currently has option controllers, but no persistent `columnPeerSeat`; an acting client can remember its choice only for its current prompt flow. This visual metadata is separate from prompt order. No UI or transport change is made here.

## Scope and integration

- New patches: `0106-ffa3-column-peer.patch` and `0107-ffa3-column-peer-lifetime.patch`. The review leaves all prior patch files unchanged. `across_of()` stays unchanged.
- 39 new suffix files join 8 existing activated suffixes. Existing passive guards use column peers separately from Link helpers. Every suffix keeps a checked `stockSha256` entry.
- The final check of `fix/hand-effects-multi` shows two shared files: `multi-scripts/MANIFEST.json` and the expected manifest count in `scripts/generate-multi-scripts.ts`. Preserve both branches' new manifest entries and set combined `EXPECTED_COUNTS.entries = 360` when integrating. Do not merge as part of this task. No engine patch file overlaps. Its uncommitted files were not read.
- Bingo Card has a pinned stock script but no pinned `cards.cdb` row. Its live test adds a Normal Trap row only to a private temporary database. Production data stays unchanged.
- `CONTEXT.md` has no multiplayer column rule to update.
