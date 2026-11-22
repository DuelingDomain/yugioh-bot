# Test, Full Suite, nightly fuzz and new-card smoke

The workflows are `.github/workflows/test.yml` and `.github/workflows/full-suite.yml`. See [ADR-0003](../adr/0003-duel-test-layers.md) for the test layers.

PRs and the main deploy gate select files by area. Hub and CI wiring changes use fixed smoke files and workspace typechecks. Workflow and CI helper changes also run the CI script checks. Engine jobs require a direct engine input or a full fallback.

On main, **Test** diffs from the last healthy deployment. The gate runs every group when the baseline or diff is unavailable. It can reuse a green same-repository PR Test when its proof matches the tree, deployed base and changed paths. Production image build or verified reuse runs on every main push. **Deploy** requires a successful main push Test and uses its exact run and attempt artifacts.

Area-selected gates run native ASan/UBSan and differential tests for core C++ or Lua sources, patches, pins, native tooling, engine package scripts and other direct core inputs. TypeScript engine runtime changes select the engine suites. Root configuration changes and unavailable diffs select every group. The final CI result requires each selected group to succeed.

At 03:17 UTC the default-branch schedule selects every app, engine, legacy, surrender, differential, native, rule-coverage, effect-protocol and production dry-run group, plus all four nduel fuzz cases. The final CI result fails for failed/cancelled or missing required work and opens a **Nightly full Test failed** issue unless one is already open. No external secrets are needed for the no-publish dry run or offline effect test; native/engine builds need Docker and the pinned download sources. A manual `gh workflow run test.yml --ref main -f nightly=true` reproduces the full run; `nightly=false` skips only the nduel fuzz. Close the nightly issue after investigating and obtaining a green full run.

## Purpose

**Full Suite** starts at the same time as the gate on each main push and reports regressions outside the gate's selection. A regression can reach production for roughly ten minutes before the full suite reports. Inspect the labeled issue and use the manual rollback path if production is affected. See [Deploy](deploy.md) and [image rollback](../deployment/vm-runbook.md#image-rollback).

## Schedule & triggers

| Trigger | What runs |
|---|---|
| Pull request | Affected test groups; docs-only skips tests |
| Push to `main` | **Test** runs affected checks or reuses PR proof and prepares the deploy artifacts. **Full Suite** runs every regular test group independently, including pinned, surrender, legacy, differential, native ASan/UBSan and nduel golden hashes, plus the production dry run. |
| Schedule `17 3 * * *` (daily 03:17 UTC) | Every test group, production dry run and `nduel-nightly` |
| Manual | Inputs `nightly` (default true), `new_card_smoke`, `nduel_seeds` (default 100) |

`nduel-nightly` runs four legs: `n2`, `n3`, `n4`, `tag`. Each runs seeds 1 to N with `--check-future` and ASan/UBSan. Leg `n2` also checks the golden hashes.

## What it changes

A failing **Full Suite** opens or updates one issue labeled `ci-full-suite-red`, with the short SHA, failed jobs, run link and manual rollback steps. A later green main run closes it. Rollback requires an operator. Nightly failures open their own deduplicated issue and upload `nduel-status-<leg>`. New-card smoke writes the sticky PR report.

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
gh run list -R DuelingDomain/yugioh-bot --workflow full-suite.yml --branch main --event push --limit 5
```

## When it fails

| Sign | Action |
|---|---|
| Main push Test red | Deploy is blocked. Fix the failing gate job. |
| Full Suite red | Open `ci-full-suite-red` and inspect the failed jobs. If production is affected, dispatch Deploy from main with `ref` set to a previous healthy SHA and `rollback=true`. Keep `force=false` to protect live duels. |
| Nightly red, logs show `sanitizer ... runtime error` | Real engine bug. Download `nduel-status-<leg>`. Reproduce with the seed in the log. |
| `fail-on-cache-miss` | The core cache expired. Re-run. The `core-build` job rebuilds it. |

In the 2026-10-24 audit, nightly had been red since 10-20. Legs `n2` and `n3` in the 10-24 run reported `operations.cpp:5737:101: runtime error: member access within null pointer of type 'struct effect'`.

## Cost/limits

Public repo runners. Nightly legs have a 240-minute limit. Newer main pushes cancel superseded main Test and Full Suite runs in their own groups. The nightly schedule has separate concurrency.

## New-card smoke

Plays every new or changed card on the engine on the `chore/engine-data-update` PR. Four shards. It posts a sticky report and a status.

| Item | Detail |
|---|---|
| Starts | By the PR (when the PAT opened it), or by the engine-data job via dispatch (no PAT) |
| By hand | `gh workflow run test.yml -R DuelingDomain/yugioh-bot --ref chore/engine-data-update -f nightly=false -f new_card_smoke=true` |
| Fails | Open the sticky comment. The failing card is named. Fix the script pin or hold the PR. |
