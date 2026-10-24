# Deploy

Workflow: `.github/workflows/deploy.yml`. Full guide: [VM runbook](../deployment/vm-runbook.md#automatic-production). Rollback: [Image rollback](../deployment/vm-runbook.md#image-rollback).

## Purpose

Builds ARM64 images in Actions, pushes them to GHCR, then updates the production VM. The VM only pulls.

## Schedule & triggers

| Trigger | Detail |
|---|---|
| Automatic | After a green **Test** push run on `main`. Waits up to 3600 s for idle duels. Skips a run if a newer one is queued |
| Manual | Inputs `ref` (required), `force` (deploy during live games), `rollback` (older SHA) |

Group `deploy-production`, queue max. [GHCR cleanup](ghcr-cleanup.md) uses the same group.

## What it changes

- Images `yugioh-bot-{duel,web,worker,ws,bot}` in GHCR (tag `release-<sha>`; `prod` and `prev` move).
- `/opt/yugioh-bot` on the VM, the running containers, a database backup, and database migrations.
- A Sentry release (if `SENTRY_AUTH_TOKEN` exists).

Jobs: `prepare`, `build`, `deploy`, `retain`, `report-release`.

## Depends on

`VM_HOST`, `VM_USER`, `VM_PORT`, `VM_SSH_KNOWN_HOSTS`, `VM_SSH_PRIVATE_KEY` (`production` environment). Optional `SENTRY_AUTH_TOKEN`. Public GHCR packages. Variable `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Docker on the VM.

## Run it by hand

```bash
R=DuelingDomain/yugioh-bot
# Deploy main
gh workflow run deploy.yml -R $R --ref main -f ref=main
# Deploy during live games (engine preflight still runs)
gh workflow run deploy.yml -R $R --ref main -f ref=main -f force=true
# Roll back: SHA must be on main with a green push Test
gh workflow run deploy.yml -R $R --ref main -f ref=<full-sha> -f rollback=true
```

Image rollback does not undo database changes. Read the rollback section before an incompatible schema change.

## Check it worked

```bash
gh run list -R DuelingDomain/yugioh-bot --workflow deploy.yml --limit 5
curl -s -o /dev/null -w '%{http_code}\n' https://app.duelingdomain.com/sign-in   # expect 200
```

The run log prints `Production deployed SHA`. On the VM: `docker compose -f docker-compose.yml ps`.

## When it fails

| Sign | Action |
|---|---|
| Run `skipped` | A newer release replaced it. Normal. |
| Waits a long time | Live duels. Wait, or use `force=true`. |
| Engine preflight fails | See [engine bundle checks](../deployment/vm-runbook.md#before-a-deploy-that-changes-the-engine-bundle). |
| SSH step fails | Check the VM secrets and `VM_SSH_KNOWN_HOSTS`. |
| Health check fails | Read the VM logs. Use the rollback command. |

Health: green. Recent `skipped` runs are superseded runs.

## Cost/limits

Up to 180 minutes per run. Free runner time. GHCR storage is trimmed weekly by [Clean GHCR images](ghcr-cleanup.md).
