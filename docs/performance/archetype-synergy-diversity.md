# Outside synergy diversity — 2026-10-31

Base: `171976276`, branch `feat/archetype-bridges`. Follow-up to [the guaranteed outside share](archetype-synergy-outside-share.md).

Works with now retains at most **three cards from any other archetype**, applied to ranked candidates before the 25-card outside share and pagination. All known engine memberships count; SQL-only catalogs fall back to primary membership. Ungrouped cards remain independent. The 15-card member/support share and existing score/popularity/newest ordering are preserved. Sparse pools stay sparse.

The SQL path retains only the best three candidates per identical membership set, or 25 ungrouped candidates, then applies the same shared selector as the duel query path. Rejected overlapping memberships never consume another group's allowance. Totals describe the selected results before the API page limit.

Blue-Eyes' typed Deck-setup hook now requires a printed deliberate Deck-send clause and compatible same-event material restrictions. Random milling cannot satisfy that hook even when compact tags call the excavated cards monsters. **Tearlaments Scheiren, Glow-Up Bulb, Reasoning, Tuning, Chaos Ruler, Berserker Soul and Sylvan Dancepione** no longer qualify through incidental milling. Deliberate monster selection, Normal Monster setup and unrestricted card selection remain eligible, including Foolish Burial, Primite Dragon Ether Beryl, Beatrice and Curious. Cards can still qualify through another independently verified hook.

## Read-only measurements

Defaults: `queryCards` with `emptyCardQuery()`, and SQL `effectSearch`, each requesting 120 rows. Opened `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite` with `{readonly:true,fileMustExist:true}`, using that worktree's existing `data/duel-engine-next` printed catalog. No request to :3000. Both entry points agree on all five totals and the outside top tens. Every retained host outside membership was checked against the three-card cap.

| Query | Member | Support | Outside | Total |
| --- | ---: | ---: | ---: | ---: |
| Temple of the Kings synergy | 1 | 8 | 24 | 33 |
| Monarch synergy | 5 | 10 | 25 | 40 |
| Labrynth synergy | 15 | 0 | 25 | 40 |
| Blue-Eyes synergy | 9 | 6 | 25 | 40 |
| synergy with Temple of the Kings and Blue-Eyes | 1 | 0 | 0 | 1 |

Temple's fourth Labrynth partner, Farewelcome Labrynth, is diversity-filtered from the default list but still qualifies in an explicit pool. Its hooks were not weakened. Temple retains Trap Holic. The shared Temple/Blue-Eyes result remains Blue-Eyes Tyrant Dragon with no outside filler.

## Requested outside top tens

All Monarch scores are **140**; all Blue-Eyes scores are **110**. Blue-Eyes' listed hook is deliberate Dragon-compatible Deck setup. Monarch uses the opponent-Tribute hook except Soul Exchange's printed Tribute substitution and Empen/Ancient Chant's extra Tribute Summons.

| Rank | Monarch | Blue-Eyes |
| --- | --- | --- |
| 1 | Nibiru, the Primal Being | Foolish Burial |
| 2 | Gameciel, the Sea Turtle Kaiju | Dragon Shrine |
| 3 | Jizukiru, the Star Destroying Kaiju | Dragon Ravine |
| 4 | Dogoran, the Mad Flame Kaiju | Primite Dragon Ether Beryl |
| 5 | Lair of Darkness | Advanced Ritual Art |
| 6 | Kurikara Divincarnate | Beatrice, Lady of the Eternal |
| 7 | Soul Exchange | Elemental HERO Prisma |
| 8 | Santa Claws | Shooting Riser Dragon |
| 9 | Floowandereeze & Empen | Mausoleum of White |
| 10 | Ancient Chant | Number 95: Galaxy-Eyes Dark Matter Dragon |

Lair rises from outside rank 9 to 5; Soul Exchange rises from 11 to 7. Only the three leading Kaiju remain.

## Validation

The added SQL and real-engine integration assertions failed on the old behavior before implementation. Coverage includes full lists, constrained pools, overlapping memberships, newest ordering, total with a one-card limit, pagination, ungrouped cards, deliberate setup and incidental milling.

- SQL/shared integration suites: **101 passed, 14 skipped**.
- Real-engine synergy/effect-search suites: **178 passed**, including all **19 targeted synergy cases**. The final run excludes only the same two pre-existing failures reproduced by the full run and documented in the prior report: missing Field Power Bonus and Genesys expecting Lava Golem while the artifact ranks Skull Meister first.
- **279 passing integration checks** in total; no new unit tests. The 111-query evaluation remains complete with 154 true positives, 141 true negatives, zero false positives and zero false negatives.
- Shared build and shared/duel-server typechecks pass; `git diff --check` passes.
- Independent read-only review approved the final matcher, diversity selector and integration coverage.

Generated shared build output and the evaluation scratch file are removed before committing. No web or bridge implementation files were changed. No live DB writes, .env reads, paid calls, service restarts, process kills, or changes to `data/duel-engine`. Only explicit owned paths are committed.
