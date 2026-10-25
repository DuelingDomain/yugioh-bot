# Deck suggestion quality evaluation

Verified on 2026-10-19 against the pinned effect artifact and the real read-only engine catalog. The four sourced-deck integration cases pass. This evaluates recommendation relevance separately from format admission and summon feasibility.

## Sources and fixtures

All deck pages and source-card API metadata were retrieved on 2026-10-19. Full Main, Extra and Side passcode arrays, card names, retrieval timestamps, HTML hashes, explicit trimming decisions and expected omitted cards are preserved in [the source fixture](../../packages/shared/tests/fixtures/deck-suggestions-quality.json). The [metadata fixture](../../packages/shared/tests/fixtures/deck-suggestions-card-metadata.json) preserves real YGOPRODeck cache fields for all 169 unique source cards (170 passcodes including artwork), so the evaluator does not substitute an arbitrary first engine setcode for their API archetype. Other candidates come from the full engine catalog; expected relevance never restricts the candidate universe.

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

The fixed expected-card set is unchanged. Cards outside that set still count as misses. The low Archetype precision remains visible.

The required gate is at least five expected cards in the first eight Outside recommendations for each trimmed deck.

| Deck | Expected in first 8 Outside | Precision@8 | Gate |
| --- | ---: | ---: | --- |
| Blue-Eyes | 6/8 | 75.0% | Pass |
| Branded | 5/8 | 62.5% | Pass |
| Snake-Eye | 7/8 | 87.5% | Pass |
| Domain | 5/8 | 62.5% | Pass |

The full-Main variants return first-eight Outside hits of 7, 5, 6 and 5, in the same deck order.

| Deck / scenario | Archetype | Outside | Extra | Staples |
| --- | ---: | ---: | ---: | ---: |
| Blue-Eyes / trimmed | 0/12 (0.0%) | 6/12 (50.0%) | n/a (0 cards) | 3/6 (50.0%) |
| Blue-Eyes / full-main | 0/12 (0.0%) | 7/12 (58.3%) | 2/12 (16.7%) | 2/6 (33.3%) |
| Branded / trimmed | 0/12 (0.0%) | 6/12 (50.0%) | n/a (0 cards) | 3/6 (50.0%) |
| Branded / full-main | 0/12 (0.0%) | 6/12 (50.0%) | 4/9 (44.4%) | 2/6 (33.3%) |
| Snake-Eye / trimmed | 1/12 (8.3%) | 8/12 (66.7%) | n/a (0 cards) | 3/6 (50.0%) |
| Snake-Eye / full-main | 1/12 (8.3%) | 7/12 (58.3%) | 4/12 (33.3%) | 0/6 (0.0%) |
| Domain / trimmed | 1/12 (8.3%) | 5/12 (41.7%) | n/a (0 cards) | 0/6 (0.0%) |
| Domain / full-main | 0/12 (0.0%) | 5/12 (41.7%) | 6/12 (50.0%) | 0/6 (0.0%) |

All eight scenarios return zero illegal cards, no duplicate or already-owned cards, and no repeated recommendation families. The TCG scenarios return only TCG cards; Normal mode follows the selected banlist region. All four trimmed Extra rows are empty and show `Add 40 Main Deck cards.` The full-Main Extra rows are ready. Staples stay below 25% of visible cards.

Extra puts native monsters and named core materials first, then proven profile matches. A Fusion-only Extra Deck with a printed Fusion lock puts ordinary Links and Ranks in the generic tier. That tier is last and has at most three cards. Unknown summon procedures and self-material prohibitions fail closed. Physical proofs can use hand traps; hand traps do not define the profile or justify generic Extra options.

Archetype uses exact engine memberships, core-card connections, release era and popularity. Branded no longer returns Black Chaos, Griffoh, Mind Shuffle or The Golden Swordsoul in that row. Springans Kitt remains because it directly searches Branded cards; Springans Merrymaker does not qualify.

Outside scoring is unchanged. The TCG filter and recommendation-family filter remove unavailable variants and the Monster Reborn wrapper card. The existing queues fill those places. The wrapper is a distinct TCG card, so this recommendation filter does not change its copy-limit identity.

The [ordered card lists](./deck-suggestions-quality-lists.md) include every row for all four decks and both scenarios. Generate the full JSON report with the evaluator when detailed passcodes, scores, reasons and precision denominators are needed.

Validation: shared build; 59 shared integration checks in the effect-search, card-insights and deck-summon files; 16 host integration checks in the suggestion-scope and deck-suggestions files. The four sourced-deck eval cases also pass. No new unit tests were added.

## Reproduction

The real-catalog evaluation is opt-in because it requires an installed engine resource bundle. The loader opens `cards.cdb` read-only, builds a disposable file-backed SQLite catalog, applies the source-card metadata snapshot, imports the real pinned artifact, and uses `deckSuggestionScope` from the duel host. All eight scenarios exercise the production joined-cursor catalog path. The catalog connections close and its temporary directory is removed after the suite. It reads no environment secrets and writes no engine data.

From the repository root, build shared first with Node 22. Remove its build output after the check.

```bash
# Set ENGINE_DIRECTORY to an installed engine bundle.
mkdir -p .status
prlimit --core=0 npm run build --workspace=packages/shared

DECK_SUGGESTIONS_ENGINE_DIRECTORY="$ENGINE_DIRECTORY" \
DECK_SUGGESTIONS_EVAL_OUTPUT=.status/deck-suggestions-quality-report.json \
prlimit --core=0 npm exec --workspace @yugidraft/shared -- vitest run tests/effect-search.integration.test.ts -t 'sourced deck suggestion'
```

The catalog snapshot contains 14,845 raw engine records and 13,694 imported effect tags. The artifact version is `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`. See [the integration evaluator](../../packages/shared/tests/effect-search.integration.test.ts) and [the reusable catalog loader](../../packages/shared/tests/fixtures/deck-suggestions-quality.ts).
