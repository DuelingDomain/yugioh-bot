# Stored strict bridge review, 2026-10-31

The owner authorized one local pass over all stored strict rows in `domain-multiplayer/data/bot.sqlite`, using the existing Haiku mechanic and skeptic judges, normal fact checking and cost reservations.

## Completed paid run

All **460 strict rows** were visited once. The run made **1,700 provider requests**, settled **$1.950417** in actual usage, retained **$0** in reservations and reported **zero provider errors**. Both framings and fact checks used `claude-haiku-5-5`. No verdict or fact-check rule was relaxed, and pending rows were not automatically retried. Service runtime was 1h 54m 52s.

Final read-only verification against the live :3000 database:

| Format | Strict rows | Accepted | Rejected | Disputed | Pending | Engines with nonempty fast Next lists |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Advanced | 244 | 169 | 49 | 15 | 11 | 165 |
| Genesys | 216 | 138 | 46 | 20 | 12 | 143 |

The initial read-only baseline was Advanced 14/4/2/224 and Genesys 0/0/0/216 (accepted/rejected/disputed/pending), with 13 and 0 nonempty engine lists. Fast-list counts apply normal ranking, package and Genesys gates and include accepted incoming and outgoing links. The judging scratch snapshot reported 144 Genesys lists; after concurrent live candidate updates, the live count was 143. All strict counts matched between scratch and live. The final verification supplied an empty judge environment and made zero provider requests.

## Credential loading and write scope

The EnvironmentFile was loaded by systemd into the judging process only. Its contents and key values were never read or printed by the operator. The one-time runner from `10aa12752` was invoked in child mode with the approved target and output directory:

```sh
systemd-run --user --wait --pipe --collect \
  --unit=bridge-strict-judging-20261031 -p LimitCORE=0 \
  -p EnvironmentFile=/home/sulman633/repos/yugioh-bot/data/services/duel.env \
  --setenv=BRIDGE_JUDGE_MODEL=claude-haiku-5-5 --setenv=BRIDGE_JUDGE_MONTHLY_USD=4 \
  --working-directory=/home/sulman633/repos/yugioh-bot/.worktrees/archetype-drilldown \
  /home/sulman633/.nvm/versions/node/v22.23.3/bin/node --conditions=source --import tsx \
  scripts/effects/judge-stored-strict.ts \
  --database /home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite \
  --output /tmp/claude-1000/strict-judging-20261031 --child
```

A redacting log filter was applied to process output. The normal $4 monthly reservation cap included the copied $0.156172 historical ledger; actual incremental usage was also monitored throughout. The $4 stop threshold was never reached, and no process needed killing.

The original online backup remains at `/tmp/claude-1000/strict-judging-20261031/bot-before.sqlite`. The runner migrated and billed only its separate `judging.sqlite`. After verifying unchanged live evidence, it wrote **840 new reviews** through `saveBridgeJudgement` in one live transaction: the judgement count rose from **76 to 916**. The live spend table remained at 134 historical requests / $0.156172. The existing judgement trigger necessarily incremented `bridge_revision`.

## Integrity and concurrent activity

Live `PRAGMA integrity_check` returned **ok**, and `PRAGMA foreign_key_check` returned no violations. A full table comparison found unrelated concurrent changes during the paid run: `users`, `sqlite_sequence`, `bridge_deep_actor`, `bridge_graph`, `bridge_deep_job`, new `bridge_engine_revision`, `archetype_bridge`, `card_capability`, `vps_service_health` and `bridge_artifact_import`, in addition to the expected judgement/revision changes. The live schema grew from 90 to 91 tables, and niche candidates fell from 2,220 to 2,205; all 460 strict rows remained. Web and duel services were running at verification. These concurrent changes were preserved; an all-unrelated-tables-unchanged assertion therefore did not pass.

An offline replay of all 840 new records through the normal judgement store on a disposable copy of the original backup changed **only `bridge_judgement` and `bridge_revision`**, with integrity and foreign keys passing. The runner does not migrate the host, write candidate rows, or write the host spend table.

Reports are under `/tmp/claude-1000/strict-judging-20261031`: `report.json`, `live-projection.json`, `integrity-report.json`, `live-tables-before.json`, `live-tables-after.json`, `write-footprint.json` and `run-redacted.log`. Current reviews were exported to `packages/shared/data/effects/bridge-judgements.jsonl.gz`. The existing scratch DB prevents an automatic repeat of the paid pass.

## Integration verification

The stored-strict, batch, artifact-publication and signed-host API integration suites were rerun alongside the web signed-host/browser-helper integration suite. Exact results are recorded in `bridge-api-cleanup-2026-10-31.md`. No unit tests were added or run.
