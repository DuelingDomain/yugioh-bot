# Clean GHCR images

Workflow: `.github/workflows/ghcr-cleanup.yml`. Setup notes: [GHCR owner setup and retention](../deployment/vm-runbook.md#ghcr-owner-setup-and-retention).

## Purpose

Deletes old container image versions so registry storage stays small. Rollback keeps working.

## Schedule & triggers

| Trigger | When |
|---|---|
| Schedule | `17 5 * * 0` = Sunday 05:17 UTC |
| Manual | `workflow_dispatch`, no inputs |

Shares group `deploy-production` with [Deploy](deploy.md). It waits for a running deploy.

## What it changes

Deletes versions of `yugioh-bot-{duel,web,worker,ws,bot}` in GHCR. It keeps:

- the newest 10 `release-<sha>` versions;
- the newest 10 old plain-SHA versions made before 2026-10-21;
- every version with a name tag such as `prod`, `prev` or a cache tag;
- anything younger than 7 days.

## Depends on

Job permission `packages: write` (Actions token). The packages must be public. If a kept manifest cannot be read, the job stops and deletes nothing.

## Run it by hand

```bash
gh workflow run ghcr-cleanup.yml -R DuelingDomain/yugioh-bot
```

Local checks: `node --test scripts/ci/ghcr-cleanup.test.mjs`.

## Check it worked

```bash
gh run list -R DuelingDomain/yugioh-bot --workflow ghcr-cleanup.yml --limit 3
```

Open the run. The log lists the deleted versions per package.

## When it fails

| Sign | Action |
|---|---|
| 403 or 404 on a package | Package is not public or not linked to the repo. Fix in package settings. |
| Stops on a manifest | A retained version is damaged. Do not delete by hand. Ask the owner. |
| Rollback tag missing later | The SHA was older than the 10 kept. Rebuild by deploying that SHA. |

Health: last scheduled run 10-18, success. The next run is due Sunday 10-25.

## Cost/limits

Free. About 20 minutes at most.
