# Multi-seat hand, Deck and Extra Deck audit — 2026-10-01

This is the historical P61 audit. The 2026-10-02 owner decisions replace its earlier opponent-field rules. The P68 review is in [the overlay work review](2026-10-01-multi-seat-wip-review.md). Its counts apply only to the stated tests and core. The CSV and JSON files preserve the original scan evidence.

This report records the stock-script zone audit. The scan used `both-individual-locs`, `each-player-pair` and `each-player-split`. It found 208 scripts in these groups. Of these, 106 already had an overlay and 102 had no overlay when this audit started. The 102 candidates are all listed below. A scan hit is not proof of a defect.

The first sixteen cards had a live zone defect. A later live pair and count audit confirmed eight further card defects. Underworld Circle had two defects: its activation missed the Tag partner Deck, and its Standby effect omitted extra duelists in all three multiplayer formats. The fixes use per-seat queries and one group action where the stock action is simultaneous. No ban was changed. Card Destruction, Hand Destruction and Chaos Emperor Dragon stay banned in FFA. Their suffixes run only in Tag. The loader leaves all stock 1v1 scripts unchanged.

## Policy and scope

ADR-0002 rule R-COMMON-EACH-PLAYER includes every living duelist, including the Tag partner. Accepted Q4 duel-style effects use the acting duelist and one picked opponent. A paired action is not changed to an all-player action merely because its script contains both location masks. Existing OK-BIND triage entries identify those intended pairs; low-confidence static entries below are not live correctness claims.

This audit excludes PLAYER_ALL metadata and global-seat defects as independent scopes. It records hidden-zone metadata when that metadata binds a later zone action to one opponent. Field/hand count comparisons need their own rule check. Deck validation bans apply before a live action; banned cases are not counted as tests of allowed behavior.

## Real engine results

The 48 stock multiplayer action probes produced 35 failures and 13 passes. All failures below reached a real card action and showed the wrong final state, missed action or missing reveal for one or more seats. The stock probes chose the last available opponent when a pick appeared. The counts exclude stock 1v1 checks, invalid fixtures, loader failures and four skipped FFA Card/Hand Destruction cases.

| Probe group | Actual multiplayer actions | Stock failures | Stock passes |
| --- | ---: | ---: | ---: |
| Neo-Daedalus, Norleras, Sophia, Law | 12 | 8 | 4 |
| Tempest, Extermination, Crossout, Card of Fate | 12 | 7 | 5 |
| Gnomes, Circle activation, Alba Los, legal Tag Card/Hand Destruction | 11 | 7 | 4 |
| Cappello, Dark Angel, Alba System | 9 | 9 | 0 |
| Circle Standby | 3 | 3 | 0 |
| Chaos Emperor Dragon, legal Tag | 1 | 1 | 0 |

The first permanent zone set has 66 cases: 49 multiplayer cases and 17 stock 1v1 checks. All 66 passed on Standard Multi and all 66 passed on Domain Multi. The first four zone cards also have FFA4 cases that remove seat p3 before activation and check every remaining seat. All scenarios check exact LP, hands, field cards, GY cards, banished cards and Deck counts for every seat. Extra Deck cases check exact Extra Deck lists. Gnomes also checks the actual hand levels. Dark Angel checks each unique revealed Normal Spell in the log.

The zone runs used a private copy of the current manifest-listed production overlays and the ready card suffixes. This prevented another agent's unregistered card file from changing the loader input during the run. The tests use pinned copies of the installed P61 real WASM cores and unmodified stock card scripts plus the production suffix text.

- Standard Multi SHA-256: `d60c3bb842036e1b6b81ad0d9ffc1c262ace42414087743b23805caa44abf679`.
- Domain Multi SHA-256: `81f6248e65107fa378c1c8da9c1e0dc6d5350031f470f210731602dd6229a717`.

Whole-workspace typecheck did not pass at the audit checkpoint. It reported other agents' temporary audit imports, missing temporary scenario tags and readonly `pin-baller-lp` selections. It reported no error in this audit's permanent scenario files. A failed workspace typecheck is not reported as a pass.

## Ranked confirmed defects and minimal repairs

PASS below means that the tested stock action had the expected result in that format. It is not a proof of every effect, timing or legality branch of the card. FAIL means that the real stock action had a wrong result. BANNED means no allowed probe was run.

| Rank | Code and card | Stock FFA3 | Stock FFA4 | Stock Tag | Root cause and suffix scope |
| ---: | --- | --- | --- | --- | --- |
| 1 | 10485110 — Ocean Dragon Lord - Neo-Daedalus | FAIL | FAIL | FAIL | Hidden hand metadata binds one opponent. Collect all hands before one send. |
| 2 | 66926224 — The Law of the Normal | FAIL | FAIL | FAIL | Hidden hand metadata binds one opponent. Check every hand and collect all hands before one send. |
| 3 | 14391920 — Inferno Tempest | FAIL | FAIL | FAIL | Deck metadata binds one opponent. Collect every Deck/GY group, with the stock Spirit Elimination filter, before one banish. |
| 4 | 17449108 — Nobleman of Extermination | FAIL | FAIL | FAIL | Deck reveal binds before the copy search. Collect all Decks and run every reveal/shuffle in its own seat scope. |
| 5 | 69120785 — The Bystial Alba Los | FAIL | FAIL | FAIL | The destruction event binds the destroyer. Collect every Extra Deck at target and resolution. |
| 6 | 19491080 — Clown Crew Cappello | FAIL | FAIL | FAIL | Extra Deck metadata binds one opponent. Collect all face-up Pendulum cards for the first Tribute effect. |
| 7 | 93053159 — Alba System Dogmatikalamity | FAIL | FAIL | FAIL | The Extra Deck group binds one opponent before resolution. Collect each Extra Deck for target and resolution. |
| 8 | 26964762 — Destiny HERO - Dark Angel | FAIL | FAIL | FAIL | The stock operation visits own and one opponent Deck. Each living duelist selects, shuffles, places and reveals its own top card. |
| 9 | 73443672 — Underworld Circle | PASS | PASS | FAIL | Deck banish misses the Tag partner. The Standby operation also visits only two players: FAIL in all three formats. Collect all Deck monsters and call the stock summon helper for each living duelist. |
| 10 | 48453776 — Sky Scourge Norleras | PASS | PASS | FAIL | An unbound dual mask includes all FFA hands, but own Tag hand excludes the partner. Collect every hand/field before the stock send and own draw. |
| 11 | 4335427 — Sophia, Goddess of Rebirth | PASS | PASS | FAIL | An unbound dual mask includes all FFA hands, but own Tag hand excludes the partner. Collect every hand/field/GY before one banish. |
| 12 | 71044499 — Nobleman of Crossout | PASS | PASS | FAIL | The group is removed before the reveal binds, so FFA passes. Tag misses the partner Deck. Collect all copies, then reveal/shuffle every remaining Deck. |
| 13 | 164710 — Mischief of the Gnomes | PASS | PASS | FAIL | Own Tag hand excludes the partner. Apply the initial level effect to the union; keep one stock later-to-hand effect. |
| 14 | 72892473 — Card Destruction | BANNED | BANNED | FAIL | Tag sends and redraws only the acting/picked hands. Collect all Tag hands, keep each count and draw for each living duelist. FFA ban stays. |
| 15 | 74519184 — Hand Destruction | BANNED | BANNED | FAIL | Tag offers send/draw to only two duelists. Each living duelist selects two from its own hand; send the union once and draw two each. FFA ban stays. |
| 16 | 82301904 — Chaos Emperor Dragon - Envoy of the End | BANNED | BANNED | FAIL | Only the Tag partner hand stays behind. All fields, opposing hands and damage already pass. Collect all Tag hands/fields; keep the stock damage block and FFA ban. |

