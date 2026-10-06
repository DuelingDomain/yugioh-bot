# Hand effect audit, 2026-10-05

Worktree: `fix-hand-effects`. Branch: `fix/hand-effects-multi`. Base: `origin/main` at `049a4df7`.
Engine data: the read-only `~/.cache/dk-duel-engine-178` bundle. No core patch or core build.

## Local incident

This incident came from the local stack. Port 3000 runs the main web build. Port 4003 runs the server in `pr178-merge`.
The requested `data/bot.sqlite` has no duel tables. The running server's open files identify its duel DB as
`/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`.
Both DBs were opened read only. The three-hour unit journals contain no prompt or battle trace.
No unit, live DB, engine bundle, protected port, or other worktree was changed.

The latest matching FFA3 duel in the two-hour window is duel 88 (`nite2ybd`), Domain MR5.
It has 43 saved commands. It started at 23:56:14 UTC on October 5. Its last saved command is at 00:00:54 UTC on October 6.
The settings select Always responses. The schema stores actions and answers, but does not store a separate prompt history or replay file.

I replayed all 43 commands on the exact cached multi Domain core. Every saved prompt ID and revision matched.
Seat 0's final field, hand, and GY match the screenshot: Zombino, two set S/T cards, Jet in hand, White Dragon in hand, and Monster Reborn in the GY.

| Saved action | Battle result | Jet result |
| --- | --- | --- |
| 16: seat 2 Oscillo Hero attacks seat 0 Rosepamela | Rosepamela has 0 ATK. It is destroyed; seat 0 takes 1250 damage. | No legal prompt. White Dragon is only in the hand. |
| 24: seat 1 Alien Shocktrooper attacks seat 2 Oscillo Hero | Oscillo Hero is destroyed. | Same failed White Dragon condition. |
| 26: seat 1 Zombino attacks seat 2 directly | Damage only. No destruction. | No destruction trigger. |
| 33: seat 2 Zombino attacks seat 1 Zombino | Both 2000 ATK monsters are destroyed. | Same failed White Dragon condition. |
| 36–40: seat 0 uses Monster Reborn | Seat 0 revives seat 2's Zombino. | No destruction. |
| 43: seat 0 Zombino attacks seat 1 Alien Shocktrooper | Alien Shocktrooper is destroyed. | Same failed White Dragon condition. |

The engine never sent a Jet prompt in this replay. No player or response mode declined Jet.
The log shows the owner was attacked while it controlled Rosepamela. It does not show the owner's revived Zombino being attacked.

## Jet rules

Read the real `card-scripts/official/c30576089.lua` in the cached bundle.

- A field card must be destroyed. An attack or damage alone is insufficient.
- White Dragon must be on the owner's field or in its GY. A White Dragon in hand does not qualify.
- The summon is optional, once per turn, and can trigger in the Damage Step. Its `DELAY` flag keeps it after an earlier chain link.
- Jet in the GY must already be there when destruction occurs. Jet destroyed in that group cannot use this trigger.
- The return effect is at the start of the Damage Step when Jet itself battles. Another Dragon's battle does not qualify.
- Jet protects other own cards from opponent effects. It does not protect Jet itself or prevent an own Dark Hole.

These conditions agree with the [official Jet card text](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=16809&ope=2&request_locale=en).

## Faults and fixes

1. `packages/web/src/components/duel/prompts.tsx:94`: effect Yes/No options have no card zone. The engine's source has the hand zone, but the UI did not use it. The hand did not glow or offer Activate. Map only Yes to the owner's exact source zone. No stays in the prompt panel.
2. `packages/web/src/components/duel/room.tsx:371`: the 1v1 field did not use the reveal gate used by FFA and Tag. It could accept a hand chain action before the prompt appeared. Use the same gate, then accept one answer after reveal. Keep the gate in the callback dependencies. Board card and zone picks still accept the first click.
3. `packages/duel-server/domain-core/multi-scripts/c40640057.lua:5`: stock Kuriboh checks one seat's pending damage. A Tag partner sees zero although the team shares LP. Check either own-team seat, then register damage prevention on both seats. A condition-only fix would still lose LP.
4. `packages/duel-server/src/legacy/script-compat.ts:6`: current `chain.lua` reads triggering Scale and Link values in a bulk snapshot. The normal legacy npm core rejects them when Kuriboh registers its damage prevention effect. Omit only those two unsupported snapshot values. Keep the core, supported properties, direct getters, and Domain unchanged.

The stock Kuriboh failure is in `c40640057.lua:26` during effect registration, through `chain.lua:137,577`.
It is not a discard-cost failure. Chain ID 13 is valid; Scale 32 is the first rejected query.

## Host, response mode, and reveal

