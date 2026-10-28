# Archetype bridge engine measurements

Measured locally on 2026-10-28 with Node 22.23.3 and algorithm `capability-bridges-v5`. Graph version: `a2e185961f0e1352192a5f29fb173e7ad8c7c5b79384af3f01026c2faca88ca0`. See [the API contract](../api/archetype-bridges.md) and [the judging runbook](../runbooks/bridge-judging.md).

## Round 3b verification

Top-four deduplication now requires both the same primary source Main Deck card and a shared target-engine card in the primary evidence line. Temple of the Kings therefore retains separate Ashtra and Argostars bridges. Chaos Form reaches different Ritual Monsters in the Blue-Eyes → Chaos and Blue-Eyes → Black Luster Soldier rows, so both survive. Black Luster Soldier → Blue-Eyes/Chaos still deduplicates the shared Gateway to Chaos → Chaos Form line. Broader candidate scans retain alternatives for direct pair lookups and judging.

The hybrid membership fallback requires the landing's name to contain the target label and its API archetype to match the non-excluded archetype named by the outlet. It now also requires either that API archetype to match the target itself or that the source lie outside its parent/alias family. Cards with printed engine support or named by another target card retain their existing membership. Parent/alias identity uses names, explicit aliases, or at least 50% shared membership relative to the smaller group; it excludes the naming-rate merges used for complete deck families. This rejects Dark Contract → Supreme King through D/D/D Supreme King Kaiser while retaining Subversion through Sinful Spoils.

Mention outlets additionally need a printed membership connection to at least one of the two engines, with the existing curated-source exemption. Tachyon Chaos Hole has no such connection as an outlet between Chaos and Galaxy, so its mention no longer establishes that bridge. API source evidence remains required.

The five requested landing cards remain substantive evidence: Zefraxi, Zefraxa, Diabellstar Vengeance, Queen Azamina, and Sinful Spoils of Subversion - Snake-Eye. Genesys continues to bar Zefra's Pendulum entry cards.

Rebuild inputs match round 3: the prepared engine database and cached API metadata were read without modification. The rebuild indexed 13,954 cards across 458 groups in 74,104 ms, with peak RSS 744,544 KiB. Capability bytes and golden labels are unchanged.

| Format | Rows before | Rows after | Top-four rows after | Golden precision@5 | Golden recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Advanced | 303 | 281 | 259 | 100% | 19/30 (63.33%) |
| Genesys | 273 | 254 | 235 | 100% | 18/28 (64.29%) |
| Total | 576 | 535 | 494 | | |

The evaluator passed `scripts/effects/evaluate-bridges.ts --check --strict-precision`, with 100% judgement coverage and no known false bridges in the golden set. There are no new lost positives or restored positives relative to round 3. The golden evaluation covers the labelled core sources rather than independently judging all 535 candidate rows.

Existing golden positives outside the top ten in both formats remain Tenyi → Swordsoul, Sangen → Tenpai Dragon, Invoked → Shaddoll, Odion → Altergeist, Fiendsmith → Danger!/Dark World, and Branded → Dogmatika/Danger!/Fabled/Dark World. Advanced additionally misses Live☆Twin → Evil★Twin.

## Requested CLI top fours

Results come from `scripts/effects/bridges.ts` with `--limit 4`, using a disposable database imported from the rebuilt artifacts. Entries are ranked left to right; fewer than four means no further retained row qualifies.

| Source | Advanced | Genesys |
| --- | --- | --- |
| Odion | Ashtra (10.99); Argostars (8.99) | Ashtra (10.99); Argostars (8.99) |
| Blue-Eyes | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.89) | Millennium (19.35); Black Luster Soldier (18.91); Chaos (16.90) |
| Snake-Eye | Fire King (9.16); Diabell (8.95) | Fire King (15.94); Diabell (8.95) |
| Diabell | White Forest (27.72); Snake-Eye (11.76); Azamina (9.33) | White Forest (27.72); Snake-Eye (14.92); Azamina (9.33) |
| Azamina | White Forest (33.22); Sinful Spoils (25.94); Diabell (16.95); Snake-Eye (12.96) | White Forest (33.22); Sinful Spoils (25.94); Diabell (16.95); Snake-Eye (12.92) |
| Zefra | Yang Zing (16.28); Stellarknight (14.97); Shaddoll (13.56); Nekroz (13.28) | — |
| Chaos | Meklord (19.57); Chronomaly (7.83) | Meklord (19.27); Chronomaly (8.14) |

Rule 5 previously hid Azamina → Diabell and Azamina → Snake-Eye behind Azamina → Sinful Spoils, all through Azamina Debtors. They now rank third and fourth. It also hid Diabell → Azamina behind Diabell → White Forest, both through Diabellze the White Witch; Azamina now ranks third. Diabell → Snake-Eye uses Diabellstar the Black Witch and remains second in both formats.

Odion → Altergeist has a substantive Temple line, but its final score is 3.99 in both formats (aggregate raw score 4 before the target-mean penalty). It remains below the admission threshold of 4, independently of deduplication. No score or label was changed to admit it.

Both stored artifacts and direct CLI explanations omit Chaos → Galaxy and Dark Contract → Supreme King in both formats.

## Hubs in top-four results

The count is the number of source groups whose top four contain that target. Ties use target name.

| Format | Target | Sources | Count |
| --- | --- | --- | ---: |
| Advanced | Fur Hire | Change, Destiny HERO, Elemental HERO, Evil HERO, GMX, Masked HERO, Vision HERO | 7 |
| Advanced | Danger! | Clown Crew, Dark World, Firewall, Purrely, Sangen, WAKE CUP! | 6 |
| Advanced | Dark World | Clown Crew, Danger!, Firewall, Purrely, Sangen, WAKE CUP! | 6 |
| Advanced | Ashened | Destiny HERO, Elemental HERO, Evil HERO, Masked HERO, Vision HERO | 5 |
| Advanced | Branded | Bystial, Despia, Dogmatika, Springans | 4 |
| Genesys | Danger! | Clown Crew, Dark World, Firewall, Predap, Purrely, Sangen, WAKE CUP! | 7 |
| Genesys | Dark World | Clown Crew, Danger!, Firewall, Predap, Purrely, Sangen, WAKE CUP! | 7 |
| Genesys | Fur Hire | Change, Destiny HERO, Elemental HERO, Evil HERO, GMX, Masked HERO, Vision HERO | 7 |
| Genesys | Ashened | Destiny HERO, Elemental HERO, Evil HERO, Masked HERO, Vision HERO | 5 |
| Genesys | Branded | Bystial, Despia, Dogmatika, Springans | 4 |

## Tests and remaining limits

All 16 tests passed across the four targeted integration files: `packages/shared/tests/bridge-round3.integration.test.ts`, `packages/shared/tests/archetype-bridges.integration.test.ts`, `scripts/effects/tests/bridge-evaluation.integration.test.ts`, and `scripts/effects/tests/bridge-artifacts.integration.test.ts`. The shared TypeScript build passed. No unit tests were added and no full package suite ran.

Stored rows remain deterministic candidates. Player-facing publication requires both independent judgements and feedback/format checks; no engine execution or external judging was performed for this round.
