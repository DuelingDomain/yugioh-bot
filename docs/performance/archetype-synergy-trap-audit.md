# Trap synergy filter audit — 2026-10-31

Base: `04d016cfe`, branch `feat/archetype-bridges`. This corrects the loose Trap hook introduced by the earlier synergy-search work.

The same action/trigger must reach the deck's Trap mechanic through `filterReachesCard`: Normal/Continuous Traps for the Set-Trap plan (Temple), Normal Traps for Labrynth. Unnamed mechanic witnesses intentionally cannot satisfy named-other-archetype filters. Unresolved restrictions fail closed, including restrictions stored in `other` or action notes. The duel facets now retain `other`, notes and conditions, with each included in its interning key.

Deck searches and Deck/hand Sets score 140. GY re-Sets score 115; GY-to-hand recovery scores 110. Reasons describe the actual action and source. An excavated Trap Set is labeled as excavation; top-card acquisition is not called a search. Normal Trap removal scores 130 and describes the actual field-removal action, without borrowing another action/cost or another engine's resource.

Existing quotas, the three-per-other-archetype cap, constraints and pagination are unchanged. Cards with expensive but genuine conditional Trap interactions remain conditional recommendations: Tyrant needs its Fusion access; Auroradon needs Machine Link materials, then can supply its own three Tribute Tokens. These are not cost-free or universally playable recommendations.

## Read-only measurements

Both `queryCards` with `emptyCardQuery()` and SQL `effectSearch`, requesting 120 rows, returned exactly the following outside lists, scores and reasons in the same order. Both use the existing `domain-multiplayer/data/duel-engine-next` catalog. The app database was opened at `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite` with `{readonly:true,fileMustExist:true}`. No request or database write to :3000 was made.

| Query | Member/support | Works with | Total |
| --- | ---: | ---: | ---: |
| Temple of the Kings synergy | 9 | 25 | 34 |
| Labrynth synergy | 15 | 25 | 40 |

All known outside engine memberships satisfy the three-card cap. Temple's retained Labrynth cards are Lady, Arianna and Arias. Lovely, Labrynth Labyrinth and Farewelcome can still qualify independently; default-list absence is diversity/ranking, not a claim that their effects stopped working. No generic backfill was introduced.

## Temple of the Kings: complete Works with list

The clause column paraphrases the printed matching effect, including its material condition. Normal/Continuous filters can reach Temple's Set-Trap mechanic; Counter-Trap-only filters cannot.

| Rank | Card | Score | Matched effect clause / condition |
| --- | --- | ---: | --- |
| 1 | Trap Trick | 140 | Banish a Normal Trap from Deck; Set another copy from Deck. Only one further Trap activation that turn. |
| 2 | Lord of the Heavenly Prison | 140 | After a Set Spell/Trap activates, Summon itself; if previously revealed, Set a Spell/Trap from Deck, banished next End Phase. |
| 3 | Lady Labrynth of the Silver Castle | 140 | When a Normal Trap activates, Set a differently named Normal Trap from Deck. |
| 4 | Arianna the Labrynth Servant | 140 | When your Normal Trap removes a monster, draw, then optionally Set a Spell/Trap from hand. |
| 5 | Lilith, Lady of Lament | 140 | Tribute a DARK monster, including herself; reveal three Normal Traps from Deck, opponent chooses one to Set. |
| 6 | Arias the Labrynth Butler | 140 | Send itself from hand/field to GY; Set a Normal Trap from hand, usable that turn. |
| 7 | Wannabee! | 140 | End Phase: send itself to GY, excavate according to opponent's unused backrow zones, Set an excavated Trap until next End Phase. |
| 8 | Angel of Blue Tears | 140 | After effect damage, banish itself from GY; Set a Normal Trap from hand or Deck. |
| 9 | Trap Holic | 140 | Destroy your Spell/Trap; Set a Normal Trap from Deck except itself. Its own immediate-activation permission needs three Traps in GY. |
| 10 | Trap Tracks | 140 | Destroy your monster; Set a Normal Trap from Deck except itself, usable immediately. Only one further Trap activation that turn. |
| 11 | Pharaonic Advent | 140 | Tribute a Fairy, Fiend or Reptile; add a Continuous Trap from Deck. Temple's Apophis Reptiles can pay; Special Summons then stop. |
| 12 | Qardan the Clear-Sighted | 140 | On Normal Summon, Set a Continuous Trap from hand or GY, usable that turn. |
| 13 | Booby Trap E | 140 | Discard one; Set a Continuous Trap from hand or GY, usable that turn. |
| 14 | Argostars - Fierce Parthe | 140 | Banish itself from your field; Set a Continuous Trap from hand, usable that turn. This effect does not require an Argostars Trap. |
| 15 | Annihilate Retroglight | 140 | When this Set card is destroyed by an opponent's effect, Set a Trap from Deck. |
| 16 | Garden of Talistones | 140 | Standby Phase: reveal five differently named Continuous Traps from Deck; opponent randomly chooses one to Set. |
| 17 | Blue-Eyes Tyrant Dragon | 115 | After it battles, at Damage Step end, target a Trap in your GY and re-Set it. Requires access to Tyrant. |
| 18 | Malice, Lady of Lament | 115 | Tribute two monsters; re-Set a Normal Trap from GY/banishment, returning it to Deck bottom when it leaves. |
| 19 | Boo-Boo Game | 115 | When this Set card is destroyed by an opponent's effect and reaches GY, re-Set up to two other Normal Traps from GY. |
| 20 | Loris, Lady of Lament | 115 | After another monster is Tributed, or an opponent's effect sends a Normal Trap to your GY, re-Set a Normal Trap from GY. |
| 21 | Boogie Trap | 115 | Discard two cards; re-Set a Trap from GY, usable that turn. |
| 22 | Trap Gatherer | 115 | After equipped monster wins a battle or deals battle damage, send this Equip to GY; re-Set a Trap from GY. |
| 23 | Emissaries from Darkness | 115 | During End Phase, if Special Summoned that turn, re-Set a Trap from GY. Its hand effect can Summon itself after taking damage. |
| 24 | Mask of Darkness | 110 | Flip: return a Trap from your GY to your hand. Recursion, not a Deck search. |
| 25 | Mecha Phantom Beast Auroradon | 110 | Tribute three monsters; return a Trap from GY to hand. It generates three Tokens after Link Summoning; Machine material access remains necessary. |