The stock FFA passes are useful false positives. An unbound own/opposing hand or Deck mask can include every FFA opponent. The same query omits the acting Tag partner's hand or Deck. An activation, event or reveal can bind the opponent before the operation repeats the query. Crossout removes its group before the reveal binds, so its FFA action passed; Extermination reveals first and failed in FFA. The final group unions make the target and resolution independent of such timing.

The Inferno Tempest fixture took actual 3000 battle damage from Blue-Eyes and activated the set card in the damage response. Sophia used its real Ritual/Fusion/Synchro/Xyz banish cost. Cappello used a real Mobius Tribute Summon. Its test fixture places one face-up Timegazer in each Extra Deck because the board DSL has no face-up Extra Deck position. Alba System used real Necro Fusion with seven GY materials, then six real Gale Dogra activations to send six different Albaz Fusions to the GY. Chaos Emperor Dragon used its real LIGHT/DARK banish procedure before its ignition and 1000 LP cost. No card effect was called directly by a Debug script.

For Extermination and Crossout, every scoped duelist receives the collected Deck reveal and shuffles its own Deck once. Extermination keeps the stock reveal/shuffle-before-copy-removal order. Crossout keeps removal-before-reveal/shuffle. Inferno Tempest keeps the stock Spirit Elimination filter. Norleras still draws for only its own player. Sophia keeps the stock chain limit and removal reason. Alba Los keeps the stock flags and delayed return logic. Circle calls its stock summon helper once for each living duelist, then completes the summon batch once. Chaos Emperor Dragon keeps its stock damage calculation; the corrected Tag case clears the partner hand and still deals 1200 to the opposing team.

## Complete 102-row candidate verdicts

Rank 1 is a confirmed live defect with a tested suffix. Rank 2 is an open concern or a separate count scope. Rank 3 is a live accepted pair. Rank 4 is a static exclusion, accepted pair or another audit scope; it is not a live pass. Rank 5 is forbidden in all multiplayer formats. Stock line references come from the captured scanner input.

