# Archetype bridge engine measurements

Measured on 2026-10-28 with Node 22.23.3 and capability-bridges-v5. Graph version: `9f46b09a3f4f2bc2ace78ca248a4b5c32b3c9045d1b41fd9a54729d4ad9c686a`.

## Round 5 verification

Archetype name filters containing no lowercase letters now match printed names case-sensitively. HERO no longer reaches Hero Fur Hire, Hero of the Ashened City, Hero Kid, Oscillo Hero or Hero of the East. Both cases of alphabetic characters remain word boundaries.

Target membership rejects source API family cards before accepting printed member connections. Shared named parents join sibling groups, so Destiny HERO and Elemental HERO share HERO identity. Poison Rose and Winged Kuriboh LV6 no longer establish external Rose/Kuriboh entries from HERO sources. Distinct Diabell, Snake-Eye and Azamina landings survive.

Explicit aliases are consumed after merging their cards into canonical groups. /Assault Mode, Magnet Warrior, Tellarknight and Predap no longer appear separately. Assault Mode retains its merged API members and Junk/Stardust bridges in both formats.

Toon monster entries require evidence supplying their printed named field setup: the setup card itself, a card that takes its name, or a printed Deck-access effect reaching that card. This removes Gaia The Fierce Knight and Destruction Sword label rows, analogous Archfiend rows and the Genesys Performapal row.

All manifest input hashes and golden labels are unchanged. The rebuild read the same prepared engine database and cached API metadata without modification. Capability target indexes changed to reflect case-sensitive matching.

The rebuild indexed 13,954 cards across 453 groups in 75,083 ms, with peak RSS 750,696 KiB.

| Format | Rows before | Rows after | Top-four before | Top-four after | Precision@5 | Recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Advanced | 264 | 244 | 244 | 225 | 100% | 19/30 (63.33%) |
| Genesys | 235 | 216 | 217 | 200 | 100% | 18/28 (64.29%) |
| Total | 499 | 460 | 461 | 425 | | |

The evaluator passed scripts/effects/evaluate-bridges.ts --check --strict-precision. Both formats retain 100% precision and judgement coverage, with zero known false bridges in the golden set. Recall is unchanged: no newly lost or restored positives. This evaluation covers labelled core sources rather than independently judging every candidate row.

Existing golden positives outside the top ten in both formats remain Tenyi → Swordsoul, Sangen → Tenpai Dragon, Invoked → Shaddoll, Odion → Altergeist, Fiendsmith → Danger!/Dark World, and Branded → Dogmatika/Danger!/Fabled/Dark World. Advanced additionally misses Live☆Twin → Evil★Twin.

## Requested CLI top fours

Results use bridgeCli from scripts/effects/bridges.ts with from SOURCE --format FORMAT --limit 4, importing rebuilt artifacts into a disposable database. Entries are ranked left to right. All listed rows are Good; a dash means no retained result.

| Source | Advanced | Genesys |
| --- | --- | --- |
| Elemental HERO | — | — |
| Vision HERO | — | — |
| Destiny HERO | — | — |
| GMX | Fur Hire (10.90) | Fur Hire (10.90) |
| Odion | Ashtra (10.99); Argostars (8.99) | Ashtra (10.99); Argostars (8.99) |
| Blue-Eyes | Millennium (19.35); Black Luster Soldier (18.91) | Millennium (19.35); Black Luster Soldier (18.91) |

Fur Hire, Ashened, Rose and Kuriboh are absent from stored rows and full live candidate scans for all six HERO sources in both formats: HERO, Elemental HERO, Destiny HERO, Evil HERO, Masked HERO and Vision HERO. GMX retains its separate Fur Hire entry. No Toon-target rows or /Assault Mode group remain.

## Hubs in top-four results

Counts are source groups whose top four contain the target; ties use target name. The first four targets are shared. A dash means outside that format’s top five.

| Target | Advanced count | Genesys count | Sources |
| --- | ---: | ---: | --- |
| Branded | 4 | 4 | Bystial, Despia, Dogmatika, Springans |
| Dogmatika | 4 | 4 | Bystial, Despia, Possessed, Springans |
| Nouvelles | 4 | 4 | Black Luster Soldier, Impcantation, Prediction Princess, Vendread |
| World Chalice | 4 | 4 | Herald, Mekk-Knight, Parshath, World Legacy |
| Chronomaly | 3 | — | Adamancipator, Chaos, Crystal Beast |
| World Legacy | — | 4 | Crusadia, Krawler, Mekk-Knight, World Chalice |

The previous Fur Hire hub (six sources) and Ashened hub (five sources) are no longer in the top five.

## Verification

All 18 tests passed across the four targeted integration files:

- packages/shared/tests/bridge-round3.integration.test.ts
- packages/shared/tests/archetype-bridges.integration.test.ts
- scripts/effects/tests/bridge-evaluation.integration.test.ts
- scripts/effects/tests/bridge-artifacts.integration.test.ts

New regression assertions reproduced failing behavior before the fixes. No unit tests were added and no full package suite ran.

The shared TypeScript build, npm run typecheck --workspace=@yugidraft/shared, and tsc --noEmit -p scripts/effects/tsconfig.json passed. Generated shared build output was removed after verification.

See [the API contract](../api/archetype-bridges.md) and [the judging runbook](../runbooks/bridge-judging.md). Stored rows remain deterministic candidates. No engine execution or external judging was performed for this round.
