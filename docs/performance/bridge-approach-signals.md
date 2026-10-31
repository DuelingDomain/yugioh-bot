# Bridge discovery signals — 2026-10-31

The approved approach is implemented: larger tournament samples, a bounded co-play prior, effect-grounded mechanic synergy, and observed engine-core quantities. No type/attribute-only rule was added. New candidates still require both independent Haiku reviews; co-play alone cannot create a displayed pair.

Implementation commits: `303a89441` (sampling, artifacts and refresh pipeline) and `1983a93a8` (mechanic discovery, ranking, cores and integration coverage).

The [review follow-up](bridge-approach-review-2026-10-31.md) supersedes the original nomination and runtime-loading behavior below. It records the corrected all-pairs counts and ten GY samples.

## Data and provenance

| Sample | Bridge lists | Unrelated pairs | Pairs in ≥2 lists | Engines in ≥5 lists |
|---|---:|---:|---:|---:|
| TCG | 972 | 155 | 79 | 38 |
| Domain | 913 | 877 | 263 | 140 |
| Genesys | 964 | 546 | 147 | 111 |

The refresh now requests up to 1,000 lists per category, sequentially, with at least one second between requests and bounded curl retries. The original fixture contained 235 lists. Committed `usage.json` contains page URLs and SHA-256 provenance; `bridge-observations.json` contains joint counts, joint share, both conditional shares, lift, engine sample sizes, and member copy totals. It is approximately 692 KB. The larger raw lists are not committed.

The staples sample has 983/915/962 lists. Its existing de-duplication includes Side and ignores section boundaries; bridge statistics instead de-duplicate canonical Main/Extra sections and ignore Side. Each statistic uses its own recorded denominator. Engine detection uses the production weighting, hybrid folding and thresholds, with hand-trap/generic and related-family exclusions.

The refresh publisher commits usage and derived observations together. Failed format refreshes retain the corresponding prior derived sample. The job installs dependencies without native builds and has a 15-minute limit. The old small raw fixture remains available for offline comparisons.

Observation version: `9bc280803a04313135e640e503a07566495647e3b64063686ff4c49c4e08e35b`.

## Candidate and ranking behavior

Scans visit observed partners first, but still scan the whole graph. A pair needs at least two sampled lists to receive a ranking prior. The multiplicative boost is capped at 30%. There is one reserved observed-pair slot within the existing eight-engine shortlist, alongside at most two cached Niche slots and the existing synergy limits (one review candidate, two accepted display entries). Already accepted paths are isolated from pending companion evidence so co-play does not trigger redundant reviews.

The ranking prior only operates on supplied, checked bridge/mechanic rows. It cannot manufacture a row. Public projection still requires both current independent Haiku approvals. Discovery versioning expires old durable shortlists when the derived data changes, without invalidating valid card-evidence reviews.

## Mechanic evidence

Profiles aggregate legal member tags and printed effects for Trap/Set, Trap activation, GY, banish, face-down, discard, Fusion, Synchro, Xyz, Link and Ritual mechanics. Type and Attribute are absent from the feature vocabulary. Weighted shared mechanics rank complementary effects; broad similarity alone cannot nominate a pair. The review follow-up replaces runtime full-tag decompression with a lazily loaded 180,206-byte mechanic-facts artifact; profiles remain cached per engine/format.

**Temple of the Kings + Labrynth, Advanced:** complementarity 2.492. The legal member profiles have Trap/Set shares of 50% and 80%. The candidate names Temple of the Kings, Welcome Labrynth, and Lady Labrynth of the Silver Castle: Temple permits a Trap to activate the turn it was Set; Welcome is a Normal Trap; Lady responds to Normal Trap activation. Printed timing, activation conditions, once-per-turn limits and locks remain in the evidence. It is `kind: "synergy"`, Niche, score capped at 3, zero access coverage, and currently pending review.

**Fiendsmith + Labrynth, Advanced:** complementarity 0.833, with Fiendsmith's Trap/Set share below the 20% focus threshold. There is no new synergy candidate and no access candidate. Sharing a Type/Attribute or merely having GY effects supplies no reason.

**Fiendsmith + Labrynth, Genesys:** the owner rejects this pairing. The corrected generic Trap branch requires at least two Normal Traps and a 40% Normal Trap share among legal source members. Kyrie alone cannot nominate it; both synergy and access are null in Advanced and Genesys.