| Rank | Code | Card | Verdict | Evidence and limit | Stock hit |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 10485110 | Ocean Dragon Lord - Neo-Daedalus | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). Hidden hand metadata binds one opponent. Collect all hands before one send. | `c10485110.lua:58, 64` |
| 1 | 66926224 | The Law of the Normal | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). Hidden hand metadata binds one opponent. Check every hand and collect all hands before one send. | `c66926224.lua:27, 34` |
| 1 | 14391920 | Inferno Tempest | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). Deck metadata binds one opponent. Collect every Deck/GY group, with the stock Spirit Elimination filter, before one banish. | `c14391920.lua:22, 27` |
| 1 | 17449108 | Nobleman of Extermination | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). Deck reveal binds before the copy search. Collect all Decks and run every reveal/shuffle in its own seat scope. | `c17449108.lua:39` |
| 1 | 69120785 | The Bystial Alba Los | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). The destruction event binds the destroyer. Collect every Extra Deck at target and resolution. | `c69120785.lua:80, 85` |
| 1 | 19491080 | Clown Crew Cappello | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). Extra Deck metadata binds one opponent. Collect all face-up Pendulum cards for the first Tribute effect. | `c19491080.lua:77, 99` |
| 1 | 93053159 | Alba System Dogmatikalamity | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). The Extra Deck group binds one opponent before resolution. Collect each Extra Deck for target and resolution. | `c93053159.lua:63, 68` |
| 1 | 26964762 | Destiny HERO - Dark Angel | LIVE DEFECT / FIXED | FAIL / FAIL / FAIL (FFA3 / FFA4 / Tag). The stock operation visits own and one opponent Deck. Each living duelist selects, shuffles, places and reveals its own top card. | `c26964762.lua:85, 92` |
| 1 | 73443672 | Underworld Circle | LIVE DEFECT / FIXED | PASS / PASS / FAIL (FFA3 / FFA4 / Tag). Deck banish misses the Tag partner. The Standby operation also visits only two players: FAIL in all three formats. Collect all Deck monsters and call the stock summon helper for each living duelist. | `c73443672.lua:45` |
| 1 | 48453776 | Sky Scourge Norleras | LIVE DEFECT / FIXED | PASS / PASS / FAIL (FFA3 / FFA4 / Tag). An unbound dual mask includes all FFA hands, but own Tag hand excludes the partner. Collect every hand/field before the stock send and own draw. | `c48453776.lua:75, 80` |
| 1 | 4335427 | Sophia, Goddess of Rebirth | LIVE DEFECT / FIXED | PASS / PASS / FAIL (FFA3 / FFA4 / Tag). An unbound dual mask includes all FFA hands, but own Tag hand excludes the partner. Collect every hand/field/GY before one banish. | `c4335427.lua:91, 96` |
| 1 | 71044499 | Nobleman of Crossout | LIVE DEFECT / FIXED | PASS / PASS / FAIL (FFA3 / FFA4 / Tag). The group is removed before the reveal binds, so FFA passes. Tag misses the partner Deck. Collect all copies, then reveal/shuffle every remaining Deck. | `c71044499.lua:31` |
| 1 | 164710 | Mischief of the Gnomes | LIVE DEFECT / FIXED | PASS / PASS / FAIL (FFA3 / FFA4 / Tag). Own Tag hand excludes the partner. Apply the initial level effect to the union; keep one stock later-to-hand effect. | `c164710.lua:24` |
| 1 | 72892473 | Card Destruction | LIVE DEFECT / FIXED | BANNED / BANNED / FAIL (FFA3 / FFA4 / Tag). Tag sends and redraws only the acting/picked hands. Collect all Tag hands, keep each count and draw for each living duelist. FFA ban stays. | `c72892473.lua:31, 18, 27` |
| 1 | 74519184 | Hand Destruction | LIVE DEFECT / FIXED | BANNED / BANNED / FAIL (FFA3 / FFA4 / Tag). Tag offers send/draw to only two duelists. Each living duelist selects two from its own hand; send the union once and draw two each. FFA ban stays. | `c74519184.lua:19, 40, 18, 26` |
| 1 | 82301904 | Chaos Emperor Dragon - Envoy of the End | LIVE DEFECT / FIXED | BANNED / BANNED / FAIL (FFA3 / FFA4 / Tag). Only the Tag partner hand stays behind. All fields, opposing hands and damage already pass. Collect all Tag hands/fields; keep the stock damage block and FFA ban. | `c82301904.lua:96, 105` |
| 1 | 25096909 | Simultaneous Equation Cannons | LIVE DEFECT / FIXED | Stock FFA3/4/Tag reject the legal Extra Deck combination. The target must check each bound FFA opponent; Tag must include both opposing hands after a bind. `opponent-count-gates-cannons-{1v1,ffa3,ffa4,tag}-late-eligible-opponent` and three negative controls: all seven pass on Standard and Domain. | `c25096909.lua:33, 55` |
| 1 | 44155002 | The Fabled Unicore | LIVE DEFECT / FIXED | Unicore compares the own duelist hand with both opposing Tag hands. Actual Mirror Force battle chains prove matching and nonmatching totals. Stock FFA3/4 pass; both Tag cases fail. `fabled-unicore-counts.ts`: five cases pass on pinned Standard and Domain. | `c44155002.lua:19` |
| 3 | 74191528 | Card of Fate | LIVE PAIR PASS | FFA3/FFA4/Tag actual activation passed: only own and picked last opponent gain one card; every other hand/Deck stays unchanged. Accepted Q4 duel-style pair. The opponent choice occurs during resolution. | `c74191528.lua:27` |
| 4 | 1082946 | Pyro Clock of Destiny | STATIC EXCLUDE | The broad LOCATION_ALL mask selects a card with the turn-count effect. This is one card selection, not an all-player hand/Deck action. No live probe here. | `c1082946.lua:14, 18` |
| 4 | 1197847 | Phantasm Spiral Wave | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c1197847.lua:42, 57` |
| 4 | 1322368 | SPYRAL Double Helix | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c1322368.lua:34, 42` |
| 4 | 2196767 | Gambler of Legend | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c2196767.lua:28` |
| 4 | 4928565 | Tearlaments Kashtira | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. top 3 of "either player" Deck: you or the one bound opponent | `c4928565.lua:70, 75` |
| 3 | 5556668 | Exchange | LIVE PAIR PASS | Own and picked last hand exchange their unique monsters. Other hands and every Deck stay unchanged. `paired-hidden-zones-exchange-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c5556668.lua:14, 19` |
| 3 | 6909330 | Soul Binding Gate | LIVE PAIR PASS | `player-all-lp-pair-6909330-{ffa3,ffa4,tag}-{p0,p1}`: four real Normal Summon/flag/damage cases. Previous-controller flag stays in the intended pair. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c6909330.lua:63` |
| 4 | 10925955 | Contact with the Aquamirror | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c10925955.lua:25, 49` |
| 1 | 11110587 | That Grass Looks Greener | LIVE DEFECT / FIXED | Real unequal Decks: own8, first opponent12, last opponent3. Stock FFA3/4/Tag do not offer activation; stock1v1 passes. Check every eligible opponent, bind one, mill exactly five own cards. `grass-deck-counts-{1v1,ffa3,ffa4,tag}-late-eligible-opponent` plus three negative controls: seven pass on Standard and Domain. | `c11110587.lua:16, 19, 24` |
| 4 | 11819473 | Arcana Reading | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c11819473.lua:36, 44` |
| 4 | 12292422 | Specimen Inspection | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c12292422.lua:50` |
| 4 | 13582837 | Infernity Randomizer | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. Damage to one opponent: pick at activation | `c13582837.lua:33` |
| 4 | 14220547 | Branded in Central Dogmatika | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c14220547.lua:46, 51` |
| 4 | 15661378 | Trishula, the Dragon of Icy Imprisonment | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c15661378.lua:59` |
| 3 | 15800838 | Mind Crush | LIVE PAIR PASS | Tag actual announce/discard clears only picked last hand; own Trap enters GY. Existing nseat-ffa Mind Crush cases also pass for FFA3/4. `paired-hidden-zones-mind-crush-{1v1,ffa3,ffa4,tag}`: exact per-seat states pass on Standard and Domain. Mind Crush reuses FFA cases and adds only 1v1/Tag here. | `c15800838.lua:16, 26` |
| 4 | 15967552 | Small Scuffle | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c15967552.lua:50` |
| 3 | 16435215 | Dragged Down into the Grave | LIVE PAIR PASS | Own and picked last hands each lose their monster and draw one Elf. Other hands, Decks and GYs stay unchanged. `paired-hidden-zones-dragged-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c16435215.lua:22, 42, 16, 27` |
| 4 | 16598965 | Stained Glass of Light & Dark | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c16598965.lua:46, 48` |
| 4 | 17178486 | Life Equalizer | OTHER SCOPE / TAG | FFA banned. Tag operates on the two team LP totals. No hidden-zone action. No live probe here. | `c17178486.lua:18` |
| 4 | 17955766 | Neo-Spacian Aqua Dolphin | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. look at the hand of one bound opponent | `c17955766.lua:31` |
| 4 | 22555834 | Stairway to a Fabled Realm | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c22555834.lua:86` |
| 1 | 22593417 | Topologic Gumblar Dragon | LIVE DEFECT / FIXED | Real Monster Reborn into Gumblar linked m1 triggers discard. Stock actor discards before picker; last chooser can select p1 hand cards and actually discards p1 BattleOx. `gumblar-hand-binding-*`: three timing cases and four real selection cases. Red6fail/1pass; seven pass on both cores. MPTarget hdtg binds at activation; MPOne hdop reads only the chosen hand. Extra-linked ignition and a summoned card that leaves before linked-zone test are not covered. | `c22593417.lua:50, 66` |
| 4 | 23064604 | Erebus the Underworld Monarch | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c23064604.lua:48, 64` |
| 4 | 27340877 | DNA Checkup | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. the bound opponent declares; draw goes to bound opponent or you | `c27340877.lua:32` |
| 4 | 31525442 | Zolga the Prophet | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c31525442.lua:39` |
| 3 | 33423043 | D.D. Designator | LIVE PAIR PASS | The announced last-seat monster is banished from that hand. Every other hand and Deck stays unchanged. `paired-hidden-zones-dd-designator-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c33423043.lua:15, 25` |
| 3 | 34236961 | Ante | LIVE PAIR PASS | `late-{ffa3,ffa4,tag}-ante-*`: seven actual reveal/LP/discard and no-hand controls; the available format branches are in late-cards.ts. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c34236961.lua:38, 18, 23` |
| 4 | 35569555 | Dogmatikamatrix | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c35569555.lua:58, 63` |
| 4 | 37313786 | Gamble | STATIC PAIR / TAG | FFA banned. Hand counts gate a coin gamble; the action affects only the activator. No all-player hidden-zone action. | `c37313786.lua:17` |
| 3 | 37812118 | Cup of Ace | LIVE PAIR PASS | `late-{ffa3,ffa4,tag}-cup-of-ace-{heads-the-activator-draws-2-and-no-opponent-is-picked,tails-the-picked-opponent-draws-2}`: six actual coin branches, exact all-seat draw results. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c37812118.lua:17` |
| 4 | 39513225 | Seventh Barian's | NO DATABASE CARD | Stock script exists, but cards.cdb has no row. No real-card live probe is possible. Existing triage says EACH-DUELIST; native deferred-damage behavior is not proved here. | `c39513225.lua:73` |
| 4 | 40352445 | White Knight of Dogmatika | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c40352445.lua:38, 48` |
| 4 | 46833854 | Fabled Topi | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c46833854.lua:20` |
| 3 | 46918794 | Tremendous Fire | LIVE PAIR PASS | `player-all-lp-pair-46918794-{ffa3,ffa4,tag}-{p0,p1}`: four cases; FFA actor and picked opponent each lose the exact stock amount, Tag pools change once. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c46918794.lua:19` |
| 1 | 48814566 | Banquet of Millions | LIVE DEFECT / FIXED | Stock FFA3/4/Tag banish the right pair, then return last-seat Karbonala into p1 Extra at End Phase. `banquet-return-owner-{1v1,ffa3,ffa4,tag}` checks the intermediate banish, actual End Phase and next normal draw. Red3fail/1pass; four pass on both cores. Set delayed SendtoDeck destination to nil so each card returns to its owner. | `c48814566.lua:19, 25` |
| 3 | 49407319 | Star Mine | LIVE PAIR PASS | `player-all-lp-pair-49407319-{ffa3,ffa4,tag}-{p0,p1}`: four real battle/damage cases with every seat checked. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c49407319.lua:56, 76` |
| 4 | 51208877 | Blast Held by Destiny | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. Damage to the attacking opponent (event opponent) | `c51208877.lua:46` |
| 3 | 54239282 | Old Mind | LIVE PAIR PASS | Real discard choice sends own and picked monsters to their GYs, moves Old Mind to the picked hand, and draws one Elf for own player. `paired-hidden-zones-old-mind-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c54239282.lua:27` |
| 1 | 54635100 | Linkerbell | LIVE DEFECT / FIXED | Stock FFA3/4/Tag reject a real Link Summon with own Extra4, first opponent2, last opponent1. Check each eligible opponent before the Summon. `opponent-count-gates-linkerbell-{1v1,ffa3,ffa4,tag}-late-eligible-opponent` and three negative controls: all seven pass on Standard and Domain. | `c54635100.lua:18` |
| 3 | 54927180 | Fukubiki | LIVE PAIR PASS | Own Blue-Eyes wins the actual excavation. Own gains Blue-Eyes; picked last sends its excavated monster to its GY. Each affected Deck loses one only. `paired-hidden-zones-fukubiki-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c54927180.lua:15, 18` |
| 4 | 57319935 | Xyz Xtreme !! | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c57319935.lua:46, 39` |
| 3 | 57585212 | Self-Destruct Button | LIVE PAIR PASS | `lp-pair-{ffa3,ffa4,tag}-button-*`: five actual zero-LP results, remaining FFA winner state, Tag draw and Tag second-team activation. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c57585212.lua:18` |
| 4 | 57823578 | Simorgh Sky Battle | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. Damage to the opponent whose monster is destroyed (bound by event) | `c57823578.lua:93` |
| 3 | 58695102 | Re-Cover | LIVE PAIR PASS | Own pays2000 and summons Re-Cover from GY when only the last Extra Deck is five larger. Only own Tag team LP changes; every other zone stays unchanged. `paired-hidden-zones-re-cover-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c58695102.lua:19` |
| 1 | 58720904 | Pendransaction | LIVE DEFECT / FIXED | Stock FFA3/4/Tag reject ignition with own Extra2, first opponent5, last opponent1. Check any eligible opponent, then bind the selected Extra Deck count. Real detach gives ATK3000. `opponent-count-gates-pendransaction-{1v1,ffa3,ffa4,tag}-late-eligible-opponent` and three negative controls: all seven pass on Standard and Domain. | `c58720904.lua:21, 25` |
| 4 | 60921537 | Dogmatikamacabre | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c60921537.lua:39` |
| 4 | 61613388 | U.A. Turnover Tactics | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c61613388.lua:81` |
| 3 | 62632427 | Margin Trading | LIVE PAIR PASS | Picked last declines discard. Actual paired Deck choices add one Monster to each paired hand. All other hands/Decks stay unchanged. `paired-hidden-zones-margin-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c62632427.lua:19, 24` |
| 4 | 62893810 | Dicelops | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c62893810.lua:17, 25` |
| 4 | 64659851 | Law of the Cosmos | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c64659851.lua:37` |
| 4 | 65424481 | Ekhajar, Descendant Dragon of the Ice Barrier | STATIC EXCLUDE | Mixed field/hand selection. Existing triage is OK-CLASS, but this audit does not prove the picked hand/field interaction. | `c65424481.lua:78` |
| 3 | 65430834 | Jurassic Impact | LIVE PAIR PASS | `player-all-lp-pair-65430834-{ffa3,ffa4,tag}-{p0,p1}`: four real destroy/damage cases with every seat checked. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c65430834.lua:32` |
| 4 | 69394324 | Destiny HERO - Dominance | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. look at the top 5 of your Deck or one bound opponent Deck | `c69394324.lua:47, 51` |
| 4 | 70865988 | Full Salvo | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c70865988.lua:18` |
| 4 | 71545247 | Cursed Bride Doll | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c71545247.lua:55` |
| 4 | 72321198 | Arcana Force XII - The Hangman | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. coin: damage you or the bound opponent | `c72321198.lua:91` |
| 3 | 73988674 | Tri-and-Guess | LIVE PAIR PASS | `lp-pair-ffa3-tri-and-guess-*`, `lp-pair-tag-tri-and-guess-pick-from-opposing-team-team-recovers`, `lp-pair-ffa4-tri-and-guess-no-extra-deck-not-offered`: five exact type-count/LP or legality cases; FFA4 is a negative control. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c73988674.lua:33, 14, 22` |
| 3 | 75249652 | Blazing Mirror Force | LIVE PAIR PASS | `local-controller-lp-75249652-{ffa3,ffa4,tag}-{p0,p1}`: four real battle activations destroy all enemy Attack monsters. Actor/event attacker each lose1800 in FFA3/Tag,2400 in FFA4; all seats checked. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c75249652.lua:41` |
| 1 | 76004142 | Bad Luck Blast | OTHER SCOPE / LIVE DEFECT | Original exact pair output passed: target Luster at p1, then pick p1, actor and picked opponent each lose950. PLAYER_ALL agent then proved an FFA activation timing defect: actor LP was7050 before the opponent picker, but must remain8000 until activation is complete. The FFA target binding fix and updated four permanent cases belong to PLAYER_ALL audit. Mixed-target restriction is now checked there; Tag retains stock joined-field behavior. | `c76004142.lua:44` |
| 4 | 76419637 | CXyz Battleship Cherry Blossom | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c76419637.lua:35` |
| 4 | 76794549 | Astrograph Sorcerer | STATIC EXCLUDE | Destroyed-card name recovery uses Extra/field/GY locations and searches the own Deck. This is not an each-player Deck action. | `c76794549.lua:112` |
| 3 | 81143465 | Tragic Twin Twined Jewels | LIVE PAIR PASS | `player-all-lp-pair-81143465-{ffa3,ffa4,tag}-{p0,p1}`: four real summon-event/damage cases with every seat checked. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c81143465.lua:57` |
| 4 | 81332143 | Yu-Jo Friendship | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. handshake with the bound opponent; both LP become the average of the two | `c81332143.lua:30` |
| 1 | 82257940 | Gift Exchange | OTHER SCOPE / LIVE DEFECT | Global agent confirmed a wrong chosen recipient in a real duel and owns this fix. The Q4 pair classification did not prove the saved player value. See the global saved-player audit; this audit does not duplicate its card file. | `c82257940.lua:16, 20` |
| 3 | 83555666 | Ring of Destruction | OTHER SCOPE / LIVE | `player-all-lp-pair-83555666-tag-{p0,p1}`: two real target/damage cases. FFA remains banned; metadata/LP scope belongs to PLAYER_ALL audit. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c83555666.lua:41` |
| 4 | 88124568 | SPYRAL Double Agent | EXISTING RULE / PAIR | Existing card rule chooses one opposing summon destination and has native proof in FFA3/FFA4/Tag. Its two Deck-top reveals are in that pair context. This audit does not add a live reveal proof. | `c88124568.lua:72` |
| 3 | 89693655 | Subspace Battle | OTHER SCOPE / LIVE | `player-all-lp-pair-89693655-{ffa3,ffa4,tag}-{p0,p1}`: four real selected-hand/LP cases with every seat checked. Controller scope belongs to the global audit. Exact existing scenarios passed in the pinned P61 Standard 59-case reuse run; no duplicate fixture added. | `c89693655.lua:22, 29` |
| 4 | 89718302 | Abare Ushioni | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. coin call: damage the bound opponent or you | `c89718302.lua:23` |
| 4 | 89839552 | Puppet Pawn | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c89839552.lua:70` |
| 3 | 90359458 | Top Share | LIVE PAIR PASS | Own and picked last each choose their unique Deck-top card. Other hands, fields, Decks and GYs stay unchanged. This case does not assert all reveal recipients. `paired-hidden-zones-top-share-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c90359458.lua:19, 30` |
| 3 | 91286284 | Gold Pride - That Came Out of Nowhere! | LIVE PAIR PASS | Own summons Leon from GY; picked last accepts and summons its unique hand monster. Other hands, fields and GYs stay unchanged. `paired-hidden-zones-gold-pride-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c91286284.lua:33` |
| 4 | 94431029 | Pinpoint Dash | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. reads or acts on one opponent hand/Deck/Extra Deck or compares you with one opponent; F5 binds that opponent (query with nothing bound: best case) | `c94431029.lua:18, 24` |
| 3 | 94446564 | Matching Outfits | LIVE PAIR PASS | Both own and picked last add their excavated Monster. All other hands and Decks stay unchanged. `paired-hidden-zones-outfits-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c94446564.lua:25` |
| 4 | 95376428 | Extra Net | STATIC PAIR | Existing OK-BIND policy: one opponent hand/Deck or one comparison/pair. No live correctness claim here. event opponent (the summoning player) may draw | `c95376428.lua:30, 31` |
| 3 | 95568112 | Rain Bozu | LIVE PAIR PASS | Own Elf gains200 in FFA3,300 in FFA4/Tag from the last individual Extra Deck count. Tag selects own Elf from shared field. Other zones and Extras stay unchanged. `paired-hidden-zones-rain-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c95568112.lua:52, 64, 79` |
| 3 | 95679145 | Dogmatika Maximus | LIVE PAIR PASS | Own and picked last each send Utopia plus Karbonala from their individual Extras. Every unpicked and partner Extra stays unchanged. `paired-hidden-zones-maximus-{1v1,ffa3,ffa4,tag}`: four permanent cases pass on Standard and Domain. | `c95679145.lua:58, 70` |
| 4 | 98139712 | Skull Invitation | OTHER SCOPE / TAG | FFA banned. Owner-based damage and global state are in the other audit scopes. No hidden-zone action or live verdict here. | `c98139712.lua:27` |
| 1 | 98520301 | Asset Mountis | LIVE DEFECT / FIXED | Stock FFA3/4 reject ignition with own hand3, first opponent6, last opponent1. Tag own9 versus opposing7 already passes. Check any FFA opponent; Tag sums opposing hands. Real ignition changes every monster to DEF. `opponent-count-gates-asset-{1v1,ffa3,ffa4,tag}-late-eligible-opponent` and three negative controls: all seven pass on Standard and Domain. | `c98520301.lua:24` |
| 5 | 14057297 | Multiple Destruction | BANNED ALL | Banned in FFA3, FFA4 and Tag. No allowed live action or fix in this audit. | `c14057297.lua:20, 45, 17, 21` |
| 5 | 17484499 | Exchange of the Spirit | BANNED ALL | Banned in FFA3, FFA4 and Tag. No allowed live action or fix in this audit. | `c17484499.lua:16` |
| 5 | 28566710 | Last Turn | BANNED ALL | Banned in FFA3, FFA4 and Tag. No allowed live action or fix in this audit. | `c28566710.lua:30` |
| 5 | 33396948 | Exodia the Forbidden One | BANNED ALL | Banned in FFA3, FFA4 and Tag. No allowed live action or fix in this audit. | `c33396948.lua:35` |
| 5 | 33508719 | Morphing Jar | BANNED ALL | Banned in FFA3, FFA4 and Tag. No allowed live action or fix in this audit. | `c33508719.lua:23, 19` |

