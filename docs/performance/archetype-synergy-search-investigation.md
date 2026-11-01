# Archetype synergy search investigation — 2026-10-31

> The coordinator rejected the broad matcher below. Its results and conclusions are superseded by [the quality correction](archetype-synergy-search-quality.md).

Cause: the imported SQL/duel-host search paths used `matchCard(... query.supports)` to require explicit archetype support tags (or the archetype name in the candidate name). They never consulted the stored outside-card profile hooks. With two archetypes, `matchSupports` required both names, so the result was empty. The SQL prefix shortcut could additionally resolve `Monarch` to the fuzzy card anchor `The First Monarch`.

All three live archetype profiles exist and parse, each with six hooks. No generation was necessary. Paid LLM spend: **$0**.

## History and scope

Fix commit: `922de69308fd4c5aba3f6dbe6269f4b9b7eb8fe5`.

- Local `main`: `25665eda3a45aee88bdbc32f04f1046061d03802`. It predates effect search; `synergy.ts`, `search-intents.ts`, and the insights route are absent there. Its card browser has literal name/text search.
- Reported local build: `870c3eaec3b5f08434d58edf15c253bedf7de021`.
- Investigation base: `b909771463791c1a72c8aa5cafc468da37ec3370` on `feat/archetype-bridges`.
- The four requested comparison files, the SQL service, and the duel-host effect index are identical between the reported build and investigation base. The recent bridge UI changes did not introduce this behavior.
- The initial SQL insights implementation, `044c0760a690bb9ec7ee5d4c3788642a167e24ef`, already routes these searches through named support matching. This is an omission in the searchygo integration, rather than missing profiles.

## Fix

Both search entry points now use the same compiled matcher for named support tags and outside-card hooks. Multi-archetype results are a ranked union: candidates fitting both come first. Hook-count strength and existing popularity break ties. Searchygo’s broad-hook cutoff (5%, with the narrowest-hook fallback) remains in use against the full population, independent of the requested pool and filters. Exact archetype targets take precedence over fuzzy card anchors; the per-card Works with operation and non-archetype exact card targets retain their existing path.

Card/effect/date/format constraints, cached hard readings, chip removal and explicit pools remain enforced. Explicit Rank/Link hooks keep their intended meaning; ordinary Level hooks exclude Ranks and Link Ratings. Dated results retain their hook explanations. The browser itself is unchanged, and integration coverage verifies the See bridges button remains visible and opens Bridges alongside the card results.

## Read-only before/after measurements

Measured through `queryCards`, the same matcher used by the Cards tab, with `emptyCardQuery()` defaults and a top-10 page. SQLite was opened with `{readonly: true, fileMustExist: true}` at `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`. The existing `data/duel-engine-next` bundle supplied printed metadata through its read-only loader. The live `data/duel-engine` directory was not modified. These are direct matcher measurements, without HTTP fallback or a deployment to :3000. The before results exactly reproduce the owner’s 6/40/0 report.

### Temple of the Kings synergy

Matches: **6 → 963**.

| Rank | Before | After |
| --- | --- | --- |
| 1 | Temple of the Kings | Ryu Senshi |
| 2 | The Man with the Mark | Lightstorm Dragon |
| 3 | Treasures of the Kings | Fossil Machine Skull Wagon |
| 4 | Anubis the Last Judge | Elemental HERO Wild Wingman |
| 5 | Verdict of Anubis | Gem-Knight Prismaura |
| 6 | Defense of the Temple | Trap Holic |
| 7 | — | Transcendosaurus Gigantozowler |
| 8 | — | Farewelcome Labrynth |
| 9 | — | Evil Dragon Ananta |
| 10 | — | That's 10! |

### Monarch synergy

Matches: **40 → 450**.

| Rank | Before | After |
| --- | --- | --- |
| 1 | The Monarchs Stormforth | Lair of Darkness |
| 2 | Mobius the Frost Monarch | Radian, the Multidimensional Kaiju |
| 3 | Caius the Shadow Monarch | Soul Crossing |
| 4 | Eidos the Underworld Squire | Link Devotee |
| 5 | Edea the Heavenly Squire | Clown Crew Biancaviso |
| 6 | Erebus the Underworld Monarch | Mitsurugi no Miko, Wousu |
| 7 | Domain of the True Monarchs | Spell Card "Soul Exchange" |
| 8 | Zaborg the Thunder Monarch | Genia of the Ring |
| 9 | Ehther the Heavenly Monarch | Lich Lord, King of the Underworld |
| 10 | Pantheism of the Monarchs | Vendread Reorigin |

### synergy with Temple of the Kings and Blue-Eyes

Matches: **0 → 2726**.

| Rank | Before | After |
| --- | --- | --- |
| 1 | — | Lightstorm Dragon |
| 2 | — | Primite Dragon Nether Berzelius |
| 3 | — | Sunvine Shrine |
| 4 | — | Hieratic Dragon of Sutekh |
| 5 | — | Red-Eyes Dark Dragoon |
| 6 | — | Elder Entity N'tss |
| 7 | — | Dark Magician Girl the Dragon Knight |
| 8 | — | Trident Dragion |
| 9 | — | Sangenpai Transcendent Dragion |
| 10 | — | Judgment Dragon |

`cards that work with Monarch` has the same before and after top 10 and totals as `Monarch synergy` in the Cards-tab path. In the initial SQL-service reproduction, that prefix query instead chose `The First Monarch`; it now resolves to the Monarch archetype. Every top-10 combined-query result fits both requested archetypes.

## Validation

- Shared integration files: `archetype-synergy-search`, `card-insights`, `effect-search`, `cube-effect-search`: **94 passed, 15 skipped**.
- Signed web route integration files: `deck-effect-search-route`, `card-insights-route`: **32 passed**.
- New real-engine UI cases: **3 passed**; includes single-archetype outside partners and combined results plus the See bridges button.
- Real-engine host integration file: **159 passed** with two pre-existing failures excluded on the final run. Its 111-query labeled evaluation reports 154 true positives, 141 true negatives, no false positives or false negatives.
- Shared, duel-server and web TypeScript checks pass. Shared build passes.
- Focused code review approved after fixing its Rank/Link, full-population selectivity and dated-reason findings.

The initial full host integration run had two failures: the installed engine-next bundle lacks `Field Power Bonus`, and a Genesys staple test expects `Lava Golem` while the current artifact ranks `Skull Meister` first. The initial full UI file had one failure expecting `Played in 100% of TCG decks`. All three reproduce on untouched `b90977146` in an isolated archive with the same dependencies and engine-next bundle. They are outside this fix and were not rewritten.

Only integration tests were added. Shared build output, TypeScript build information, the isolated baseline archive and generated scratch/evaluation files are removed after validation. No live database writes, paid model calls, server restarts, or changes to bridge implementation files.
