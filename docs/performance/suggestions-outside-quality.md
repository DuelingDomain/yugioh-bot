# Outside Suggestions utility policy

Implemented from the approved 2026-10-30 `suggestions-outside-quality.md` brief, sections 2A–2D. Shared policy is `suggestions-4`; host context is `deck-suggestions-host-v5`.

Outside discovery, scoring and explanation now use one effect/action/target/payoff witness. Unnamed filters need at least two evaluated restrictions and at most 6% of the authoritative format catalog. The 6% ceiling is a conservative launch heuristic, not a competitive quality measurement. Actual engine archetype membership is used for action targets; API support categories cannot turn White Stone into a Blue-Eyes monster.

Supported compositions are bounded to existing Main/Extra Deck copies: exact-one-stat Small World edges, paired named Ritual access, a sent-to-GY Ritual access route, evaluated End Phase summons, conditional Ritual recovery, Field access with an existing payoff, density-backed discard/draw, a complete two-material banishing Fusion recipe, and the Dai/Angel/Yoa Synchro route. Unknown conditions, relational history, proper-summon restrictions, missing materials and inaccessible packages fail closed. Monster providers lack a proved summon/access route in this launch, so Summoner Monk and Manju are omitted.

Ordering uses utility and friction, distinct useful targets/importance, role tags, same-format/cohort usage, then popularity and passcode. Draw/cost density counts physical copies separately. Measured generic staples own Staples and use an honest role/sample reason; Super Polymerization requires a supported flexible Fusion outlet. The existing row capacities, admission/copy/pool/release/Genesys rules and under-40 Extra hint remain in place. An underfilled Outside row is valid.

One catalog stream builds a compact frequency table of legal stat shapes. This table counts target breadth without retaining catalog text/tags or decoding the catalog twice. Proof queues retain at most twelve entries per shape and at most 256 restriction shapes. Suggestions do not initialize a bridge graph or make model calls.

The production benchmark also exposed an existing API mismatch: legitimate `prerelease`/`upcomingDate` release facts were rejected by the web result validator. These fields now receive strict boolean/month validation. The shared release semantics and authoritative admission are unchanged.

## Verification

All database writes and engine fixture mutations used disposable inputs. The application database was opened read-only for backup, and the engine came from a disposable copy of `data/engine-main-prerelease`. No `.env` files or protected `data/duel-engine` files were opened.

Targeted integration checks passed: 30 shared cases (Outside regressions, catalog/service integration and the four existing sourced quality cases), 21 host/worker cases and 27 web cases. Shared and duel-server TypeScript checks and the production Next build passed. No unit tests were added. The sourced fixture keeps its expected IDs and precision measurements; the obsolete five-hit minimum was removed to honor strict admission and underfilled rows.

Independent review exercised histogram counts against direct per-card checks in all three authoritative scopes, verified Small World copy accounting, and found regressions that were reproduced before fixes: an impossible N'tss Fusion outlet, White Stone selecting itself as a Blue-Eyes payoff, a dead Ghost Fusion package, and an ordinary Fusion enabler borrowing another Spell's proof. All are covered by the real-catalog integration.

## Saved-deck output

Actual signed-host results on the scratch backup, using the saved Main/Extra/Side sections without padding, captured 2026-10-31. Normal uses the pinned TCG default; deck 3 uses Sage with Eyes of Blue and Domain/no-banlist. A synthetic authenticated actor exercises the host; this is not a capture from the running `:3000` web server. Full response artifact: `/tmp/suggestions-quality-RJwrOK/host-capture-final.json`.

| Rank | Deck 10 — Odion | Deck 9 — Light and darkness azamina | Deck 3 — Blue-Eyes DOMAIN |
| --- | --- | --- | --- |
| 1 | Small World | Pre-Preparation of Rites | Summoner's Art |
| 2 | Metaverse | Reinforcement of the Army | Small World |
| 3 | Set Rotation | Small World | Trade-In |
| 4 | Unexpected Dai | Trade-In | One-Way Synchro |
| 5 | Dwimmered Path | Foolish Burial | Ancient Rules |
| 6 | — | Void Apocalypse | Return of the Dragon Lords |
| 7 | — | Dwimmered Path | Silver's Cry |
| 8 | — | Dark Magic Veil | Dragon's Mirror |
| 9 | — | Foolish Burial Goods | Dragon Ravine |

Odion's first four now have explicit access/sequence evidence. Metaverse searches Treasures for later activation; Dai requires no monsters, Yoa and a Set card, before Lode. Deck 9's Foolish Burial names Skull Archfiend's Ritual route; Goods explicitly requires a related card already in GY. Blue-Eyes revival reasons require the target in GY; Dragon's Mirror names the complete Tyrant Dragon line. Summoner Monk/Manju, material-history revival and the four reported generic Odion links are absent. Deck 9 keeps its 38-card Extra hint.

## Production benchmark

Node 22.23.3, production Next, synthetic E2E authentication, signed host with authoritative admission, six warmups and 60 uncached samples per scenario. Inputs and outputs are disposable; source/fixture hashes stayed unchanged. Final command used the existing benchmark with `--next --samples 60 --warmup 6 --baseline 12 --check` and explicit scratch catalog/engine/output paths.

| Measurement | Normal Blue-Eyes | Domain |
| --- | ---: | ---: |
| Full HTTP p95 | 322.56 ms | 314.32 ms |
| Cold first request (excluded from p95) | 887.27 ms | 336.11 ms |
| Genuine host computations | 67 | 67 |

All three benchmark gates passed. The 64 cached replays produced 64 `notModified`, zero recomputations and zero failures; cached HTTP p95 was 5.70 ms. The clamped additional retained web RSS metric was 0 MiB; host RSS rose 19.01 MiB. No allocator override was used.

Timing varies with concurrent work: an earlier run of the identical final source, overlapping other Node test jobs, recorded 460.79/345.49 ms p95 (Normal/Domain), missing the 400 ms gate for Normal despite a 308.51 ms median. Both raw reports are retained so this variation is visible. The final confirmation above is not a guarantee of latency under concurrent load. CPU profiling led to pruning Extra summon solvers only when a candidate could no longer outrank an already-proven retained entry; all rows/scores/reasons stayed exactly equal for saved decks 10/9/3 and both benchmark decks.

Raw reports: `/tmp/suggestions-quality-RJwrOK/benchmark-confirmation/report.json` and `/tmp/suggestions-quality-RJwrOK/benchmark-release/report.json`. Targeted test logs, sourced precision report, signed-host capture and CPU profile are in the same scratch directory. Generated repository build output was removed after validation.