Verdict counts: BANNED ALL: 5, EXISTING RULE / PAIR: 1, LIVE DEFECT / FIXED: 24, LIVE PAIR PASS: 24, NO DATABASE CARD: 1, OTHER SCOPE / LIVE: 2, OTHER SCOPE / LIVE DEFECT: 2, OTHER SCOPE / TAG: 2, STATIC EXCLUDE: 3, STATIC PAIR: 37, STATIC PAIR / TAG: 1.

## Live count and pair extension — 2026-10-02

The count suite has 28 permanent cases. It uses real activations, a real Link Summon, real Xyz detach costs and exact end states for every seat. Eleven cases failed against the private old overlay snapshot and seventeen passed. With the four count suffixes, all 28 passed on Standard P61 and all 28 passed on Domain P61. Four stock 1v1 controls and twelve no-eligible-opponent controls passed. Unicore has five further cases; all five passed on both cores. Its two stock Tag cases fail in opposite directions.

Count fixtures skip only the opening Draw Phase and restore it at Main Phase 1. This keeps the intended hand counts stable while another agent changes the engine first-turn draw flags. The fixture uses the existing board compiler's `EFFECT_SKIP_DP` plus Main Phase undo pattern. It does not call a card operation. Linkerbell and Pendransaction compare an individual opposing Extra Deck. Cannons and Asset Mountis use the combined opposing Tag hand; Cannons also uses the joined Tag fields and the acting duelist's own hand.

