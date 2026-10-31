# Live next-engine investigation, 2026-10-31

Investigated branch `feat/archetype-bridges` at `17e2e99fe` against the SQLite file actually held open by the :3000 stack's duel process: `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`. Both baseline requests were also sent through the running host's signed `engines` operation. Investigation and replay connections were read-only; paid reviews used a separate scratch copy, followed by the explicitly authorized judgement-only write.

## Why the lists remained at three

There is no three-result cap. `BridgeEngineQueries.project` ranks up to eight engines and defaults to four final results. The completed deep projection asks for six. The web server validator also bounds fast results to four and completed results to six; `EngineList` renders all received suggestions. The UI's separate four-engine maximum limits the selected engine set, not rendered recommendations. Removing the final projection cap still returned exactly the original three recommendations for each current deck.

The earlier five-result replay used **Kashtira, Odion, Primite**. Current deck 10 detects **Ashtra, Odion, Primite**, displayed as **Ashtra, Temple of the Kings, Primite**. Its 60-card Main requires weight `max(3, 0.075 * 60) = 4.5`; Kashtira has weight **4.0** and is light. Ashtra has weight 13.5 and is selected, so it cannot also be a Next engine. The accepted Kashtira → Tearlaments pair remains available and passes both current reviews. It is outside the current selected engine set and is not fetched by `engineRows` for that query.

On the same snapshot, explicitly selecting Kashtira/Odion/Primite returns Tearlaments, Ashtra, Argostars, Altergeist with the normal cap, and additionally Blue-Eyes when the cap is raised. Selecting all four current/old engines returns Tearlaments, Argostars, Altergeist, Blue-Eyes. The earlier five was therefore a different engine set and a wider projection, not the current deck's normal fast response.

Deck 9 detects **Chaos, Sinful Spoils**. Azamina is light, so it remains a Next candidate. Sinful Spoils → White Forest passes its reviews but has a strict ranking score **3.792**, below the existing **4** floor. Its one observed co-play deck gives zero boost under the current two-observation requirement. Review acceptance alone does not bypass that ranking gate. Changes to co-play/mechanic ranking are outside this investigation's scope.

## Baseline and pending coverage

| Deck | Fast Next engines before | In review |
| --- | --- | --- |
| 9 | Azamina, Meklord, Regenesis | 10: eight pending, two disputed |
| 10 | Argostars, Altergeist, Blue-Eyes | 6: five pending, one disputed |

The fast operation reads actual `archetype_bridge` rows in either direction. All **13 unjudged rows are stored Niche access candidates**, not ephemeral engine-set pairs and not `kind: synergy`. They have no stored judgements. Their evidence supplies cost/material routes such as discarding/tributing a source card for a target search or using a source monster as a Link material. Co-play observations do not themselves provide these bridge rows.

`judgeStoredStrict` selects only rows where `coalesce(json_extract(bridge_json,'$.tier'),'strict')='strict'`. All 13 rows have `tier='niche'`, so the 460-row strict pass deliberately excluded them. The headline number of engines with a nonempty fast list does not measure per-deck candidate review coverage.

| Deck | Directed pair | Before |
| --- | --- | --- |
| 9 | Chaos → Blue-Eyes | Pending: Niche, neither judge present |
| 9 | Chaos → Toon | Pending: Niche, neither judge present |
| 9 | Chaos → Infinitrack | Pending: Niche, neither judge present |
| 9 | Chaos → Simorgh | Pending: Niche, neither judge present |
| 9 | Chaos → Gusto | Pending: Niche, neither judge present |
| 9 | Chaos → Synchron | Pending: Niche, neither judge present |
| 9 | Chaos → The Weather | Pending: Niche, neither judge present |
| 9 | Black Luster Soldier → Chaos | Disputed: valid/invalid independent verdicts |
| 9 | Blue-Eyes → Chaos | Disputed: valid/invalid independent verdicts |
| 9 | Sinful Spoils → The Weather | Pending: Niche, neither judge present |
| 10 | Ashtra → Majespecter | Pending: Niche, neither judge present |
| 10 | Ashtra → Contact | Pending: Niche, neither judge present |
| 10 | Ashtra → Genex | Pending: Niche, neither judge present |
| 10 | Odion → Gravekeeper's | Disputed: valid/invalid independent verdicts |
| 10 | Primite → The Weather | Pending: Niche, neither judge present |
| 10 | Primite → Blue-Eyes | Pending: Niche, neither judge present |

Existing disputes are Black Luster Soldier → Chaos, Blue-Eyes → Chaos, and Odion → Gravekeeper's. Each has both current reviews and an invalid/valid disagreement. Normal rules keep them hidden; this run does not retry or overrule them.

## Authorized data correction

No backend query or ranking change was indicated by the reproduction. The small correction is to review the missing stored Niche evidence for these two decks. Raising the fast cap or lowering the detection/ranking thresholds would change product behavior without fixing the missing reviews. A future coverage pass should select current pending evidence from relevant `engineRows` across tiers rather than treating a strict-only pass as complete coverage.

