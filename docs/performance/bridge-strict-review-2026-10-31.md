# Stored strict bridge review, 2026-10-31

The owner authorized one local pass over all stored strict rows, using the existing Haiku mechanic and skeptic judges, normal fact checking and cost reservations. The target is `domain-multiplayer/data/bot.sqlite`.

## Status

The paid run is blocked on its authorized credential source. No duel-server process, listener on 3000/4003, or duel Docker container was running in this environment when inspected. No environment files were read, no key was printed, no paid call was made, and no verdict was written to the host DB. The operator was asked for the process location/PID.

A SQLite online backup is at `/tmp/claude-1000/strict-judging-20261031/bot-before.sqlite` (`quick_check: ok`). The backup contains 244 Advanced and 216 Genesys strict rows, plus 2,220 niche rows. There are 76 existing judge records.

Read-only baseline, measured on a separately migrated scratch copy using the current gates and fast engine projection:

| Format | Strict rows | Accepted | Rejected | Disputed | Pending | Engines with nonempty fast Next lists |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Advanced | 244 | 14 | 4 | 2 | 224 | 13 |
| Genesys | 216 | 0 | 0 | 0 | 216 | 0 |

Actual additional spend: **$0.000000**. These are baseline counts, not completed-run results. Fast list counts include accepted incoming and outgoing stored links and apply the normal ranking/package/Genesys gates.

## Runner

`scripts/effects/judge-stored-strict.ts` accepts `--database`, `--output`, and the running duel-server `--process-id`. Its parent reads only that process's `/proc/PID/environ` into a child environment; credentials are never emitted. The child backs up SQLite, migrates a separate scratch DB, runs each strict row once through `judgeBridgePair` with two concurrent pair tasks, and retains the normal spend ledger in that scratch DB. It never lowers verdict or fact-check rules. An existing scratch DB prevents an automatic repeat.

After judging, one transaction verifies unchanged live evidence and writes current reviews with `saveBridgeJudgement`, skipping unchanged records. No host migration, candidate write or spend-table write occurs. The existing judgement trigger necessarily increments `bridge_revision`. Current reviews are exported into the committed judgement artifact; actual usage, gate outcomes and fast-list counts are written to `report.json` under the output directory.

```sh
node --conditions=source --import tsx scripts/effects/judge-stored-strict.ts \
  --database /home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite \
  --output /tmp/claude-1000/strict-judging-20261031 \
  --process-id RUNNING_DUEL_SERVER_PID
```

Integration verification: `scripts/effects/tests/stored-strict-judging.integration.test.ts` and `scripts/effects/tests/bridge-batch.integration.test.ts`: **12 passed**. This exercises SDK transport fixtures, both framings, grounded fact checking, reservations, billing settlement and cached no-call reuse. No unit tests were added.