Logs: `count-gates-permanent-red.log` (11 fail / 17 pass), `count-gates-permanent-standard.log` (28 pass), `count-gates-permanent-domain.log` (28 pass), `unicore-permanent-standard.log` and `unicore-permanent-domain.log` (five pass each), under `packages/duel-server/domain-core/.build/phase1/gap-overlay/all-hands`. The command uses `DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1`, the pinned P61 `NSEAT_WASM`, the private manifest-listed `DUEL_MULTI_SCRIPTS_DIR`, and `prlimit --core=1:1 npx vitest run tests/scenarios/multiplayer/opponent-count-gates.test.ts --maxWorkers=1`.

Thirteen stock hidden-zone pair cards have fifty permanent cases in `paired-hidden-zones.ts`. All fifty pass on both pinned cores. These cases use actual card actions and check every seat. Grass has a separate seven-case suite; all seven pass on both cores. Its three multiplayer positives fail without the suffix. The unequal Deck fixture supplies each real Deck after the board compiler pads the Deck list.

The remaining static pair rows are active work. A Q4 classification establishes intended scope; it does not prove that a saved player value reaches the correct real seat.

## Existing overlays in the same scanner groups

These 106 cards had an overlay before this audit. They were outside the stock-gap candidate set. This table records coverage only; it does not claim a new live pass. Existing exact card scenarios should be used before adding another generic test.