The host routes the engine's seat prompt. A wrong-seat answer fails with 409 and adds no saved command.
The 104 host cases use real engine destruction prompts for all owners, hand/GY, battle/effect, normal/Domain, and all four formats.
The fixture worker starts at a known post-destruction prompt; it does not test a host restart from those fixture commands.
The existing real host test separately verifies mode journal replay and restart.

`src/chain-mode.ts` is correct for the tested event windows:

| Mode | Optional destruction trigger | Hand Quick Effect |
| --- | --- | --- |
| Auto | Ask. Both SELECT_EFFECTYN and SELECT_CHAIN pass the tests. | Ask at matching script hint windows; skip idle windows with `spe_count=0` outside Draw/Standby. |
| Always | Ask. | Ask in every legal optional response window. |
| Off | Skip optional triggers and optional chains by the existing policy. | Skip optional chains. |

Forced effects and choices inside a resolving effect follow separate rules. No response policy changed.
The local incident used Always, so Auto cannot explain it.

`fix/chain-intro-click` has the same `field-gate.ts` rule as main. The gate holds panel prompts, including hand chains, until reveal.
It allows board picks at once. Tests cover the actual 1v1 reveal timer, FFA/Tag shells, and `chainPromptHoldEndAt`.
No dropped legal hand answer was found after reveal.

## Deck audit

No named Blue-Eyes test deck is tracked in main. The matching local deck has 60 main cards, 6 extra cards, no side cards, and Sage as Deck Master.
The read-only deck card list is saved in `packages/duel-server/tests/fixtures/decks/blue-eyes-owner-2026-10-05.json`.
This fixture contains card codes only. Sage is not in this owner's main deck, but its hand effect is tested separately.

The table records stock Lua timing and local engine results. It is not a claim that every card in the full card database was tested.

| Card | Legal hand timing or limit | Local checks |
| --- | --- | --- |
| Kuriboh | Before battle damage calculation; own side must take damage on the opponent's turn. | All seats, formats, both modes; Tag partner and wrong-side controls; legacy 1v1. |
| Honest | Own LIGHT monster battles, during the Damage Step before calculation. | FFA/Tag outcomes, unrelated battle controls, normal/Domain current and legacy 1v1. |
| Gorz | Own side takes damage while controlling no cards. Its optional `when` trigger can miss timing. | Battle/effect damage, field-card and unrelated damage negatives; Chain Link 2 damage timing negative; current/legacy 1v1. |
| Effect Veiler | Opponent Main Phase; target a face-up opponent Effect Monster. | Far-seat and event target cases, Tag partner turn negative, Auto/Always 1v1 current/legacy. |
| Ash Blossom | Chain to an effect with the listed Deck actions. | Every owner and format in normal/Domain, Auto/Always, current/legacy 1v1; draw is negated. |
| Maxx C | Quick Effect; draw for the bound opponent's Special Summons. Not a Damage Step effect. | Event binding, far seats, Tag own/opponent teams; Auto/Always current/legacy 1v1. |
| Sage | Own Main Phase hand ignition; discard, target own Effect Monster, send it, summon a Blue-Eyes from Deck. | Positive outcome; Normal Monster and non-turn negatives. |
| Dragon Spirit of White | No activated hand effect. Its field Quick Effect summons White Dragon from the holder's own hand. | Field Quick Effect outcome; hand negative; partner's hand cannot supply White Dragon. |
| Alternative White Dragon | Special Summon procedure reveals White Dragon in own hand. | Positive summon/reveal and absent-White negative. |
| Chaos MAX | No activated hand effect. It needs a Ritual Summon. | Hand activation and direct Special Summon negatives. |
| Deep-Eyes White Dragon, the Blue Abyss | Hand discard/search ignition; optional hand/GY summon after own Blue-Eyes Ritual Monster or White Dragon enters GY, except during Damage Step. | Every owner, format, mode, location: effect-send positive and battle-send negative; current/legacy 1v1. |
| White Phantom Beast | Optional hand trigger when own side's monster is destroyed by battle. | Non-turn FFA seat and Tag partner summon; its following optional destruction resolves. |
| Chronicle Magician | Optional hand summon after own side summons a monster with 2500 original ATK or DEF; outside Damage Step. | Reborn trigger, summon, and White Dragon ATK/DEF gain. |
| Mystical Elf – White Lightning | Chain to opponent field monster activation while own side controls a Level 5+ Normal Monster. | Non-turn FFA and Tag opponent hand response; Trooper effect is negated. |
| Rosepamela | Opponent-turn hand Quick Effect: reveal, search a Dominus, discard a card. | Non-turn FFA and Tag outcome. |
| Maiden of White | Own Main Phase hand ignition. Send itself to GY; place True Light face up. | Full outcome. |
| Neo Kaiser Sea Horse | Own Main Phase hand ignition while White Dragon is on own side's field. | Full summon outcome. |
| Songs of the Dominators | Hand Trap only with no own-side GY monsters. Its hand use blocks all hand/GY/banished monster effects through the end of next turn. | Every owner and format: negate Trooper, destroy White Dragon, then Jet stays in hand. |
| Dominus Purge | Hand Trap needs an opponent field card and the proper chain. Hand use blocks DARK/WATER/FIRE effects for the duel. | Every owner and format: negate Pot, then LIGHT Jet still summons after destruction. |
| Dominus Spark | Hand Trap needs an opponent hand/GY monster activation that turn. Hand use blocks EARTH/WATER/FIRE/WIND. | Existing Tag timing proof; LIGHT Jet is outside the script's attribute lock. |
| Maiden with Eyes of Blue, Master, Protector, Ancients, Kaibaman the Legend, Astellar, Magician of Faith | No activated effect from hand in their scripts. Relevant ranges are field or GY. | Lua range audit; Ancients hand negative. |