The one-time runner and all snapshots/reports are under `/tmp/claude-1000/next-engines-20261031`. The live online backup is `bot-before-pending.sqlite`; paid work is isolated in `judging.sqlite`. Systemd loaded the EnvironmentFile into the judging child with `LimitCORE=0`. The file and credential values were never read or printed by the operator. Logs are redacted. Signed read verification explicitly removes `ANTHROPIC_API_KEY` from its child environment.

The runner selects exactly the 13 pending Advanced Niche rows and invokes `judgeBridgePair` once per pair, retaining both independent Haiku framings, deterministic evidence validation, normal fact checking, no automatic retry and normal spend reservations. Its monthly ledger cap is the scratch snapshot's current-month spend/reservations plus **$1**, enforcing an incremental cap using reservations before requests. A changed UTC month stops the run. Verdicts are copied via `saveBridgeJudgement` only after checking unchanged live candidate hashes and current judge-input hashes inside the write transaction. The host is not migrated, candidate rows are not rewritten, and its historical spend ledger remains intact.

The foreground run completed in **9m 23.987s**. All **13 pairs** received both reviews: **8 accepted, 4 rejected, 1 disputed**, with **0 pending**. It made **52 provider requests** (26 independent reviews plus normal fact checks), settled **$0.074441** actual incremental cost, left **$0** reserved and reported **0 errors**. All provider calls used `claude-haiku-5-5`. No process needed killing. The live judgement count increased **916 → 942**; the existing trigger advanced `bridge_revision` **35086 → 35112**.

| Directed pair | Mechanic | Skeptic | Final gate |
| --- | --- | --- | --- |

| Chaos → Blue-Eyes | valid | valid | shown |
| Chaos → Toon | valid | valid | shown |
| Chaos → Infinitrack | invalid | invalid | invalid |
| Chaos → Simorgh | invalid | invalid | invalid |
| Chaos → Gusto | invalid | invalid | invalid |
| Chaos → Synchron | valid | invalid | review |
| Chaos → The Weather | valid | valid | shown |
| Sinful Spoils → The Weather | valid | valid | shown |
| Ashtra → Majespecter | valid | valid | shown |
| Ashtra → Contact | valid | valid | shown |
| Ashtra → Genex | invalid | invalid | invalid |
| Primite → The Weather | valid | valid | shown |
| Primite → Blue-Eyes | valid | valid | shown |

## Final live Next engines

These are fresh **HTTP 200** replies from the running :3000 stack's duel host, using each saved deck's current Main/Extra and no chip overrides. The read path made no judge calls. A separate read-only SQLite projection matched the host replies.

| Deck | Fast Next engines, in response order | Remaining in review |
| --- | --- | --- |
| 9 | **Azamina, Meklord, Regenesis, Toon** | **3 disputed, 0 pending:** Chaos → Synchron; Black Luster Soldier → Chaos; Blue-Eyes → Chaos |
| 10 | **Argostars, Majespecter, Altergeist, Blue-Eyes** | **1 disputed, 0 pending:** Temple of the Kings (Odion) → Gravekeeper's |

Deck 9's accepted Blue-Eyes and The Weather suggestions are now below the fast four-result cutoff. The wider projection returns **Azamina, Meklord, Regenesis, Toon, Blue-Eyes, The Weather**. White Forest remains below the strict score floor described above.

Deck 10's Blue-Eyes suggestion now includes both accepted incoming paths, Primite → Blue-Eyes and Odion → Blue-Eyes. Ashtra → Contact is accepted but excluded from recommendations by the generic-hub/low-score filter. Primite → The Weather is accepted but loses the existing bounded low-score Niche slots to higher-ranked candidates. Widening only the final limit still returns the same four engines. The accepted gate is necessary, not sufficient, for Next ranking.

## Verification and changes

- `npm run build --workspace=packages/shared`: passed as the required consumer-test prerequisite.
- Integration suites: `packages/shared/tests/bridge-judge.integration.test.ts`, `packages/duel-server/tests/bridge-engines.integration.test.ts`, `scripts/effects/tests/stored-strict-judging.integration.test.ts`: **3 files, 63 tests passed**, single worker. Tests use fixture provider replies; they incur no real provider cost.
- Fresh signed live engine reads: both HTTP 200, before and after; final responses match read-only SQLite projections.
- Live `PRAGMA integrity_check`: **ok**; `PRAGMA foreign_key_check`: **0 violations**.
- Offline replay of the 26 new verdicts through `saveBridgeJudgement` on a disposable copy of the original backup changed **only `bridge_judgement` and `bridge_revision`**. Replay integrity/FK checks passed.
- Live candidate count remained **2665**. Its historical spend ledger remained **134 requests / $0.156172**; incremental paid accounting stays durably in the judging scratch ledger, matching the earlier strict-run write scope. The committed judgement artifact was not rewritten.
- No product source code, component, or `deck-suggestion*` file changed. The repository change is this report. Generated shared `dist` and TypeScript build metadata were deleted after testing. Existing/concurrent work was preserved.

Artifacts: `paid-report.json` (cost and all verdicts), `selection.json` (exact baseline queries and candidates), `inspection.json` / `inspection-after.json` (per-row gate evidence), `live-before.json` / `live-after.json` (actual host lists), `integrity-and-footprint.json`, the one-time runner, and `run-redacted.log` in the scratch directory above.
