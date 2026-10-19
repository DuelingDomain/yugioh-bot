# Deck suggestion quality evaluation

Verified on 2026-10-19 against the pinned effect artifact and the real read-only engine catalog. The four sourced-deck integration cases pass. This evaluates recommendation relevance separately from format admission and summon feasibility.

## Sources and fixtures

All deck pages and source-card API metadata were retrieved on 2026-10-19. Full Main, Extra and Side passcode arrays, card names, retrieval timestamps, HTML hashes, explicit trimming decisions and expected omitted cards are preserved in [the source fixture](../packages/shared/tests/fixtures/deck-suggestions-quality.json). The [metadata fixture](../packages/shared/tests/fixtures/deck-suggestions-card-metadata.json) preserves real YGOPRODeck cache fields for all 169 unique source cards (170 passcodes including artwork), so the evaluator does not substitute an arbitrary first engine setcode for their API archetype. Other candidates come from the full engine catalog; expected relevance never restricts the candidate universe.

| Scenario | Published source | Event / status |
| --- | --- | --- |
| Blue-Eyes | [Primite Blue-Eyes, Marco Tonto](https://ygoprodeck.com/deck/primite-blue-eyes-734333/) | Montevideo WCQ Regional, 2026-09-12, Top 8 |
| Branded | [Despia Branded, David Diniz](https://ygoprodeck.com/deck/despia-branded-737756) | Rio De Janeiro WCQ Regional, 2026-09-27, winner |
| Snake-Eye | [Dark Magician Azamina Snake-Eye, Julia G.](https://ygoprodeck.com/deck/dark-magician-azamina-snake-eye-734878/) | Poznań WCQ Regional, 2026-09-26, runner-up |
| Domain | [Branded Domain, PohatuEnjoyer](https://ygoprodeck.com/deck/branded-domain-671336) | Published community Domain-format deck; no tournament claim |

The three tournament pages are recent curated TCG tournament-meta lists found by search, rather than a claim that they are the newest lists on the site. Canonical HTML pages exposed the complete literal deck arrays; a bare numeric URL initially returned HTTP 403.

The Domain source does not explicitly label its Deck Master. The derived scenario selects its sole Side Deck card, Masquerade the Blazing Dragon, following the repository’s existing Domain import convention. The first scenario incorrectly placed Fallen of Albaz in the Deck Master Zone while several predeclared support rationales assumed he remained in Main. That input was corrected by restoring Albaz and omitting Bystial Saronir instead, keeping 32 Main cards. The fixture records this correction, preserves the raw source arrays and the generic expected IDs, and updates the omitted source cards to match the corrected input. The Deck Master is never counted as a Main Deck effect target or summon material.

## Expected relevance and interpretation

The expected set was declared before ranking: omitted published-list cards plus a finite list of generic support cards, each with an independent printed-text rationale. Expected generic IDs were not expanded after examining recommendations. Source legality is not inferred from tournament participation: the live application host’s pinned admission policy supplies the legal universe and copy groups.

Precision is the number of returned canonical passcodes in that closed expected set divided by the row’s returned count. Potentially useful alternatives absent from the expected set count as misses. These are source-backed precision measurements against a finite reference set, not an assertion that every unlisted recommendation is bad. Empty rows have no precision denominator. In particular, low Archetype and Extra precision remains visible even when the required Outside gate passes.

Each trimmed scenario has 32 Main cards and retains a few Extra anchors. The mature variant restores the published Main cards while retaining the trimmed Extra section, allowing the Extra row to be evaluated.

## Results

The required gate is at least five expected cards in the first eight Outside recommendations for every trimmed scenario.

| Deck | Expected in first 8 Outside | Precision@8 | Gate |
| --- | ---: | ---: | --- |
| blue-eyes | 6/8 | 75.0% | Pass |
| branded | 5/8 | 62.5% | Pass |
| snake-eye | 6/8 | 75.0% | Pass |
| domain | 5/8 | 62.5% | Pass |

Per-row precision includes every returned card, up to 12 per synergy row and six Staples. The mature scenarios also returned the same first-eight hit counts shown above.

| Deck / scenario | Archetype | Outside | Extra | Staples |
| --- | ---: | ---: | ---: | ---: |
| blue-eyes / trimmed | 0/12 (0.0%) | 6/12 (50.0%) | n/a (0 cards) | 3/6 (50.0%) |
| blue-eyes / mature | 0/12 (0.0%) | 7/12 (58.3%) | 0/12 (0.0%) | 2/6 (33.3%) |
| branded / trimmed | 1/12 (8.3%) | 6/12 (50.0%) | n/a (0 cards) | 3/6 (50.0%) |
| branded / mature | 0/12 (0.0%) | 6/12 (50.0%) | 0/12 (0.0%) | 2/6 (33.3%) |
| snake-eye / trimmed | 1/12 (8.3%) | 7/12 (58.3%) | n/a (0 cards) | 3/6 (50.0%) |
| snake-eye / mature | 1/12 (8.3%) | 6/12 (50.0%) | 1/12 (8.3%) | 0/6 (0.0%) |
| domain / trimmed | 2/12 (16.7%) | 5/12 (41.7%) | n/a (0 cards) | 0/6 (0.0%) |
| domain / mature | 1/12 (8.3%) | 5/12 (41.7%) | 1/12 (8.3%) | 0/6 (0.0%) |

All eight scenarios returned zero illegal cards and no duplicate or already-owned recommendations. Staples occupied 20% of the trimmed results and 14.3% of the mature results, below the 25% limit. Every under-40 Extra row was empty with `state: "hint"` and `hint: "Add 40 Main Deck cards."`; mature Extra rows were ready. All returned cards satisfy the `RankedInsightCard` contract and have a single-line reason.

The [full results](./deck-suggestions-quality-results.json) preserve all shown cards, reasons, relevance flags, source URLs, per-row denominators, expected canonical sets and gate outcomes.

## Reproduction

The real-catalog evaluation is opt-in because it requires an installed engine resource bundle. The loader opens `cards.cdb` read-only, builds a disposable SQLite catalog, applies the source-card metadata snapshot, imports the real pinned artifact, and uses `deckSuggestionScope` from the duel host. It reads no environment secrets and writes no engine data.

From the repository root, with Node 22 available:

```bash
PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH \
DECK_SUGGESTIONS_ENGINE_DIRECTORY=/home/sulman633/repos/yugioh-bot/data/duel-engine \
DECK_SUGGESTIONS_EVAL_OUTPUT=/tmp/deck-suggestions-quality-report.json \
prlimit --core=0 npm exec --workspace @yugidraft/shared -- vitest run tests/effect-search.integration.test.ts -t 'sourced deck suggestion'
```

The recorded dedicated run passed all four sourced-deck cases (29 unrelated cases skipped) in 5.58 seconds. The catalog contained 14,845 raw engine records and 13,694 imported effect tags. The artifact version was `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`. See [the integration evaluator](../packages/shared/tests/effect-search.integration.test.ts) and [the reusable catalog loader](../packages/shared/tests/fixtures/deck-suggestions-quality.ts).
