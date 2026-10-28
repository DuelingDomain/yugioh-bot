# Archetype bridge engine measurements

Measured locally on 2026-10-28 with Node 22.23.3 and algorithm `capability-bridges-v5`. Graph version: `9299b7b5b8421e95de1bf48beb247c09318413a0fbc1005f77c038c53bdb070b`. See [the API contract](../api/archetype-bridges.md) and [the judging runbook](../runbooks/bridge-judging.md).

## Round 4 verification

A substantive discard engine now requires at least three distinct legal discard-outlet cards in the source group, in addition to the existing source discard-rate and target discard-trigger-rate checks. Ancillary discard reasons contribute at most one point; merely marking Tract's six-point discard reason ancillary previously left Fiendsmith → Fabled at Good. That row retains its search entry and now scores 4.44 (Niche).

Change is excluded as an engine group. `/Assault Mode` is an explicit alias of Assault Mode, allowing its API source evidence to support Assault Mode → Junk and Assault Mode → Stardust in both formats.

Top-four deduplication also rejects the lower row when both primary reasons are mentions from the same source card and both target labels occur in the same sentence of its printed text. Blue-Eyes → Black Luster Soldier survives; Blue-Eyes → Chaos is omitted from the top four. Separate-sentence mentions remain distinct. Odion's Ashtra and Argostars rule-enabler rows and Zefra's Advanced reach rows survive. Broader candidate scans continue to retain direct lookup alternatives.

The rebuild read the same prepared engine database and cached API metadata without modification. It indexed 13,954 cards across 457 groups in 73,478 ms, with peak RSS 743,688 KiB. Tags, profiles, capability bytes, metadata, engine input hash, and golden labels are unchanged.

| Format | Rows before | Rows after | Top-four rows after | Golden precision@5 | Golden recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Advanced | 281 | 264 | 244 | 100% | 19/30 (63.33%) |
| Genesys | 254 | 235 | 217 | 100% | 18/28 (64.29%) |
| Total | 535 | 499 | 461 | | |

The evaluator passed `scripts/effects/evaluate-bridges.ts --check --strict-precision`, with 100% judgement coverage and no known false bridges in the golden set. Recall is unchanged, with no newly lost or restored positives. The golden evaluation covers the labelled core sources rather than independently judging all 499 candidate rows.

Existing golden positives outside the top ten in both formats remain Tenyi → Swordsoul, Sangen → Tenpai Dragon, Invoked → Shaddoll, Odion → Altergeist, Fiendsmith → Danger!/Dark World, and Branded → Dogmatika/Danger!/Fabled/Dark World. Advanced additionally misses Live☆Twin → Evil★Twin. Odion → Altergeist remains below the score threshold; Zefra's Pendulum entry cards remain barred in Genesys.

The removed rows are the nine Change-source rows and the five named small groups' Danger!/Dark World rows in each format. Genesys also loses Predap → Danger!/Dark World under the same general discard rule. Two Assault Mode rows are added per format. Both stored artifacts and direct explanations retain Danger! → Dark World and Dark World → Danger!. No Change-source or Change-target rows remain.

## Requested CLI top fours

Results use `bridgeCli` from `scripts/effects/bridges.ts` with `from SOURCE --format FORMAT --limit 4`, importing the rebuilt artifacts into disposable databases. Entries are ranked left to right; fewer than four means no further retained row qualifies. All listed rows are Good except Fiendsmith → Fabled, which is Niche.

| Source | Advanced | Genesys |
| --- | --- | --- |
| Odion | Ashtra (10.99); Argostars (8.99) | Ashtra (10.99); Argostars (8.99) |
| Blue-Eyes | Millennium (19.35); Black Luster Soldier (18.91) | Millennium (19.35); Black Luster Soldier (18.91) |
| Fiendsmith | Fabled (4.44, Niche) | Fabled (4.44, Niche) |
| Danger! | Dark World (8.99) | Dark World (8.99) |
| Dark World | Danger! (8.99) | Danger! (8.99) |
| Zefra | Yang Zing (16.28); Stellarknight (14.97); Shaddoll (13.56); Nekroz (13.28) | — |

## Hubs in top-four results

The top five targets and their sources are identical in Advanced and Genesys. The count is the number of source groups whose top four contain that target. Ties use target name.

| Target | Sources | Count in each format |
| --- | --- | ---: |
| Fur Hire | Destiny HERO, Elemental HERO, Evil HERO, GMX, Masked HERO, Vision HERO | 6 |
| Ashened | Destiny HERO, Elemental HERO, Evil HERO, Masked HERO, Vision HERO | 5 |
| Branded | Bystial, Despia, Dogmatika, Springans | 4 |
| Dogmatika | Bystial, Despia, Possessed, Springans | 4 |
| Nouvelles | Black Luster Soldier, Impcantation, Prediction Princess, Vendread | 4 |

## Tests and remaining limits

All 16 tests passed across the four targeted integration files: `packages/shared/tests/bridge-round3.integration.test.ts`, `packages/shared/tests/archetype-bridges.integration.test.ts`, `scripts/effects/tests/bridge-evaluation.integration.test.ts`, and `scripts/effects/tests/bridge-artifacts.integration.test.ts`. New assertions were exercised against the old behavior before their fixes. No unit tests were added and no full package suite ran.

The shared TypeScript build passed, followed by `npm run typecheck --workspace=@yugidraft/shared` and `tsc --noEmit -p scripts/effects/tsconfig.json`. The first combined integration run needed the shared build for package export resolution; the rebuilt rerun passed all four suites. Generated shared build output was removed after verification.

Stored rows remain deterministic candidates. Player-facing publication requires both independent judgements and feedback/format checks; no engine execution or external judging was performed for this round.