GY nominations now require a named/archetype filter on an exact printed Deck-to-GY clause, with the recipient's canonical/printed identity confirming that filter. Type, Attribute, Level, empty filters, and inferred unrelated labels cannot nominate a GY pair. GY/discard nominations still require a compatible Main Deck recipient, source targets/zones, and a useful GY activation/discard trigger. Excavation, random milling, and conditional GY presence alone are excluded. Integration regressions reject Pixiel → Beetrooper Armor Horn while preserving real discard-trigger candidates.

## Engine cores

At least five sampled engine lists and majority play rate are required. Unreviewed proposals use prevalent legal engine members, then run the existing grounded selector. Reviewed plans retain their checked dependencies. Quantities are rounded expected copies per sampled list, with required material multiplicity and format copy limits preserved. Absent or diffuse samples fall back to the grounded plan. Sample popularity never clears a dependency gap.

Real examples:

- Genesys Ashtra, 25 lists: 12 → 15 copies; Yoa 3 → 2. The package remains visible with an explicit 12-copy deck-space warning and is not ready.
- Genesys Labrynth, 25 lists: 6 → 5 copies; the full dependency procedure remains provisional.
- Domain Blue-Eyes, 30 lists: nine singleton identities; checked procedures remain ready in the empty-deck projection.

Main/Extra ownership, Side copy limits, TCG limits, Genesys points/remaining allowance, Domain singleton, Deck Master identity and available slots still pass through the existing subscriber projection.

## Four-deck before/after

Both runs used the same migrated scratch backup of the live database, opened read-only for projection. Format: Advanced. Baseline source: `c74103aa6`. Labrynth and Snake-Eye use the same committed historical list fixtures in both runs. No paid judge was invoked, so these comparisons isolate discovery/ranking changes from new approvals.

| Deck | Accepted Next engines before → after | Generated candidates before → after |
|---|---|---:|
| Temple deck 10 | Argostars, Altergeist, Blue-Eyes → same | 36 → 66 |
| Deck 9 | Azamina, Meklord, Regenesis → same | 30 → 143 |
| Labrynth list | Temple of the Kings → same | 28 → 71 |
| Snake-Eye list | Fire King, Azamina, Diabell, Dragon Ruler → same | 9 → 22 |

Deck 10's Blue-Eyes score increases from 0.148 to 0.168. Other accepted scores are unchanged. The four Advanced projections retain their grounded cores because their relevant engine samples are below the observed-core threshold. Larger raw candidate counts are not claims of accepted usefulness; the same bounded shortlist and both judges remain in place. Traptrix joins the review shortlist as a mechanic synergy for the first three examples, and Infernoid joins Snake-Eye's shortlist. Full results, card evidence, scores, profiles and core quantities are in [bridge-approach-signals.json](bridge-approach-signals.json).

## Validation

Integration verification: 173 passed, 14 existing skips across 12 files. Server suites: 49 targeted tests plus 20 multi-engine API tests. Shared catalog suites: 103 passed, 14 skipped. Publisher pipeline: one passed. The final six focused approach tests were rerun successfully after all fixes. Shared and duel-server TypeScript checks pass, as does `git diff --check`. Parallel catalog runs exceeded existing test timeouts; passing catalog reruns use one worker so the evidence is not affected by competing catalog loads.

Commands: `npx vitest run --maxWorkers=1` for the server approach/synergy/core/recall/jobs/multi-engine integration files and the shared archetype-bridges/bridge-engines/bridge-judge/bridge-set-access/effect-search integration files; `npx vitest run scripts/effects/tests/bridge-observations.integration.test.ts`; `npx tsc -p packages/shared/tsconfig.json --noEmit`; `npx tsc -p packages/duel-server/tsconfig.json --noEmit`.

Independent code review found two issues during development: impossible Main Deck → Extra Deck GY nominations, and co-play classification suppressing cached Niche capacity. Both were fixed; the reviewer reported no unresolved important findings.

No live database was written, no environment file was read, and `data/duel-engine` was untouched. Only scratch/in-memory databases were migrated or used for synthetic judge responses. The separate agent's naming, API removal, judging and UI changes are outside these commits.