The six Extra Deck cards have no hand activation path. The remaining main-deck Spells activate in the usual own Main Phase.
Quick-Play Spells activate from hand on the holder's turn; opponent-turn use needs them set in advance.
Breakthrough Skill and True Light do not have an activated hand Trap effect.
These range and timing limits follow the actual scripts, not UI guesses.

The cached Blue Abyss English text omits its Damage Step exclusion. The [official OCG FAQ](https://www.db.yugioh-card.com/yugiohdb/faq_search.action?cid=22717&ope=4&request_locale=ja)
explicitly excludes the Damage Step. The stock Lua already follows that rule; it was not changed.

## Before and after

Both normal and Domain run in each row unless a row states normal only. Each Jet positive cell covers hand and GY, battle and effect destruction.
All positive Jet cases include a qualifying White Dragon. Raw messages must name the holder's seat after destruction and before Damage Step end.

| Format / engine | Owner seat(s) | Trigger / path | Before | After |
| --- | --- | --- | --- | --- |
| 1v1 current + legacy | 0, 1 | Jet; attacker and defender | Engine asks and summons | Pass |
| FFA3 | 0, 1, 2 | Jet; attacker, attacked non-turn owner, third seat outside battle | Engine asks and summons | Pass |
| FFA4 | 0, 1, 2, 3 | Jet; attacker, defender, outside battle | Engine asks and summons | Pass |
| Tag | 0, 1, 2, 3 | Jet; attacker, defender, outside battle | Engine asks and summons | Pass |
| All formats; legacy 1v1 too | Every owner | Jet; White only in hand / no destruction | No legal Jet prompt | Pass |
| FFA3/FFA4/Tag web | Every owner | Hand effect Yes/No | 11 missing glow/Activate cases fail | 59 cases pass |
| 1v1 web | 0, 1 | Hand trigger or chain reveal | 4 early-action cases fail | 4 cases pass; one legal answer after reveal |
| Tag | 0, 1, 2, 3 | Kuriboh for attacked partner | 16 Auto/Always partner cases fail | Ask, discard, prevent team damage |
| Legacy normal 1v1 | 0, 1 | Kuriboh for own damage | 4 Auto/Always activation cases crash | Ask, discard, prevent damage |
| All formats; legacy 1v1 too | Every owner | Songs blocks Jet / Purge allows LIGHT Jet | Stock rule unchanged | Pass |
| All formats; legacy 1v1 too | Non-turn owner | Jet `if` after CL2 destruction; CL1 then resolves | Stock rule unchanged | Pass |
| All formats; legacy 1v1 too | Every owner | Blue Abyss effect-send positive / battle-send negative | Stock rule unchanged | Pass |
| All formats | Every owner | Host Jet prompt, privacy, response authority | Host rule unchanged | 104 cases pass |

## Verification

Targeted Vitest checks: **2147 passed, 1 skipped**. The skip is the pre-existing comparison against a missing local triage file.
All real-core cases ran; none were skipped. No test expectation was weakened.

- Jet/Kuriboh/overlay/Spark engine run: 1179 pass, 1 local triage skip.
- Rule matrix and real Jet host routing: 576 pass.
- Deck hand audit: 184 pass.
- Host modes, real mode replay, optional trigger modes, core identity: 49 pass.
- New hand UI cases: 63 pass. Existing field-click and chain-beat checks: 96 pass.
- Server and web TypeScript checks pass. `git diff --check` passes.

Tests use Node 22. Cores come from the unchanged cached bundle. No e2e stack or core build was needed.

## Owner decisions

- Confirm whether the report also refers to another duel. The matching saved duel has no attack on the owner's revived Zombino.
- Keep Off skipping optional triggers? Auto currently asks for tested event triggers but skips idle Quick Effect windows. Always asks at every legal window.
- Update the displayed Blue Abyss text during a later data refresh. Keep its official Damage Step limit.

These questions do not block the tested fixes. No push, PR, merge, or deployment was made.
