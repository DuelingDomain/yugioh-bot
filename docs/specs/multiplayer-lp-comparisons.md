# FFA LP comparison review (owner, 2026-10-21; follow-up 2026-10-22)

The source is the owner's supplied ruling for [issue #435](https://github.com/DuelingDomain/yugioh-bot/issues/435): **"Lower than ALL"**, and the **2026-10-22 follow-up**: two-branch lower/higher cards use their higher branch whenever the controller is not lower than every living opponent, except that all equal stays neutral. [ADR 0002](../adr/0002-multiplayer-duel-rules.md) records both decisions. A one-branch lower or higher condition still requires the corresponding strict relation against every living opponent.

Reviewed the original 100 local LP-query candidates at the pinned card-script revision: 69 comparison candidates and 31 other queries. A broader scan of all 255 official LP-query scripts found four additional comparison cards. The #449 follow-up also reviews all three shipped prerelease LP-query scripts. The complete reviewed comparison set is **74 cards: 63 covered by the shared helper, 11 exceptions** (including Bergamot's existing battle-specific overlay). The ignored discovery JSON is not a shipped input.

`aux.MPCompareLP` reads every living opponent through the read-only real-seat query added by core patch 0119. It never changes an existing opponent binding or seat rebind, and never asks for an opponent. FFA-only suffixes leave stock 1v1 and Tag scripts unchanged. Existing all-duelist overlays keep their operations and decision picks.

Self-Destruct Button now requires the controller's LP to be at least 7000 below **every living opponent**, replacing the previous any-qualifying-opponent activation rule. Once that condition holds, its existing opponent pick and pair-only LP-zero operation remain unchanged. A single opponent with a smaller gap prevents activation; Tag still compares the two team LP pools.

