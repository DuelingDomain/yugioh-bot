# FFA LP comparison review (owner, 2026-10-21)

The source is the owner's supplied ruling for [issue #435](https://github.com/DuelingDomain/yugioh-bot/issues/435): **"Lower than ALL"**, with strict higher treated symmetrically. [ADR 0002](../adr/0002-multiplayer-duel-rules.md) records the rule, mixed/tie behavior and the two Equip Spells' reduced fallback.

Reviewed the original 100 local LP-query candidates at card-script pin `432617da992b2520c387e5d0b0eaf3107b39ae8e`: 69 comparison candidates and 31 other queries. A broader scan of all 255 official LP-query scripts found four additional comparison cards. The complete reviewed comparison set is **73 cards: 61 covered by the shared helper, 12 exceptions**. The ignored discovery JSON is not a shipped input.

`aux.MPCompareLP` reads every living opponent through the read-only real-seat query added by core patch 0119. It never changes an existing opponent binding or seat rebind, and never asks for an opponent. FFA-only suffixes leave stock 1v1 and Tag scripts unchanged. Existing all-duelist overlays keep their operations and decision picks.

For an LP difference, this ruling determines **whether** a lower/higher branch can apply. It does not specify which opponent supplies a numerical difference. We preserve the existing amount formula and its existing scope (a chosen opponent in an activated effect, or the existing aggregate in an unbound continuous value). Those cards are marked **condition only** below. Ancient Sacred Wyvern returns zero adjustment when neither strict relation holds; Mars grants no bonus unless higher than all; Gorgoneio grants no bonus unless lower than all. Their amount formulas otherwise remain unchanged. Psychic End Punisher's separate ATK-difference effect and Handigallop's ATK value are not resolved by this ruling.

Supremacy Berry has independent lower/higher conditions: mixed totals and partial ties allow neither result. Its activation therefore requires one of those conditions. The two lower-first Equip Spells have the separately documented owner-example fallback.

## Comparison candidates

| Code | Card | Applied scope / exception |
| --- | --- | --- |
| 14169843 | Aromage Laurel | Shared unanimous comparison helper. |
| 16759958 | Aromaseraphy Angelica | Shared unanimous comparison helper. |
| 17178486 | Life Equalizer | Prior owner ruling (2026-10-18): compare and change one chosen pair. |
| 1969506 | Puppet Ritual | Shared unanimous comparison helper. |
| 21200905 | Aromaseraphy Jasmine | Shared unanimous comparison helper. |
| 22046459 | Megamorph | Shared unanimous comparison helper. |
| 22174866 | Aromage Cananga | Shared unanimous comparison helper. |
| 22390469 | Gold Pride - Star Leon | Shared unanimous comparison helper. |
| 23512906 | Gold Pride - Leon | Shared unanimous comparison helper. |
| 2434862 | Cubic Ascension | Shared unanimous comparison helper. |
| 25334372 | Tsukumo Slash | Battle-specific ATK difference; no lower/higher condition. Needs a separate amount ruling. |
| 25861589 | Aroma Blend | Shared unanimous comparison helper. |
| 25958491 | Ancient Sacred Wyvern | Condition only; existing numerical difference unchanged. |
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
| 46497537 | Pig Iron vs. Pen Peg | Equality condition; the owner ruling specifies strict lower/higher, not equality effects. |
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
| 62991886 | Unstable Evolution | Shared unanimous comparison helper. |
| 63875853 | Trading Places | Prior owner ruling (ADR Q4): exchange LP with one chosen opponent. |
| 65430834 | Jurassic Impact | Shared unanimous comparison helper. |
| 65892585 | Gold Pride - Chariot Carrie | Shared unanimous comparison helper. |
| 67616300 | Chicken Game | Global lowest-LP damage protection needs per-recipient and tied-lowest semantics; not a controller/opponent condition. |
| 70219023 | Coordius the Triphasic Dealmon | Absolute LP difference for an ATK effect; no unanimous lower/higher condition. |
| 73167098 | Aromalilith Magnolia | Shared unanimous comparison helper. |
| 74202664 | One or Eight | Shared unanimous comparison helper. |
| 79656239 | Aromaseraphy Sweet Marjoram | Shared unanimous comparison helper. |
| 80036543 | Hope for Escape | Condition only; existing numerical difference unchanged. |
| 81332143 | Yu-Jo Friendship | Average and share one pair of LP totals, not a lower/higher condition. |
| 81758313 | Myriaday Dragon | Absolute LP difference determines counters; no unanimous lower/higher condition. |
| 81916745 | Lycoris Lilyreaper | Absolute LP difference sets a card-selection amount; separate amount ruling needed. |
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
| 98380593 | Supremacy Berry | Shared unanimous comparison helper. |

The broader review adds these four cards, which the original discovery regex missed because they use controller expressions rather than `tp`:

| Code | Card | Applied scope / exception |
| --- | --- | --- |
| 11502550 | Elemental HERO Air Neos | Condition only: lower than all; preserve the stock difference amount. |
| 12510878 | Neo-Parshath, the Sky Paladin | Condition only: higher than all; preserve the stock difference amount. |
| 92346415 | Psychic Sword | Condition only: lower than all; preserve the stock capped difference amount. |
| 90162951 | Number 35: Ravenous Tarantula | Absolute LP-difference ATK amount; separate amount ruling needed. |

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

The scenario kit covers mixed totals, all opponents lower, all opponents higher, partial ties, all equal, positive-LP surrendered seats, every controller seat, bound and nested scopes, global Pin Baller protection, exact required gaps, draws for every living player, turn 34 timing, named/inline summon conditions, higher-LP Aroma conditions, independent Supremacy Berry branches and stock 1v1/Tag Equip results. Only touched scenario families are run with `test:engine`, `NSEAT_LIVE=1` and `DUEL_REQUIRE_CORES=1`. No unit tests were added. All 61 reviewed overlay scripts also load through real Standard and Domain cores in FFA3, FFA4 and Tag.
