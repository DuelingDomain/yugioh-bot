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
3. Apply the [runbook's cloud firewall rules](vm-runbook.md#create-the-server)
4. Install Docker: `curl -fsSL https://get.docker.com | sh`
5. Clone the repo and create `.env` per the [runbook's production environment setup](vm-runbook.md#create-env) (include `DUEL_INTERNAL_SECRET`)
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

See the [runbook's Backups section](vm-runbook.md#backups) for automatic backups and restore instructions.

## Avoid

- Serverless functions
- Free hosts that sleep
- Ephemeral container storage without a mounted volume
- Multiple running bot replicas sharing the same SQLite database