## Labrynth: complete Works with list

Rows 9–25 are Normal Traps with an actual monster-removal effect, which can feed Labrynth's monster-leaves-field payoff. They do not qualify merely because they are Normal Traps. Any hand-only Attribute lock can be avoided by Setting the relevant Dominus Trap; Purge's DARK lock makes this especially important for Labrynth.

| Rank | Card | Score | Matched effect clause / condition |
| --- | --- | ---: | --- |
| 1 | Trap Trick | 140 | Banish a Normal Trap from Deck; Set another copy from Deck. Only one further Trap activation that turn. |
| 2 | Lord of the Heavenly Prison | 140 | After a Set Spell/Trap activates, Summon itself; if previously revealed, Set a Spell/Trap from Deck, banished next End Phase. |
| 3 | Lilith, Lady of Lament | 140 | Tribute a DARK monster, including herself; reveal three Normal Traps from Deck, opponent chooses one to Set. |
| 4 | Wannabee! | 140 | End Phase: send itself to GY, excavate according to opponent's unused backrow zones, Set an excavated Trap until next End Phase. |
| 5 | Angel of Blue Tears | 140 | After effect damage, banish itself from GY; Set a Normal Trap from hand or Deck. |
| 6 | Trap Holic | 140 | Destroy your Spell/Trap; Set a Normal Trap from Deck except itself. Its immediate-activation permission needs three Traps in GY. |
| 7 | Trap Tracks | 140 | Destroy your monster; Set a Normal Trap from Deck except itself, usable immediately. Only one further Trap activation that turn. |
| 8 | Annihilate Retroglight | 140 | When this Set card is destroyed by an opponent's effect, Set a Trap from Deck. |
| 9 | Mirror Force | 130 | When an opponent's monster attacks, destroy all their Attack Position monsters. |
| 10 | Dominus Impulse | 130 | Negate an effect that Special Summons; with a Trap in GY, destroy that card. Can destroy a monster activating on field. |
| 11 | Torrential Tribute | 130 | When monsters are Summoned, destroy all monsters on the field. |
| 12 | Bottomless Trap Hole | 130 | When opponent Summons monsters with at least 1500 ATK, destroy and banish those monsters. |
| 13 | Dominus Purge | 130 | Negate a Deck-to-hand effect; with a Trap in GY, destroy that card. Set it to avoid its hand-only DARK-effect lock. |
| 14 | Dogmatika Punishment | 130 | Send an Extra Deck monster with sufficient ATK to GY; destroy the targeted opposing monster. Extra Deck Summons are then restricted. |
| 15 | Compulsory Evacuation Device | 130 | Return a targeted monster on the field to hand. |
| 16 | Ice Dragon's Prison | 130 | Revive opponent's GY monster; optionally banish one monster from each field sharing a Type. The revived monster can supply your side. |
| 17 | Storming Mirror Force | 130 | When an opponent's monster attacks, return all their Attack Position monsters to hand. |
| 18 | Ring of Destruction | 130 | On opponent's turn, destroy their targeted face-up monster whose ATK does not exceed their LP; then resolve damage. |
| 19 | Sakuretsu Armor | 130 | Target and destroy an attacking opponent's monster. |
| 20 | Paleozoic Dinomischus | 130 | Target a face-up card; discard a card, then banish the target. It can target a monster. |
| 21 | Raigeki Break | 130 | Discard a card; destroy a targeted card on the field, including a monster. |
| 22 | Trap Hole | 130 | When opponent Normal/Flip Summons a monster with at least 1000 ATK, target and destroy it. |
| 23 | Dimensional Prison | 130 | When an opponent's monster attacks, target and banish that monster. |
| 24 | Dominus Spark | 130 | Target and banish an opposing monster; without a Trap in your GY, opponent may then Summon from hand. |
| 25 | Needle Ceiling | 130 | With at least four monsters on the field, destroy all face-up monsters. |

