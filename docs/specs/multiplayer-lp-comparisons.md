# FFA LP comparison review (owner, 2026-10-21; follow-up 2026-10-22)

The source is the owner's supplied ruling for [issue #435](https://github.com/DuelingDomain/yugioh-bot/issues/435): **"Lower than ALL"**, and the **2026-10-22 follow-up**: two-branch lower/higher cards use their higher branch whenever the controller is not lower than every living opponent, except that all equal stays neutral. [ADR 0002](../adr/0002-multiplayer-duel-rules.md) records both decisions. A one-branch lower or higher condition still requires the corresponding strict relation against every living opponent.

Reviewed the original 100 local LP-query candidates at the pinned card-script revision: 69 comparison candidates and 31 other queries. A broader scan of all 255 official LP-query scripts found four additional comparison cards. The complete reviewed comparison set is **73 cards: 61 covered by the shared helper, 12 exceptions**. The ignored discovery JSON is not a shipped input.

`aux.MPCompareLP` reads every living opponent through the read-only real-seat query added by core patch 0119. It never changes an existing opponent binding or seat rebind, and never asks for an opponent. FFA-only suffixes leave stock 1v1 and Tag scripts unchanged. Existing all-duelist overlays keep their operations and decision picks.

Self-Destruct Button now requires the controller's LP to be at least 7000 below **every living opponent**, replacing the previous any-qualifying-opponent activation rule. Once that condition holds, its existing opponent pick and pair-only LP-zero operation remain unchanged. A single opponent with a smaller gap prevents activation; Tag still compares the two team LP pools.

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
| 67616300 | Chicken Game | Global lowest-LP damage protection needs per-recipient and tied-lowest semantics; not a controller/opponent condition. |
| 70219023 | Coordius the Triphasic Dealmon | owner ruling 2026-10-23: the activation choice supplies both the destruction field and the half-difference ATK amount after costs. |
| 73167098 | Aromalilith Magnolia | Shared unanimous comparison helper. |
| 74202664 | One or Eight | Shared unanimous comparison helper. |
| 79656239 | Aromaseraphy Sweet Marjoram | Shared unanimous comparison helper. |
| 80036543 | Hope for Escape | Condition only; existing numerical difference unchanged. |
| 81332143 | Yu-Jo Friendship | Average and share one pair of LP totals, not a lower/higher condition. |
| 81758313 | Myriaday Dragon | owner ruling 2026-10-23: choose a legal living opponent for the Main Phase counter amount; highest-living fallback if no legal choice remains. |
| 81916745 | Lycoris Lilyreaper | owner ruling 2026-10-23: remember the field recovery opponent; the GY damage trigger and LP amount refer to the same opponent. |
| 85636437 | Edge of the Ring | Shared unanimous comparison helper. |
| 856784 | Draw of Fate | Shared unanimous comparison helper. |
| 85787173 | Generation Next | LP difference is a selection limit; no explicit lower/higher condition to replace without choosing a numerical policy. |
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

The scenario kit covers mixed totals, all opponents lower, all opponents higher, partial ties, all equal, positive-LP surrendered seats, every controller seat, bound and nested scopes, global Pin Baller protection, exact required gaps, draws for every living player, turn 34 timing, named/inline summon conditions, higher-LP Aroma conditions, Supremacy Berry and Wyvern lower-first branches, Soul Drain Dragon's real Special Summon trigger, Sweet Marjoram's actual target protection, and stock 1v1/Tag results. Only touched scenario families are run with `test:engine`, `NSEAT_LIVE=1` and `DUEL_REQUIRE_CORES=1`. No unit tests were added. All 61 reviewed overlay scripts also load through real Standard and Domain cores in FFA3, FFA4 and Tag.

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

The continuous/automatic choice is a card flag in a separate multiplayer namespace (not the card ID, which can also identify custom events). It survives being Set and changing control; leaving the field resets it. A selected seat that becomes the controller itself is no longer an opponent and uses the same fallback. Values and eligibility callbacks never prompt; a card-attached Adjust operation makes the first choice. A normal summon sequence reaches Adjust before the value is first used. LP source selection reuses `MPChooseOpponent`'s seat option descriptors and does not narrow unrelated fields or mutate a caller's binding/window. The pre-existing helpers are unchanged; only new helpers are appended to minimize conflicts with PR #458.

A public engine card hint carries the actual seat. The card inspector shows **“LP opponent: Player N”** for face-up cards, including spectators; Set cards expose no hint. The view immediately shows the living fallback after elimination, and detaching a material does not clear its host's hint. Hidden field shuffles erase cached coordinates; revealing a remembered card re-emits its own hint. Removing earlier cards from a public pile compacts the hint coordinates with that pile.

Real-engine scenarios cover all six cards in FFA3, FFA4 and Tag on both multi cores, plus legacy 1v1 controls for each. Additional scenarios exercise a real Xyz Summon, remembered LP under unrelated bindings, burn recipient and summon actor, chosen destruction fields, a face-down/face-up stay, hidden field shuffles, banished-pile compaction, leaving/re-summoning, temporary control changes, nonzero controller/attacker seats, positive-LP surrender, equal-LP legality, differing counter choices, Lycoris recovery tracking and unrestricted field selection, and Coordius's combined destruction/ATK and End Phase reset. None of these six IDs has an existing note in `src/banlists/multiplayer.ts`, so no note needs changing.
