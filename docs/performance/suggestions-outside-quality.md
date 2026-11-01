# Outside Suggestions utility policy

The 2026-10-31 review follow-up to `d4a4ec673` / `75882d6a3` is implemented. Shared policy is `suggestions-5`; host context is `deck-suggestions-host-v6`.

Outside discovery, admission, ordering and explanation share one effect/action/target/payoff witness. Unnamed narrow filters require two evaluated restrictions and target at most 6% of legal cards of the same kind. Monster filters use legal monsters; Spell/Trap and multi-kind filters use their eligible kinds. The existing floor of three targets is retained for small integration catalogs. `effect`, Normal-or-Effect alternatives and positional prose do not supply a selective dimension.

In the authoritative Normal catalog, Reinforcement of the Army reaches 609 of 8,878 legal monsters (6.86%). Its former all-card denominator was 13,707 cards (4.44%). It now fails breadth admission. This is a conservative launch heuristic, not a competitive quality measurement.

GY-only narrow recovery/revival requires a named card or archetype. Generic GY recovery needs a complete supported composition; merely owning a target does not establish GY setup. Hand-only summons require at least four matching useful strategy-core Main Deck copies and 10% density, and their reasons put `from hand` before the payoff. Thus singleton Ancient Rules is omitted, while a density-backed hand-summon witness exposes its source zone. Mixed hand/GY actions continue to expose both zones and any LP cost.

Actual engine archetype membership is used for action targets; API support categories cannot turn White Stone into a Blue-Eyes monster. Archetype admission now precedes measured Staples ownership. Known restriction shapes remain eligible after the 256-shape cap; only new shapes are skipped. Queues retain at most twelve entries per shape, with one compact frequency table of legal stat shapes. Suggestions do not initialize a bridge graph or call a model.

## Supported compositions and remaining specific recipes

Small World access now recognizes its reveal/banish/search capabilities and complete printed one-shared-property relation, rather than its passcode. Both exact-one-stat edges and the three physical copies are checked within the submitted deck.

Field search/Set access now recognizes matching action filters from supported Spell/Trap providers, including equivalents of Terraforming, Metaverse and Set Rotation. The deck must already contain the Field Spell and an evaluated useful payoff. Paired opposing Sets require two different Field names and expose the lock; ordinary access promises later normal activation. Mandatory sibling actions, including annotated actions in the same option, must be proved. Galloping Gaia without its Level 5 Dragon reveal, destroy-then-search and other unsupported action groups cannot supply that payoff.

Sent-to-GY trigger chains now follow a supported Deck search/summon to an evaluated terminal use: an ordinary low-Level monster, owned Ritual pair/materials, useful Field effect, or an owned hand-summon enabler for a high-Level monster. The sent copy is removed from the remaining witness. Required hand enablers appear first in the reason. Named Ritual send/search, End Phase summons, conditional related-card recovery, discard/draw density and complete two-material banishing Fusion proofs remain supported. Dead Ghost Fusion packages stay out. Arbitrary recursive chains and unknown requirements remain unsupported.

Two recipes still use specific identities, as permitted by the review's reduced generalisation scope: Pre-Preparation of Rites' paired named Ritual access, and Unexpected Dai with Yoa/Set-card Synchro math plus Primite Lordly Lode sequencing. The latter still identifies Dai, Yoa and Lordly Lode explicitly. Monster providers still need a proved own summon/access route and remain outside this launch's supported provider set.

Ordering uses utility and friction, distinct useful targets/importance, role tags, same-format/cohort usage, then popularity and passcode. Measured generic staples retain honest role/sample reasons; Super Polymerization requires an evaluated flexible Fusion outlet. Common admission/copy/pool/release/Genesys rules, the under-40 Extra hint and the quarter-row Staples cap remain in force. Underfilled Outside rows can therefore also reduce visible Staples slots.

## Verification

All writes and engine fixture mutations used disposable inputs under `/tmp/suggestions-review-48njzw` or test-created temporary directories. The previous application backup was opened read-only for a new SQLite backup. No running `:3000` database writes, `.env` reads or protected `data/duel-engine` access were performed.