## Rejected or conservatively omitted hooks

| Cards | Why the hook does not establish the claimed help |
| --- | --- |
| Minerva, Scholar of the Sky | Counter-Trap-only GY recovery and a Sanctuary requirement; neither reaches the relevant Trap mechanic nor constitutes search/Set. |
| Guiding Ariadne; Sacred Arch-Airknight Parshath | Their Deck acquisition is Counter-Trap-only. |
| Traptrix Myrmeleo, Dionaea, Cularia | Hole-only search/re-Set/payoff; Cularia's restriction was previously lost from `other` by duel facets. |
| Armament Reincarnation | Only equipping Spell/Trap resources; the stored narrow filter cannot establish access to the target mechanic. |
| Paleozoic Anomalocaris | Conditional top-card acquisition, not deliberate Trap search or Set. |
| A Cat of Ill Omen | Adding the Trap requires Necrovalley; otherwise it goes on top of Deck. |
| Kelbek; Exchange of Despair and Hope | Their matching Set additionally needs Exchange of the Spirit; the latter also needs an EARTH Fairy board. |
| Loki, Lord of the Aesir | Recovery is tied to self-revival requiring a Nordic Alfar Tuner payment. |
| Sunvine Shrine; Legendary Knight Critias; Litmus Doom Swordsman; Sacred Serpent's Wake; Diabrocken | Unproven named activation/Summoning engine, Ritual condition, multi-Extra-Deck board, or Link-material trigger for the matching effect. |
| Traptrix Mantis; The Despair Uranus | Mantis borrowed Normal Trap immunity text from another effect for a generic hand Set; Uranus lets opponent choose Spell instead. |
| Silhouhatte Rabbit; outside Labrynth Archfiend | Narrow self-Summoning/attack-declaration Trap restrictions in notes are conservatively omitted without a concrete reachable-card witness. Archfiend remains a Labrynth member. |
| Dragonmaid Tidying; Icarus Attack; Cybernetic Overflow | Removal also demands an unsupported own Dragon, Winged Beast, or Cyber Dragon payment. Overflow's tag loses the name but retains an unresolved resource restriction. |
| Artifact Sanctum | Kept out of direct-removal recommendations: its activated effect needs an Artifact engine; its only removal is the secondary destruction retaliation. |
| Evenly Matched; Destructive Daruma Karma Cannon | Player-forced rule removal does not satisfy this profile's monster-leaves-by-Normal-Trap-effect hook. Local official scripts use `REASON_RULE`; Arianna's trigger checks `REASON_EFFECT`. |

These are search-hook decisions, not blanket statements that a card can never be played in either deck. Unknown narrow hooks fail closed rather than promising access that the available evidence cannot prove.

## Verification

The new SQL and real-catalog integration cases failed on the original behavior before implementation. The tests cover Counter/named/free-text filters, source-specific reasons, weaker recovery, same-effect resource checks, named prerequisites, conditional rule removal, and existing search shares/diversity/pagination.

- Shared SQL/effect-search/card-insights/cube integration: **102 passed, 15 skipped**.
- Duel synergy/effect-search integration: **182 passed**, including all **23** synergy cases. Two existing fixture failures were reproduced by the full run: missing Field Power Bonus and Genesys expecting Lava Golem while the fixture ranks Skull Meister. The final passing run excludes exactly these two cases.
- **284 passing integration checks** across these suites; no new unit tests.
- The complete 111-query evaluation remains at 154 true positives, 141 true negatives, zero false positives and zero false negatives.
- Shared build and shared/duel-server typechecks pass; `git diff --check` passes.
- Existing disk-backed facet-initialization integration passes. A separate read-only compiled facet preparation/serialization check also passes at the production **32 MiB** old-space limit, retaining **13,693 facets / 530 profiles** and the Hole restriction.
- Independent read-only review checked both query paths, facet interning and every retained printed clause. It found and verified the additional named-cost, player-rule-removal and incompatible-resource exclusions.

Build output and audit/evaluation scratch files are removed before committing. No web or bridge implementation files, live database writes, environment-file reads, paid calls, service restarts, or changes to `data/duel-engine`.
