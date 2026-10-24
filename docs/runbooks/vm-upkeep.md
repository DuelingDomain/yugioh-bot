# VM upkeep

Manual jobs on the production VM. Most are **not in the repo**. Do not guess. Ask the owner (marked below).

## Purpose

Keep the VM patched, with free disk and memory.

## Schedule & triggers

| Task | Schedule | In repo? |
|---|---|---|
| OS patches | Manual. [Operations checklist](../deployment/operations-checklist.md) says `apt update && apt upgrade -y` | Text only |
| Weekly disk clean | Planned, **not set up** (ask owner) | No |
| Swap file and disk/memory alerts | Planned, **not set up** (ask owner) | No |
| Duel storage VACUUM | Manual, after compaction | [Runbook section](../deployment/vm-runbook.md#manual-duel-storage-vacuum) |
| Docker image prune | Done by Deploy for old images (confirm) | [Deploy](deploy.md) |
| Production engine-error export | Parked by the owner | [engine-data-updates.md](../deployment/engine-data-updates.md) |

## What it changes

OS packages, Docker images and layers, the database file size.

## Depends on

SSH to the VM. The owner starts the SSH agent and adds the key (`ssh-add`). The VM address is in the [runbook facts](../deployment/vm-runbook.md#current-repository-state).

## Run it by hand

```bash
ssh <vm-user>@<vm-host>
df -h /                                # disk
free -h                                # memory and swap
docker system df                       # Docker use
sudo apt update && sudo apt list --upgradable
```

Patch (pick a quiet time, no live duels):

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot        # only if /var/run/reboot-required exists
```

After a reboot the containers restart by policy. Check `docker compose -f docker-compose.yml ps`. Backup timer is `Persistent`.

Clean Docker (safe parts only):

```bash
docker image prune -f
docker builder prune -f
```

## Check it worked

`df -h /` shows free space over 20 %. `docker compose ps` shows all services healthy. `curl -s -o /dev/null -w '%{http_code}' https://app.duelingdomain.com/sign-in` returns 200.

## When it fails

| Sign | Action |
|---|---|
| Disk full | Check `data/card-images` (limit 15 GiB), `docker system df`, old backups in `/var/backups/yugioh-bot`. |
| Out of memory during a deploy | Images are built in Actions, not on the VM (since #355). Check swap. |
| Unknown package break | Roll back images with [Deploy](deploy.md). OS rollback is not documented. |

## Cost/limits

Open questions for the owner:

1. Is a weekly disk clean set up? Where does it run?
2. Is swap on? Are disk or memory alerts set up? Who gets them?
3. Is a second off-site backup copy kept?
4. Who patches the OS and how often?