| Code | Card | Audit verdict |
| ---: | --- | --- |
| 50755 | Magician's Circle | Existing overlay; not retested here. |
| 2139640 | Amabie | Existing overlay; not retested here. |
| 2665273 | Jormungandr, Generaider Boss of Eternity | Existing overlay; not retested here. |
| 3064425 | Superheavy Samurai Soulbang Cannon | Existing overlay; not retested here. |
| 3549275 | Dice Jar | Existing overlay; not retested here. |
| 3900605 | Absorbing Jar | Existing overlay; not retested here. |
| 4807253 | Performage Flame Eater | Existing overlay; not retested here. |
| 5611760 | Rainbow Bridge of Salvation | Existing overlay; not retested here. |
| 6783559 | Self-Destruct Ant | Existing overlay; not retested here. |
| 7852509 | Loop of Destruction | Existing overlay; not retested here. |
| 9074847 | Major Riot | Existing overlay; not retested here. |
| 9418365 | Bujin Hirume | Existing overlay; not retested here. |
| 12247206 | Inferno Reckless Summon | Existing overlay; not retested here. |
| 12694768 | Abaki | Existing overlay; not retested here. |
| 13995824 | Voltic Bicorn | Existing overlay; not retested here. |
| 14989021 | Simorgh, Bird of Divinity | Existing overlay; not retested here. |
| 18271561 | Chthonian Blast | Existing overlay; not retested here. |
| 20686759 | Morphtronic Rusty Engine | Existing overlay; not retested here. |
| 20985997 | Detonator Circle "A" | Existing overlay; not retested here. |
| 21219755 | Destruction Ring | Existing overlay; not retested here. |
| 21496848 | Evigishki Tetrogre | Existing overlay; not retested here. |
| 21623008 | Sky Striker Maneuver - Vector Blast | Existing overlay; not retested here. |
| 25926710 | Kelbek the Ancient Vanguard | Existing overlay; not retested here. |
| 29599813 | Purrely Pretty Memory | Existing overlay; not retested here. |
| 29716911 | Capacitor Stalker | Existing overlay; not retested here. |
| 30109445 | Clown Crew Dristy | Existing overlay; not retested here. |
| 30270176 | Crimson Nova the Dark Cubic Lord | Existing overlay; not retested here. |
| 30394645 | Dogmatika Lawbringer | Existing overlay; not retested here. |
| 31353051 | Exploderokket Dragon | Existing overlay; not retested here. |
| 32835363 | Cracking | Existing overlay; not retested here. |
| 33782437 | One Day of Peace | Existing overlay; not retested here. |
| 34004470 | The Big Saturn | Existing overlay; not retested here. |
| 34449261 | Fusion Fright Waltz | Existing overlay; not retested here. |
| 35842855 | Pyrorex the Elemental Lord | Existing overlay; not retested here. |
| 35998832 | Zohah, the Ogdoadic Boundless | Existing overlay; not retested here. |
| 36809777 | Brutal Beast Battle | Existing overlay; not retested here. |
| 37780349 | Destiny HERO - Dynatag | Existing overlay; not retested here. |
| 37806313 | Caravan of the Ice Barrier | Existing overlay; not retested here. |
| 38522377 | Meklord Astro Dragon Asterisk | Existing overlay; not retested here. |
| 39180960 | Rigorous Reaver | Existing overlay; not retested here. |
| 39552584 | Grapha, Dragon Overlord of Dark World | Existing overlay; not retested here. |
| 39767432 | Sorcerer of Sebek | Existing overlay; not retested here. |
| 42517468 | Ojama Pink | Existing overlay; not retested here. |
| 44968459 | Silent Burning | Existing overlay; not retested here. |
| 45742626 | Pilgrim Reaper | Existing overlay; not retested here. |
| 46031686 | Damage Polarizer | Existing overlay; not retested here. |
| 46089249 | Koa'ki Ring | Existing overlay; not retested here. |
| 46772449 | Evilswarm Exciton Knight | Existing overlay; not retested here. |
| 47233801 | Dark Snake Syndrome | Existing overlay; not retested here. |
| 48150362 | Destiny HERO - Drawhand | Existing overlay; not retested here. |
| 50470982 | The Paths of Destiny | Existing overlay; not retested here. |
| 50838440 | Three in One | Existing overlay; not retested here. |
| 51011872 | Trickstar Crimson Heart | Existing overlay; not retested here. |
| 52350806 | Danger! Mothman! | Existing overlay; not retested here. |
| 56673480 | Contract with Don Thousand | Existing overlay; not retested here. |
| 58071123 | Oxygeddon | Existing overlay; not retested here. |
| 59094601 | The Revived Sky God | Existing overlay; not retested here. |
| 61622107 | Bubble Crash | Existing overlay; not retested here. |
| 61650133 | Summoning Curse | Existing overlay; not retested here. |
| 62015408 | Ghost Reaper & Winter Cherries | Existing overlay; not retested here. |
| 62320425 | Agido the Ancient Sentinel | Existing overlay; not retested here. |
| 63378869 | Aiza the Dragoness of Deranged Devotion | Existing overlay; not retested here. |
| 64325438 | Generaider Boss Room | Existing overlay; not retested here. |
| 65589010 | Dogmatika Nation | Existing overlay; not retested here. |
| 66719324 | Rain of Mercy | Existing overlay; not retested here. |
| 68078978 | Fortune Fairy Chee | Existing overlay; not retested here. |
| 69042950 | Crashbug Road | Existing overlay; not retested here. |
| 69402394 | Dark Scheme | Existing overlay; not retested here. |
| 69840739 | Artifact Durendal | Existing overlay; not retested here. |
| 71166481 | Number 75: Bamboozling Gossip Shadow | Existing overlay; not retested here. |
| 71782404 | Red-Eyes Burn | Existing overlay; not retested here. |
| 72405967 | Royal Tribute | Existing overlay; not retested here. |
| 73082255 | The Zombie Vampire | Existing overlay; not retested here. |
| 73507661 | Fairy Wind | Existing overlay; not retested here. |
| 74117290 | Dark World Dealings | Existing overlay; not retested here. |
| 74426895 | Awakening of the Possessed - Gagigobyte | Existing overlay; not retested here. |
| 75043725 | Emissary of the Afterlife | Existing overlay; not retested here. |
| 75797046 | Photon Alexandra Queen | Existing overlay; not retested here. |
| 76895648 | Dangerous Machine Type-6 | Existing overlay; not retested here. |
| 77066768 | Card Scanner | Existing overlay; not retested here. |
| 77092311 | Tsuchigumo, the Poisonous Mayakashi | Existing overlay; not retested here. |
| 77910045 | Fatal Abacus | Existing overlay; not retested here. |
| 78098950 | Tsumuha-Kutsunagi the Lord of Swords | Existing overlay; not retested here. |
| 78679226 | Future Silence | Existing overlay; not retested here. |
| 78706415 | Fiber Jar | Existing overlay; not retested here. |
| 82734805 | Infernoid Tierra | Existing overlay; not retested here. |
| 83888009 | Rebirth of the Seventh Emperors | Existing overlay; not retested here. |
| 85862791 | Fighting Dirty | Existing overlay; not retested here. |
| 86209650 | Stray Asmodian | Existing overlay; not retested here. |
| 87602890 | Zaborg the Mega Monarch | Existing overlay; not retested here. |
| 89405199 | Greed | Existing overlay; not retested here. |
| 89462956 | Dealer's Choice | Existing overlay; not retested here. |
| 89642993 | Number 63: Shamoji Soldier | Existing overlay; not retested here. |
| 89719143 | Final Fusion | Existing overlay; not retested here. |
| 89731911 | Familiar Knight | Existing overlay; not retested here. |
| 89883517 | Mistaken Accusation | Existing overlay; not retested here. |
| 89928517 | Two-for-One Team | Existing overlay; not retested here. |
| 92219931 | Simultaneous Loss | Existing overlay; not retested here. |
| 92933195 | Mist Valley Windmaster | Existing overlay; not retested here. |
| 93469007 | Assault Overload | Existing overlay; not retested here. |
| 93671934 | Morale Boost | Existing overlay; not retested here. |
| 94919024 | Lunalight Crimson Fox | Existing overlay; not retested here. |
| 95200102 | No database name | Existing overlay; not retested here. |
| 95207988 | Earthbound Resonance | Existing overlay; not retested here. |
| 96148285 | Triggered Summon | Existing overlay; not retested here. |
| 99505609 | Bingo Card | Existing overlay; not retested here. |

