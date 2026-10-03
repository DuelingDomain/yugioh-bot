# Cheap Deployment Options

## Recommendation

Run the app as a Docker Compose service on an always-on VM. Do not use serverless functions or hosts that sleep — Discord bots need a persistent websocket connection.

## Best Options

1. Hetzner Cloud CAX11 (ARM64, 4GB RAM, ~€3.79/mo) — recommended
2. Existing home server, NAS, or Raspberry Pi
3. Other small paid VMs with persistent storage

## Hetzner Quick Setup

1. Create a CAX11 server (Ubuntu 24.04, ARM64)
2. Add your SSH key in the Hetzner Cloud Console
3. Allow TCP ports 22, 80, 443 in the firewall (do not expose 4003)
4. Install Docker: `curl -fsSL https://get.docker.com | sh`
5. Clone the repo, create `.env` from `.env.example` (include `DUEL_INTERNAL_SECRET`)
6. First start: push to `main` (or `workflow_dispatch`) so Actions installs `data/duel-engine`. The ARM host does not compile Domain wasm.

See `docs/deployment/vm-runbook.md` for the full guide.

## Updating

Push to `main` or run the `Deploy` workflow on `main` for image updates. It transfers and verifies
the engine bundle, builds the images, and installs the bundle before recreating containers.
See [the VM runbook](vm-runbook.md#deployment-pipeline).

To start already built images:

```bash
cd /opt/yugioh-bot
docker compose -f docker-compose.yml up -d
```

## Backups

```bash
./scripts/backup-sqlite.sh
```

Optional daily cron:
```cron
0 3 * * * cd /opt/yugioh-bot && ./scripts/backup-sqlite.sh >> backup.log 2>&1
```

## Avoid

- Serverless functions
- Free hosts that sleep
- Ephemeral container storage without a mounted volume
- Multiple running bot replicas sharing the same SQLite database