Integration tests passed: 85 shared cases across the Outside, catalog/service and effect-search suites; 21 signed host/worker cases; 27 web cases. Shared and duel-server TypeScript checks and the production Next build passed. No unit tests were added. The sourced quality fixture retains its expected IDs and precision calculations; its Branded assertion now allows the unchanged quarter-row Staples cap to reduce the visible sample from six to five cards.

Regression coverage includes GY false positives, hand-summon density/zone reasons, the measured monster-only breadth boundary, sent-trigger enabler removal, independent provider identities for Small World/Field search/paired Set, known shapes after 256 entries, and Archetype ownership over sampled Staples. The clone-capability check uses disposable catalog and engine fixtures through the authoritative admission/service path. Independent review reproduced Galloping Gaia's missing reveal witness; the corrected implementation and negative integration case now exclude Terraforming and Metaverse for that deck. The reviewer found no remaining actionable regression.

Logs: `/tmp/suggestions-review-48njzw/shared-tests-final.log`, `host-tests.log`, `web-tests.log`, `shared-typecheck.log`, `host-typecheck.log`, `next-build.log`; sourced precision: `/tmp/suggestions-review-48njzw/quality-report.json`.

## Saved-deck output

Actual signed-host results using the saved Main/Extra/Side sections without padding, captured 2026-10-31. Normal uses the pinned TCG default; deck 3 uses Sage with Eyes of Blue and Domain/no-banlist. A synthetic authenticated actor exercises the host. Full responses and reasons: `/tmp/suggestions-review-48njzw/host-capture-final.json`.

| Rank | Deck 10 — Odion | Deck 9 — Light and darkness azamina | Deck 3 — Blue-Eyes DOMAIN |
| --- | --- | --- | --- |
| 1 | Small World | Pre-Preparation of Rites | Summoner's Art |
| 2 | Metaverse | Small World | Small World |
| 3 | Set Rotation | Trade-In | Trade-In |
| 4 | Unexpected Dai | Foolish Burial | One-Way Synchro |
| 5 | — | Void Apocalypse | Dragon's Mirror |
| 6 | — | Dark Magic Veil | Dragon Ravine |
| 7 | — | Foolish Burial Goods | — |

Dwimmered Path, Silver's Cry and Ancient Rules are absent from all three Outside lists. Return of the Dragon Lords also fails unnamed GY-only admission. Reinforcement of the Army drops under the corrected same-kind breadth ceiling. All requested positive routes remain: Small World, paired Ritual access, deck 9's Foolish Burial naming Skull Archfiend's Ritual line, Trade-In and One-Way Synchro. Odion keeps the four specific access/sequence witnesses; deck 9 retains its 38-card Extra hint.

## Production benchmark

Node v22.23.3, production Next, synthetic E2E authentication, signed host with authoritative admission, six warmups and 60 uncached samples per scenario. The unchanged benchmark ran in the foreground after the test/build jobs finished:

```sh
node --import tsx scripts/deck-suggestions-benchmark.ts \
  --catalog /tmp/suggestions-review-48njzw/catalog.sqlite \
  --engine /tmp/suggestions-review-48njzw/engine \
  --output /tmp/suggestions-review-48njzw/benchmark \
  --next --next-dist .next-suggestions-review \
  --samples 60 --warmup 6 --baseline 12 --check
```

| Measurement | Normal Blue-Eyes | Domain |
| --- | ---: | ---: |
| Full HTTP p95 | 294.47 ms | 306.59 ms |
| Cold first request (excluded from p95) | 747.49 ms | 284.07 ms |
| Genuine host computations | 67 | 67 |

All three benchmark gates passed. The 64 cached replays produced 64 `notModified`, zero recomputations and zero failures; cached HTTP p95 was 6.28 ms. The clamped additional retained web RSS metric was 0.00 MiB; host RSS rose 28.34 MiB. No allocator override was used. Source hashes did not change during the run; the fixed fixture SHA-256 remains `365283b9a6fed3c5f2f3c8655e85777f69d1c4262dba281bc07843c06728cbc1`. Timing and allocator retention vary with machine load.

Raw report: `/tmp/suggestions-review-48njzw/benchmark/report.json`; lifecycle and benchmark logs are beside it. The previous policy's confirmation report remains at `/tmp/suggestions-quality-RJwrOK/benchmark-confirmation/report.json` (322.56/314.32 ms Normal/Domain p95); these separate runs are not a controlled speed comparison. Generated repository build output was removed after verification.