## Permanent checks and reproduction

Run from `packages/duel-server`. The live data directory must be the safe `data/duel-engine-next` directory. The six permanent suites are:

- `tests/scenarios/multiplayer/all-player-zones.test.ts` — 20 cases.
- `tests/scenarios/multiplayer/all-player-decks.test.ts` — 12 cases.
- `tests/scenarios/multiplayer/all-player-zone-gaps.test.ts` — 16 cases.
- `tests/scenarios/multiplayer/all-player-extra.test.ts` — 12 cases.
- `tests/scenarios/multiplayer/underworld-circle-standby.test.ts` — 4 cases.
- `tests/scenarios/multiplayer/chaos-emperor-tag.test.ts` — 2 cases.

```sh
prlimit --core=1:1 env   DUEL_DATA_DIR=/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next   DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1   npx vitest run   tests/scenarios/multiplayer/all-player-zones.test.ts   tests/scenarios/multiplayer/all-player-decks.test.ts   tests/scenarios/multiplayer/all-player-zone-gaps.test.ts   tests/scenarios/multiplayer/all-player-extra.test.ts   tests/scenarios/multiplayer/underworld-circle-standby.test.ts   tests/scenarios/multiplayer/chaos-emperor-tag.test.ts --maxWorkers=1
```

For Domain Multi, add `NSEAT_WASM=/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/duel-engine-next/ocgcore.multi-domain.wasm`. During concurrent edits, use `DUEL_MULTI_SCRIPTS_DIR` to point at a private copy containing only a consistent manifest and its listed files.