**Chicken Game follow-up (owner, #449, 2026-10-23):** a player takes no battle or effect damage only while their LP is strictly lower than every other living player's LP. Protection is evaluated for each damaged player, independently of the Field Spell's controller or an attack/effect's bound opponent. Tied-lowest players are unprotected; eliminated players do not count. At seats 0–3 = **7000/8000/7000/1850**, a 2400 direct attack reduces seat 0 to 4600; seat 3 takes no damage. The FFA suffix retains the stock activation and ignition effects and replaces the four controller/opponent protection effects with two card-attached, absolute-seat effects per living player. The shared helper checks the captured real seat at damage time. Removing or disabling the Field Spell still disables its protection. 1v1 and Tag retain stock scripts.

For an LP difference, this ruling determines **whether** a lower/higher branch can apply. It does not specify which opponent supplies a numerical difference. We preserve the existing amount formula and its existing scope (a chosen opponent in an activated effect, or the existing aggregate in an unbound continuous value). Those cards are marked **condition only** below. Ancient Sacred Wyvern uses the absolute magnitude of its existing LP difference, subtracting it when lower than all and adding it otherwise; all equal gives zero adjustment; Mars grants no bonus unless higher than all; Gorgoneio grants no bonus unless lower than all. Their amount formulas otherwise remain unchanged. Psychic End Punisher's separate ATK-difference effect and Handigallop's ATK value are not resolved by this ruling.

## Two-branch cards (owner follow-up, 2026-10-22)

The inventory contains four cards with lower/higher branches. Mixed totals and partial ties use the higher branch for all four. Equality with every living opponent stays neutral. This replaces the earlier neutral Wyvern / unavailable Berry interpretation; the two Equip Spells already followed this fallback.

| Card | Lower than every living opponent | Otherwise, including mixed LP and partial ties | All equal |
| --- | --- | --- | --- |
| Unstable Evolution | 2400 ATK | 1000 ATK | No ATK change |
| Megamorph | Double original ATK | Half original ATK | No ATK change |
| Supremacy Berry | Recover 2000 LP | Can activate; take 1000 damage | Cannot activate |
| Ancient Sacred Wyvern | Lose ATK equal to the existing difference magnitude | Gain ATK equal to the existing difference magnitude | Zero adjustment |

For example, at 5000 vs 3000/7000/9000, Unstable Evolution gives 1000 ATK, Megamorph halves ATK, Supremacy Berry can activate and deals 1000 to its controller, and Wyvern gains 4000 ATK (6100 total). Wyvern keeps the current unbound maximum-opponent LP query for the amount: `abs(5000 - 9000) = 4000`; this follow-up selects the branch/sign without choosing a new opponent or changing the amount scope. After the 3000-LP opponent surrenders, Wyvern instead loses 4000 ATK because 5000 is now below every survivor.

Single-branch effects retain unanimous comparisons. Soul Drain Dragon gains ATK on Special Summon only when lower than all; mixed LP and partial ties do not trigger it. Aromaseraphy Sweet Marjoram protects Plants from opposing effect targeting only when higher than all. Mars, Gorgoneio and other one-branch cards remain unchanged. Eliminated seats, even with positive LP, are excluded. 1v1 and Tag retain stock behavior.

## Comparison candidates

| Code | Card | Applied scope / exception |
| --- | --- | --- |
| 14169843 | Aromage Laurel | Shared unanimous comparison helper. |
| 16759958 | Aromaseraphy Angelica | Shared unanimous comparison helper. |
| 17178486 | Life Equalizer | Prior owner ruling (2026-10-18): compare and change one chosen pair. |
| 1969506 | Puppet Ritual | Shared unanimous comparison helper. |
| 21200905 | Aromaseraphy Jasmine | Shared unanimous comparison helper. |
| 22046459 | Megamorph | Two-branch lower-first fallback; see table above. |
| 22174866 | Aromage Cananga | Shared unanimous comparison helper. |
| 22390469 | Gold Pride - Star Leon | Shared unanimous comparison helper. |
| 23512906 | Gold Pride - Leon | Shared unanimous comparison helper. |
| 2434862 | Cubic Ascension | Shared unanimous comparison helper. |
| 25334372 | Tsukumo Slash | owner ruling 2026-10-23: use the battle opponent for the inequality check and ATK amount; highest-living fallback if unavailable. |
| 25861589 | Aroma Blend | Shared unanimous comparison helper. |
| 25958491 | Ancient Sacred Wyvern | Two-branch sign; existing difference magnitude and scope retained. |
| 26357901 | Imprudent Intrusion | Condition only; existing numerical difference unchanged. |
| 28265983 | Dried Winds | Condition only; existing numerical difference unchanged. |
| 28497830 | Gold Pride - Pin Baller | Shared unanimous comparison helper. |
| 28957126 | Evil Eye of Gorgoneio | Condition only; existing numerical difference unchanged. |
| 29189613 | Aroma Gardening | Shared unanimous comparison helper. |
| 29353756 | ZW - Eagle Claw | Shared unanimous comparison helper. |
| 32164201 | ZW - Pegasus Twin Saber | Shared unanimous comparison helper. |
| 32875265 | Puppet Parade | Shared unanimous comparison helper. |
| 34137269 | Hailon, the Timelord | Condition only; existing numerical difference unchanged. |
| 35705817 | Ghost Fusion | Shared unanimous comparison helper. |
| 36224040 | Rank-Up-Magic Zexal Force | Shared unanimous comparison helper. |
| 38148100 | Aromaseraphy Rosemary | Shared unanimous comparison helper. |
| 39396763 | Dyna Base | Shared unanimous comparison helper. |
| 4017398 | Zexal Entrust | Shared unanimous comparison helper. |
| 40663548 | Aromage Marjoram | Shared unanimous comparison helper. |
| 45464587 | Gold Pride - Eradicator | Shared unanimous comparison helper. |
| 46497537 | Pig Iron vs. Pen Peg | owner ruling 2026-10-23: any equal-LP living opponent enables the GY Set effect; use one equal opponent. |
| 51011872 | Trickstar Crimson Heart | Shared unanimous comparison helper. |
| 55673611 | Psychic Trigger | Shared unanimous comparison helper. |
| 55735315 | Soul Drain Dragon | Condition only; existing numerical difference unchanged. |
| 57069605 | Frozen Soul | Shared unanimous comparison helper. |
| 57585212 | Self-Destruct Button | Shared unanimous comparison helper. |
| 58569561 | Aromage Rosemary | Shared unanimous comparison helper. |
| 58884063 | Gold Pride - Nytro Blaster | Shared unanimous comparison helper. |
| 59900655 | Gold Pride - Nytro Head | Shared unanimous comparison helper. |
| 60203670 | Gold Pride - Eliminator | Shared unanimous comparison helper. |
| 60465049 | Psychic End Punisher | Condition only; existing numerical difference unchanged. |
| 62991886 | Unstable Evolution | Two-branch lower-first fallback; see table above. |
| 63875853 | Trading Places | Prior owner ruling (ADR Q4): exchange LP with one chosen opponent. |
| 65430834 | Jurassic Impact | Shared unanimous comparison helper. |
| 65892585 | Gold Pride - Chariot Carrie | Shared unanimous comparison helper. |
| 67616300 | Chicken Game | #458: per-recipient protection only when strictly lower than every other living player; ties unprotected. |
| 70219023 | Coordius the Triphasic Dealmon | owner ruling 2026-10-23: choose one opponent for the destruction field and half-difference ATK after costs. |
| 73167098 | Aromalilith Magnolia | Shared unanimous comparison helper. |
| 74202664 | One or Eight | Shared unanimous comparison helper. |
| 79656239 | Aromaseraphy Sweet Marjoram | Shared unanimous comparison helper. |
| 80036543 | Hope for Escape | Condition only; existing numerical difference unchanged. |
| 81332143 | Yu-Jo Friendship | Average and share one pair of LP totals, not a lower/higher condition. |
| 81758313 | Myriaday Dragon | owner ruling 2026-10-23: choose a legal living opponent for the Main Phase counter amount; highest-living fallback if no legal choice remains. |
| 81916745 | Lycoris Lilyreaper | owner ruling 2026-10-23: remember the field recovery opponent; the GY damage trigger and LP amount refer to the same opponent. |
| 85636437 | Edge of the Ring | Shared unanimous comparison helper. |
| 856784 | Draw of Fate | Shared unanimous comparison helper. |
| 85787173 | Generation Next | owner ruling 2026-10-23: unchanged — compares with the selected opponent |
| 85967160 | Aromage Bergamot | Existing card-specific rule compares the attacked opponent (issue #215); retain it. |
| 86532744 | Number S39: Utopia Prime | Shared unanimous comparison helper. |
| 91123920 | The Agent of Force - Mars | Condition only; existing numerical difference unchanged. |
| 91345518 | The Agent of Judgment - Saturn | Condition only; existing numerical difference unchanged. |
| 92003832 | Gold Pride - Roller Baller | Shared unanimous comparison helper. |
| 92266279 | Humid Winds | Shared unanimous comparison helper. |
| 96305350 | Gold Pride - Captain Carrie | Shared unanimous comparison helper. |
| 96592102 | Raidraptor - Blade Burner Falcon | Shared unanimous comparison helper. |
| 96661780 | Riryoku Guardian | Shared unanimous comparison helper. |
| 96789758 | Aromage Jasmine | Shared unanimous comparison helper. |
| 97637162 | Handigallop | Condition only; existing numerical difference unchanged. |
| 97926515 | Emerging Emergency Rescute Rescue | Shared unanimous comparison helper. |
| 98380593 | Supremacy Berry | Two-branch lower-first fallback; see table above. |

The broader review adds these four cards, which the original discovery regex missed because they use controller expressions rather than `tp`:

| Code | Card | Applied scope / exception |
| --- | --- | --- |
| 11502550 | Elemental HERO Air Neos | Condition only: lower than all; preserve the stock difference amount. |
| 12510878 | Neo-Parshath, the Sky Paladin | Condition only: higher than all; preserve the stock difference amount. |
| 92346415 | Psychic Sword | Condition only: lower than all; preserve the stock capped difference amount. |
| 90162951 | Number 35: Ravenous Tarantula | owner ruling 2026-10-23: choose on summon/first application; remember the opponent for ATK/DEF, burn and destruction throughout the field stay. |

The prerelease review adds one condition-only fix:

| Code | Card | Applied scope |
| --- | --- | --- |
| 101403001 | The Sun God's Poet - Helpoemer | #449 audit: optional discard requires every living opponent to have at least 2000 more LP (`MPCompareLP(tp,"<=",2000)`). The selected opponent does not narrow the condition. Preserve the search and chosen discard recipient; Tag unchanged. |

## #449 audit (2026-10-23)

Searched all pinned card scripts for `Duel.GetLP`, compared the results with `multi-scripts/MANIFEST.json`, and inspected direct comparisons, local LP variables, damage-prevention scripts, and numerical differences. All **255 official** and **3 shipped prerelease** LP-query scripts were included. No additional official damage-prevention card has an uncovered relative lower-LP condition. Chicken Game and prerelease Helpoemer are the two clear fixes; the latter previously offered a discard against a rich selected opponent even when another living opponent was poorer or less than 2000 ahead.

The #458 audit originally left these ten relative-LP scripts unchanged. The LP difference/equality audit below resolves six of them; its later rulings supersede the corresponding reasons in this historical table:

| Code | Card | Reason unchanged |
| --- | --- | --- |
| 17178486 | Life Equalizer | Prior pair-only ruling; absolute 8000-LP gap and pair LP replacement. |
| 63875853 | Trading Places | Prior pair-only ruling; compare and exchange one chosen pair. |
| 46497537 | Pig Iron vs. Pen Peg | Equality condition; a strict lower/higher ruling does not define equality behavior. |
| 25334372 | Tsukumo Slash | Battle-specific inequality and absolute ATK-difference amount. |
| 70219023 | Coordius the Triphasic Dealmon | Nonzero difference enables an ATK effect; amount/inequality policy needed. |
| 81758313 | Myriaday Dragon | Absolute LP difference sets counters. |
| 81916745 | Lycoris Lilyreaper | Absolute LP difference sets a selection amount. |
| 85787173 | Generation Next | owner ruling 2026-10-23: unchanged — compares with the selected opponent |
| 81332143 | Yu-Jo Friendship | Average/share a chosen pair; no lower-LP protection condition. |
| 90162951 | Number 35: Ravenous Tarantula | Absolute LP difference sets ATK. |

Other reviewed lookalikes are outside this bug class: Reflect Bounder (2851070) and prerelease Zombyra (100459012) compare a recipient's LP before/after damage; they do not compare two players. Prerelease Armor Wizard Pazoo (100200297) checks a fixed 4000-LP threshold. Dinomorphia damage-prevention effects check their controller against **2000 LP**, not another player. Fixed opponent thresholds (for example Meteor of Destruction and Meteor Flare), LP exchanges/halving, and LP-derived ATK amounts (for example Life Hack, Endless Decay and Odd-Eyes Revolution Dragon) need their existing recipient/amount policies, not this unanimous comparison change. Existing overlays already cover Psychic End Punisher, Pin Baller, Aromaseraphy Sweet Marjoram and all other reviewed lower/higher protection conditions; Bergamot retains its attacked-opponent ruling.

The wider scan also finds lower/higher/equality comparisons in bundled unofficial, Rush and Skill scripts. None of those card IDs are present in the shipped merged `cards.cdb`; no overlays are added for them. They would need a separate rules/support decision before enabling those card pools.

Review regressions also cover copying Chicken Game onto Pseudo Space with a pre-existing `EFFECT_CHANGE_DAMAGE` or `EFFECT_NO_EFFECT_DAMAGE`: only the stock protection effects added by that initialization call are reset. The simultaneous Tremendous Fire case starts at 7000/7200 LP and ends at 7000/6200; sequential opponent-first damage would instead remove the 7000-LP player's protection before their 500 damage. These regressions run on both multiplayer cores in FFA3/FFA4.

## LP queries without a relative comparison

These cards query an opponent's LP for a fixed threshold, direct LP change, damage amount or similar effect. The new lower/higher rule does not apply; their existing scripts and recipient rules remain unchanged.

- Berserker Soul (15381252)
- Minor Goblin Official (1918087)
- Number C43: High Manipulator of Chaos (32446630)
- Earthbound Immortal Cusillu (33537328)
- Meteor of Destruction (33767325)
- Trickstar Light Stage (35371948)
- Go! - D/D/D Divine Zero King Rage (40227329)
- Mamonaka the Vaylantz United (40680521)
- Earthbound Greater Linewalker (45836982)
- Machina Ruinforce (46033517)
- Constellar Tempest (4820694)
- Judge of the Ice Barrier (53535814)
- Contract with Don Thousand (56673480)
- Meteor Flare (56856951)
- Reversal Quiz (5990062)
- Number C88: Gimmick Puppet Disaster Leo (6165656)
- Number C6: Chronomaly Chaos Atlandis (6387204)
- Deception of the Sinful Spoils (66328392)
- Earthbound Prison (71089030)
- Lil-la Rap (72233469)
- Loss Time (72453068)
- Crimson Nova Trinity the Dark Cubic Lord (72664875)
- Michion, the Timelord (7733560)
- Endless Decay (7845138)
- Nirvana High Paladin (80896940)
- Gunkan Suship Catch-of-the-Day (83008724)
- Ring of Destruction (83555666)
- El Dorado Adelantado (92379223)
- Pinpoint Dash (94431029)
- Heroic Gift (95920682)
- Cubic Karma (9659580)

## Reproduction and verification

The original stock script produces **2400 rather than 1000** for Unstable Evolution at 5000 vs 3000/7000/9000 because unbound `GetLP(1-tp)` returns the maximum LP of living opponents; the lower branch is first. Megamorph doubles ATK for the same reason.

The public issue reports two survivors but supplies no LP totals, card controllers or replay. On the current real Domain core, all eight stock controls (all four Equip controllers, richer opponents surrendering before and after equip) correctly recalculate to 1000. A further stock control reaches turn 34, seat 2 End Phase, with seats 0 and 2 alive and verifies 1000 ATK inside that phase; it also passes before the overlay fix. Infinite Cards prevents unrelated hand-limit choices during this long control. Thus the exact two-survivor capture is **not reproduced** and cannot be attributed to eliminated LP without more evidence. A possible observation mismatch exists in `host.ts`'s bug-context path: it can use an older paired report capture while counting living seats against the current surrendered set. This is a hypothesis, not an established cause of #435. Keep these late-game scenarios as regressions rather than claiming they previously failed.

The scenario kit covers mixed totals, all opponents lower, all opponents higher, partial ties, all equal, positive-LP surrendered seats, every controller seat, bound and nested scopes, global Pin Baller protection, exact required gaps, draws for every living player, turn 34 timing, named/inline summon conditions, higher-LP Aroma conditions, Supremacy Berry and Wyvern lower-first branches, Soul Drain Dragon's real Special Summon trigger, Sweet Marjoram's actual target protection, and stock 1v1/Tag results. Only touched scenario families are run with `test:engine`, `NSEAT_LIVE=1` and `DUEL_REQUIRE_CORES=1`. No unit tests were added. All 63 reviewed overlay scripts also load through real Standard and Domain cores in FFA3, FFA4 and Tag.

## LP difference/equality audit — owner ruling 2026-10-23

This resolves the six numerical/equality exceptions below, including the corresponding unresolved rows in PR #458's #449 audit. It applies to FFA3/FFA4 on both multi cores. Tag retains the stock team LP behavior and legacy 1v1 never loads these suffixes. Other comparison and amount rulings remain as recorded above.

| Code | Card | owner ruling 2026-10-23 / stock text and script review |
| --- | --- | --- |
| 90162951 | Number 35: Ravenous Tarantula | Choose one living opponent on summon or first face-up application. Keep that real seat throughout the field stay. All your monsters gain ATK **and DEF** equal to the current absolute LP difference. Only that opponent's Special Summons trigger its 600 damage, and only that opponent's qualifying face-up monsters are destroyed by the detach effect. The burn still requires material; detachment and the ATK threshold stay stock. |
| 81758313 | Myriaday Dragon | Its Main Phase effect chooses a living opponent whose LP difference permits counters at resolution; place `floor(abs(own LP - chosen LP)/1000)` counters. Its End Phase 100-LP payment, 10-counter ATK/DEF bonus and destruction replacement use no opponent and stay stock. |
| 81916745 | Lycoris Lilyreaper | Its automatic on-field GY tracking chooses on summon/first application and remembers that opponent for the field stay. Recover only from monsters sent to that opponent's GY. In the GY, the effect-damaged opponent binds the trigger and the LP amount: a different undamaged opponent cannot supply the amount, because both clauses say “your opponent.” A unique legal event opponent needs no extra prompt. The send can still select **any field**, as the text says “1 monster from the field.” Banish cost, once-per-turn limits and ATK ceiling stay stock. |
| 70219023 | Coordius the Triphasic Dealmon | Use the existing activation opponent choice. Destroy only that opponent's three cards, and use half the absolute difference with that opponent's **current, post-cost** LP for the ATK option, rounded down. The selected effects, recovery option, attack restriction and End Phase reset stay stock. |
| 25334372 | Tsukumo Slash | Use the real defending monster's controller for both the non-equality condition and the absolute ATK bonus. Equal LP with the defender prevents activation even if a bystander has different LP. The lower-ATK attacking-monster condition and damage-calculation-only reset stay stock. |
| 46497537 | Pig Iron vs. Pen Peg | The GY Set effect is legal if **any living opponent** has exactly your LP. Use one matching opponent (choose when several match); a positive-LP surrendered seat never qualifies. Its separate stat-reset activation, payment and Set operation stay stock. |

**Fallback:** when a legal source cannot be chosen/used, or the remembered/bound opponent is eliminated, use the **highest living opponent LP**, as for Ancient Sacred Wyvern. Ties use the first real seat for recipient/field consistency. No living opponent means own LP, hence zero difference in an already finished duel. A lack of legal counters or a legal monster still cannot make an otherwise illegal activation legal.

The continuous/automatic choice is a card flag in a separate multiplayer namespace (not the card ID, which can also identify custom events). Being Set, changing control or leaving the field resets both the choice and its hint (`RESET_EVENT|RESETS_STANDARD|RESET_CONTROL`). A revealed monster is treated as a new card and chooses again; each new controller also chooses, including when temporary control returns. Values and eligibility callbacks never prompt; a card-attached Adjust operation makes the first choice. A normal summon sequence reaches Adjust before the value is first used. LP source selection reuses `MPChooseOpponent`'s seat option descriptors and does not narrow unrelated fields or mutate a caller's binding/window. The pre-existing helpers are unchanged; only new helpers are appended to minimize conflicts with PR #458.

A public engine card hint carries the actual seat. The card inspector shows **“LP opponent: Player N”** for face-up cards, including spectators; Set cards expose no hint. Myriaday's hint ends with its counter resolution. Coordius's activation hint lasts through the chain; applying the ATK option extends it until the End Phase reset. Every card's hint uses the highest-living fallback after elimination; a pending loss still supplies LP until the core marks that seat eliminated, matching `MPGetLP`. Detaching a material does not clear its host's hint. Hidden field shuffles erase cached coordinates; revealing a card makes a new choice and emits its own hint. Field reload snapshots retain hints at surviving coordinates, even when the unchanged Lua flag emits no new label. Removing earlier cards from a public pile compacts the hint coordinates with that pile.

Real-engine scenarios cover all six cards in FFA3, FFA4 and Tag on both multi cores, plus legacy 1v1 controls for each. Additional scenarios exercise a real Xyz Summon, remembered LP under unrelated bindings, burn recipient and summon actor, chosen destruction fields, fresh choices after Set/reveal and temporary control changes, hidden field shuffles, banished-pile compaction, leaving/re-summoning, nonzero controller/attacker seats, positive-LP surrender, equal-LP legality, differing counter choices, Lycoris recovery tracking and unrestricted field selection, and Coordius's combined destruction/ATK and End Phase reset. Coordius's empty-GY Fusion Gate case also proves that an opponent with lower LP permits activation when the highest opponent ties the controller: the unbound check considers every living opponent, and the chain-relation guard applies at resolution rather than during the initial cost check. The existing web ATK integration test renders Tarantula's real chosen/fallback labels for players and spectators. None of these six IDs has an existing note in `src/banlists/multiplayer.ts`, so no note needs changing.
