# Synergy search quality correction — 2026-10-31

This corrects the rejected matcher in `922de6930` and supersedes the conclusions in [the initial investigation](archetype-synergy-search-investigation.md). Base: `a167b80df`, branch `feat/archetype-bridges`.

## Matching and ranking

Both search paths now require an effect connection to the actual mechanic. The score is the strongest qualified hook, not the number of loose hooks. Members and explicit archetype/card-name support score 300; specific mechanics score 110–140; the score floor is 100. Other query specificity can add at most 9. Popularity breaks ties. Every qualified single or shared list is capped at 40 before pagination. Explicit date/sort, format, kind, pool and omitted-chip constraints remain in force.

Type/Attribute/Level/Rank/Link-only and generic Type-support hooks are discarded. Merely being a Trap, an EARTH Fusion, a large Dragon, a generic GY trigger or a generic Fusion enabler cannot qualify. Trap partners must search/Set an available Trap or provide a positive Normal Trap activation payoff; opposing negation, negate-and-steal, unrelated named searches and generic backrow destruction do not qualify. Labrynth requires Normal-Trap-compatible setup. Blue-Eyes material setup requires sending from the Deck, rather than an arbitrary hand/field send cost. Discard-cost hooks reject Dark World triggers requiring a card effect. Monarch retains the owner-approved Kaiju class, while excluding removal that forbids the Normal Summon and Tokens that cannot be Tributed.

A multi-archetype result must independently qualify for every target; its weakest hook determines its score. If the shared list is empty, return separate labelled lists with the same filters. The deck Cards tab retains its See bridges button. Insights, resolve, format searches and Describe preserve the groups; a structured empty intersection never triggers AI reinterpretation.

## Read-only catalog results

Measured using `queryCards`, `emptyCardQuery()` defaults and the SQL `effectSearch` service. All five totals and top tens agree across both entry points. Database: `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`, opened with `{readonly:true,fileMustExist:true}`. Printed cards: the existing `data/duel-engine-next` bundle in that same worktree, through its read-only loader. No HTTP call to :3000 or deployment.

| Query | Rejected matcher | Corrected list |
| --- | ---: | ---: |
| Temple of the Kings synergy | 963 | 36 |
| Monarch synergy | 450 | 40 |
| synergy with Temple of the Kings and Blue-Eyes | 2,726 | 1 |
| Labrynth synergy | Not measured | 40 |
| Blue-Eyes synergy | Not measured | 40 |

40 means the retained recommendation list is capped; it is not an uncapped catalog hit count.


### Temple of the Kings synergy

| Rank | Card | Score | Why |
| --- | --- | ---: | --- |
| 1 | Temple of the Kings | 300 | Supports Temple of the Kings |
| 2 | The Man with the Mark | 300 | Supports Temple of the Kings |
| 3 | Treasures of the Kings | 300 | Supports Temple of the Kings |
| 4 | Anubis the Last Judge | 300 | Supports Temple of the Kings |
| 5 | Divine Serpent Apophis | 300 | Supports Temple of the Kings |
| 6 | Merciless Scorpion of Serket | 300 | Supports Temple of the Kings |
| 7 | Verdict of Anubis | 300 | Supports Temple of the Kings |
| 8 | Mystical Beast of Serket | 300 | Supports Temple of the Kings |
| 9 | Defense of the Temple | 300 | Supports Temple of the Kings |
| 10 | Trap Trick | 140 | Searches or Sets Traps for Temple of the Kings |

### Monarch synergy

| Rank | Card | Score | Why |
| --- | --- | ---: | --- |
| 1 | The Monarchs Stormforth | 300 | Supports Monarch |
| 2 | Mobius the Frost Monarch | 300 | Supports Monarch |
| 3 | Caius the Shadow Monarch | 300 | Supports Monarch |
| 4 | Eidos the Underworld Squire | 300 | Supports Monarch |
| 5 | Edea the Heavenly Squire | 300 | Supports Monarch |
| 6 | Erebus the Underworld Monarch | 300 | Supports Monarch |
| 7 | Domain of the True Monarchs | 300 | Supports Monarch |
| 8 | Zaborg the Thunder Monarch | 300 | Supports Monarch |
| 9 | Ehther the Heavenly Monarch | 300 | Supports Monarch |
| 10 | Pantheism of the Monarchs | 300 | Supports Monarch |

### synergy with Temple of the Kings and Blue-Eyes

| Rank | Card | Score | Why |
| --- | --- | ---: | --- |
| 1 | Blue-Eyes Tyrant Dragon | 140 | Works with Temple of the Kings + Blue-Eyes |