To repeat a stock red run, copy the manifest-listed overlay folder into a test directory, omit these 16 card suffixes from that private copy and its manifest, and run the same cases. Do not move or edit the shared production files. A stock opponent-choice prompt can make a permanent all-player case fail before its board assertion; the audit's adaptive stock drivers selected the last opponent and checked every seat after resolution. The full wrong-seat results are stated in the ranked table above.

## Limits and discarded attempts

The report does not turn static exclusions into verified passes. Simultaneous Equation Cannons and The Fabled Unicore still need a separate comparison/count check. Ekhajar's mixed field/hand selection is not proved here. SPYRAL Double Agent has an existing destination rule and proof; this audit did not add a separate Deck-top reveal check. Seventh Barian's has no database card, so its script cannot provide a real-card proof here. Legal Tag LP/global-state effects remain in the damage and global-seat audit scopes.

The first Cappello Extra Deck fixture did not add any card because its string insertion searched for a ReloadFieldEnd marker that the board compiler does not emit. That result was discarded. The corrected fixture appends AddCard setup lines and produced the stated real red/green checks. The first 13-GY Alba System setup caused a slow material search and was stopped by its own worker PID. It was replaced by the seven-material Fusion plus six Gale Dogra actions; the stopped run is not a verdict. One early Gnomes FFA4 expectation used the wrong base level for Silver Fang; the corrected stock run passed FFA and failed Tag. Loader errors from concurrent unregistered card files are not card defects. Four FFA Card/Hand Destruction early-return tests are not live probes.

No production core, utility helper, ban or generated manifest was changed by this audit worker. The parent agent owns registration, manifest generation and commits. The card suffixes and permanent scenarios are the reviewable repair artifacts. Temporary audit drivers and scratch build output are removed after handoff; this report preserves all verdicts, actions, limits, counts and reproduction commands.
