# Test, nightly fuzz and new-card smoke

Workflow: `.github/workflows/test.yml`. Test layers: [ADR-0003](../adr/0003-duel-test-layers.md).

PRs and main pushes select groups by changed paths and shared import reachability. Main compares with the last successful tested ancestor. Main images build concurrently with checks, but Deploy requires that entire push **Test** to succeed and uses its exact run/attempt artifacts. PR, nightly and manual Test runs never deploy.

At 03:17 UTC the default-branch schedule selects every app, engine, legacy, surrender, differential, native, rule-coverage, effect-protocol and production dry-run group, plus all four nduel fuzz cases. The final CI result fails for failed/cancelled or missing required work and opens a **Nightly full Test failed** issue unless one is already open. No external secrets are needed for the no-publish dry run or offline effect test; native/engine builds need Docker and the pinned download sources. A manual `gh workflow run test.yml --ref main -f nightly=true` reproduces the full run; `nightly=false` skips only the nduel fuzz. Close the nightly issue after investigating and obtaining a green full run.

## Purpose

Runs the affected checks, with a full nightly run. A green Test on a push to `main` is what lets [Deploy](deploy.md) start. Once a day it also runs the engine fuzz (`nduel`).

## Schedule & triggers

| Trigger | What runs |
|---|---|
| Pull request | Affected test groups; docs-only skips tests |
| Push to `main` | Affected test groups, concurrent production bundle/image builds. Green = deploy starts |
| Schedule `17 3 * * *` (daily 03:17 UTC) | Every test group, production dry run and `nduel-nightly` |
| Manual | Inputs `nightly` (default true), `new_card_smoke`, `nduel_seeds` (default 100) |

`nduel-nightly` runs four legs: `n2`, `n3`, `n4`, `tag`. Each runs seeds 1 to N with `--check-future` and ASan/UBSan. Leg `n2` also checks the golden hashes.

## What it changes

Nightly failures open a deduplicated issue. It also writes status artifacts (`nduel-status-<leg>`), sticky PR comments and caches. Push runs build the images that Deploy uses.

## Depends on

Actions variables `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (set), `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` (not set). Cached engine cores. Node 22.

## Run it by hand

```bash
R=DuelingDomain/yugioh-bot
# Nightly fuzz on main, 100 seeds
gh workflow run test.yml -R $R --ref main -f nightly=true -f nduel_seeds=100
# Regular suites on a branch, no fuzz
gh workflow run test.yml -R $R --ref <branch> -f nightly=false
```

Local fuzz: `bash packages/duel-server/scripts/run-nduel.sh` (needs the built cores). Local tests: see [CLAUDE.md](../../CLAUDE.md).

## Check it worked

```bash
gh run list -R DuelingDomain/yugioh-bot --workflow test.yml --event schedule --limit 7
gh run list -R DuelingDomain/yugioh-bot --workflow test.yml --branch main --event push --limit 5
```

## When it fails

| Sign | Action |
|---|---|
| Push run red | Deploy is blocked on purpose. Fix main. |
| Nightly red, logs show `sanitizer ... runtime error` | Real engine bug. Download `nduel-status-<leg>`. Reproduce with the seed in the log. |
| `fail-on-cache-miss` | The core cache expired. Re-run. The `core-build` job rebuilds it. |

**Failing now:** nightly red 10-20 to 10-24. Legs `n2` and `n3` (10-24 run) show `operations.cpp:5737:101: runtime error: member access within null pointer of type 'struct effect'`. Green until 10-19. Push runs on main are green and deploys work. No one has opened a ticket in this audit. The owner must assign it.

## Cost/limits

Public repo runners. Nightly legs have a 240-minute limit. Superseded main runs are cancelled.

## New-card smoke

Plays every new or changed card on the engine on the `chore/engine-data-update` PR. Four shards. It posts a sticky report and a status.

| Item | Detail |
|---|---|
| Starts | By the PR (when the PAT opened it), or by the engine-data job via dispatch (no PAT) |
| By hand | `gh workflow run test.yml -R DuelingDomain/yugioh-bot --ref chore/engine-data-update -f nightly=false -f new_card_smoke=true` |
| Fails | Open the sticky comment. The failing card is named. Fix the script pin or hold the PR. |