Only one shared card qualifies, so there are no filler ranks 2–10. Blue-Eyes Tyrant Dragon explicitly uses Blue-Eyes White Dragon and Sets a Trap from the GY after battling; Temple can activate that Set Trap immediately. This is a named Blue-Eyes connection plus a concrete Trap-reset effect, not a Dragon/LIGHT match.


### Labrynth synergy

| Rank | Card | Score | Why |
| --- | --- | ---: | --- |
| 1 | Lady Labrynth of the Silver Castle | 300 | Supports Labrynth |
| 2 | Arianna the Labrynth Servant | 300 | Supports Labrynth |
| 3 | Big Welcome Labrynth | 300 | Supports Labrynth |
| 4 | Welcome Labrynth | 300 | Supports Labrynth |
| 5 | Lovely Labrynth of the Silver Castle | 300 | Supports Labrynth |
| 6 | Arias the Labrynth Butler | 300 | Supports Labrynth |
| 7 | Labrynth Stovie Torbie | 300 | Supports Labrynth |
| 8 | Labrynth Chandraglier | 300 | Supports Labrynth |
| 9 | Labrynth Cooclock | 300 | Supports Labrynth |
| 10 | Labrynth Labyrinth | 300 | Supports Labrynth |

### Blue-Eyes synergy

| Rank | Card | Score | Why |
| --- | --- | ---: | --- |
| 1 | Sage with Eyes of Blue | 300 | Supports Blue-Eyes |
| 2 | Blue-Eyes Alternative White Dragon | 300 | Supports Blue-Eyes |
| 3 | Blue-Eyes Spirit Dragon | 300 | Supports Blue-Eyes |
| 4 | The White Stone of Ancients | 300 | Supports Blue-Eyes |
| 5 | Blue-Eyes Ultimate Dragon | 300 | Supports Blue-Eyes |
| 6 | Blue-Eyes Chaos MAX Dragon | 300 | Supports Blue-Eyes |
| 7 | The White Stone of Legend | 300 | Supports Blue-Eyes |
| 8 | Neo Blue-Eyes Ultimate Dragon | 300 | Supports Blue-Eyes |
| 9 | Dragon Spirit of White | 300 | Supports Blue-Eyes |
| 10 | Blue-Eyes Twin Burst Dragon | 300 | Supports Blue-Eyes |

## Additional quality and fallback checks

- Temple's list also retains Lord of the Heavenly Prison, Lady/Lovely Labrynth, Lilith, Trap Holic and Farewelcome Labrynth. The quoted Ryu Senshi, Lightstorm Dragon, Skull Wagon, Wild Wingman, Prismaura, Ananta and That's 10! false positives are absent, along with Magician's Rod, Toadally Awesome, F.A. Dawn Dragster and Numeron Dragon.
- In an explicit pool containing Trap Trick, Sage with Eyes of Blue and Lightstorm Dragon, the shared list is empty; the Temple group contains only Trap Trick, the Blue-Eyes group contains only Sage, and the UI still opens See bridges. The original chip remains a two-target query; separate suggestions never appear as shared matches.
- A Blue-Eyes pool containing Foolish Burial, Transmodify and Dark Factory of More Production returns only Foolish Burial. A Labrynth pool containing Trap Trick and Guiding Ariadne returns only Trap Trick. A discard pool returns Danger! Bigfoot! and excludes Broww/Snoww. A Monarch removal pool returns Gameciel and excludes Lava Golem.

## Validation

- Shared integration suites (`archetype-synergy-search`, `card-insights`, `effect-search`, `cube-effect-search`): **96 passed, 15 skipped**.
- Real-engine host suites: **170 passed, 2 skipped** on the final run. This includes 11 new synergy integration cases and 159 existing host cases. The earlier full run reproduced the same two failures already documented in the initial report: the engine bundle lacks Field Power Bonus, and a Genesys staple assertion expects Lava Golem while the artifact ranks Skull Meister first. Only those two named cases were excluded on the final run.
- Signed deck-search and card-insights route suites: **34 passed**. Includes a real resolver/browser round trip proving groups survive and do not invoke the mocked fallback.
- Real-engine Cards-tab UI and real-resolver Describe UI: **7 passed**, with 7 unrelated existing UI cases outside the focused run. Covers all five requested queries, an empty shared pool, See bridges, group headings and keyboard selection across groups.
- **307 relevant integration checks passed** across those final results.
- Shared build and shared/duel-server/web TypeScript checks pass. `git diff --check` passes.
- Independent focused review found no remaining blocker after the cost, resource-zone, Normal Trap and grouped-consumer corrections.

The matcher is intentionally conservative: unrecognized or broad stored hooks fail closed; profiles were neither regenerated nor rewritten.

All added tests are integration tests. No paid model calls, live database writes, server restarts, process kills, `.env` reads or changes to bridge implementation or `data/duel-engine`. Build output and temporary evaluation files are removed after verification.
