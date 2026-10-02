# VM Deployment Runbook

This runbook covers deploying the YuGiOh bot + web app to a VM. The stack runs via Docker Compose with Caddy as a reverse proxy. GitHub Actions deploys `main` automatically on push.

## Current Repository State

- GitHub repo: `https://github.com/imran443/yugioh-bot`
- Production branch: `main`
- Deploy workflow: `.github/workflows/deploy.yml`
- VM provider: Hetzner Cloud
- VM public IP: `178.105.36.104`; production hostname (`SITE_DOMAIN`): `duelistskingdom.com`
- VM app path: `/opt/yugioh-bot`
- Runtime user: `root`
- Data path: `/opt/yugioh-bot/data/bot.sqlite`

## SSH Access

The deploy key lives at `~/.ssh/hetzner_deploy` on the maintainer's workstation.
Use the VM IP from the [facts list](#current-repository-state) for `YOUR_VM_IP` below.

```bash
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP
```

One-liners (run from your workstation, no interactive shell needed):

```bash
# Tail logs
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP \
  'cd /opt/yugioh-bot && docker compose -f docker-compose.yml logs --tail=100'

# Inspect production .env
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP \
  'grep -E "^(SITE_DOMAIN|NEXTAUTH_URL|WEB_URL)=" /opt/yugioh-bot/.env'

# Restart a service
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP \
  'cd /opt/yugioh-bot && docker compose -f docker-compose.yml restart bot'
```

Optional — add a `~/.ssh/config` entry so you can drop the `-i` flag:

```sshconfig
Host yugioh-bot
    HostName YOUR_VM_IP
    User root
    IdentityFile ~/.ssh/hetzner_deploy
```

Then `ssh yugioh-bot` works.

The deploy workflow requires these GitHub Actions secrets:

- `VM_HOST`
- `VM_USER`
- `VM_SSH_PRIVATE_KEY`
- `VM_PORT` (optional, defaults to 22)

## Deployment Pipeline

1. Code is pushed to `main` on GitHub.
2. GitHub Actions starts the `Deploy` workflow on `ubuntu-latest` (amd64).
3. The workflow builds or restores the pinned duel-engine resource bundle
   (`cards.cdb`, `card-scripts/`, `strings.conf`, `ocgcore.domain.wasm`, `manifest.json`)
   using `npm run duel:prepare` and `packages/duel-server/scripts/build-domain-core.ts`
   inside `docker.io/emscripten/emsdk:4.0.9` (digest from `packages/duel-server/domain-core/pins.json`).
   Identical pins hit the Actions cache and skip regenerate.
4. The workflow SSHes into the VM, resets `/opt/yugioh-bot` to `origin/main`,
   rebuilds Compose images, stops **web** (ingress) only, then installs the
   bundle into `/opt/yugioh-bot/data/duel-engine` **before** `docker compose down`.
   The duel engine stays up during the check. Install is a no-op when
   `manifest.json` is identical. A different bundle is refused while
   `duels.status = 'active'` in `data/bot.sqlite` (locked/corrupt DB and missing
   columns fail closed); on refuse, `docker compose start web` restores the old
   web container and the deploy exits without recreating duel. This reduces
   new-table races; it is not a race-free preflight. It never writes `data/bot.sqlite`.
5. Compose starts bot, ws, duel, web, and caddy. The duel container verifies
   the volume bundle and runs `node packages/duel-server/dist/server.js`
   (`dist/worker.js` is loaded by the compiled host). Container restarts do
   not re-download or recompile the bundle.
6. Caddy serves `https://<SITE_DOMAIN>` and 308-redirects `www.<SITE_DOMAIN>`
   and every plain-HTTP host (including old IP links), preserving path and query.
   Keep `caddy_data` and `caddy_config` volumes so certificates survive deploys.

Remote steps used by the workflow (bundle tarball is built on the runner first):

```bash
cd /opt/yugioh-bot && \
git fetch --all --prune && \
git reset --hard origin/main && \
docker compose -f docker-compose.yml build && \
docker compose -f docker-compose.yml stop web && \
# install-engine-bundle.sh: unique sibling staging; refuses a different
# bundle while active duels exist; start web again on refuse
docker compose -f docker-compose.yml down --remove-orphans && \
docker compose -f docker-compose.yml up -d && \
docker compose -f docker-compose.yml ps && \
docker compose -f docker-compose.yml logs --tail=40
```

## VM Setup (Hetzner CAX11 or similar)

### Create the Server

1. Go to [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Create a new project → Add server
3. Location: any
4. Image: Ubuntu 24.04
5. Type: CAX11 (ARM64, 4GB RAM, €3.79/mo)
6. Add your SSH public key
7. Hetzner Cloud Firewall: allow TCP 22/80/443 + UDP 443; Docker-published ports bypass ufw; never publish 4003. Keep TCP 80 open for redirects and ACME HTTP-01 challenges.
8. Name: `yugioh-bot`
9. Create & Buy

Note the IPv4 address after creation.
Point the DNS A records for `SITE_DOMAIN` and `www.<SITE_DOMAIN>` to the VM IP.

### Initial Server Setup

```bash
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP

apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git
```

### Clone the Repo

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/imran443/yugioh-bot.git
cd yugioh-bot
```

### Create `.env`

```bash
cp .env.example .env
nano .env
```

Fill in (Compose expands `${SITE_DOMAIN}` in the unquoted URL values):

```bash
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_discord_app_id
DISCORD_CLIENT_SECRET=your_discord_app_secret
DISCORD_GUILD_ID=your_guild_id
DISCORD_REMINDER_CHANNEL_ID=your_channel_id
DISCORD_DEFAULT_CHANNEL_ID=your_default_channel_id

SITE_DOMAIN=  # hostname without scheme; see facts list
NEXTAUTH_SECRET=  # generate with: openssl rand -base64 32
NEXTAUTH_URL=https://${SITE_DOMAIN}
WEB_URL=https://${SITE_DOMAIN}

WS_INTERNAL_SECRET=  # openssl rand -hex 32; same on web, bot, duel, ws
BOT_ANNOUNCE_SECRET=  # openssl rand -hex 32
DUEL_INTERNAL_SECRET=  # openssl rand -hex 32; same on web and duel

DATABASE_PATH=./data/bot.sqlite
REMINDER_CRON=0 10 * * *
REMINDER_TIMEZONE=America/New_York
```

After editing `.env`, recreate containers with `docker compose -f docker-compose.yml up -d`. `restart` does not re-read `.env`.

### Build & Run

The ARM VM does not compile Domain wasm. First production start should be a `main` push
or `workflow_dispatch` so GitHub Actions can install `/opt/yugioh-bot/data/duel-engine`.
A compose-only start without that bundle will fail the `duel` container at verify.

```bash
docker compose -f docker-compose.yml up -d --build
```

Image builds take several minutes. The resource bundle is not rebuilt on container restart.

### Verify

```bash
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f
```

After deploy, run `scripts/smoke-test-site.sh <SITE_DOMAIN> <VM IP>` from the repo on your workstation to check certificates, redirects, Socket.IO, and the Discord callback URL.

Manually open `https://<SITE_DOMAIN>` in a browser, sign in with Discord, and confirm the dashboard loads and a draft updates live; the smoke script cannot verify these checks.

### Discord OAuth Redirect

In the [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects, add:

```
https://<SITE_DOMAIN>/api/auth/callback/discord
```

## GitHub Actions Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions, and add:

| Secret | Value |
|--------|-------|
| `VM_HOST` | Your VM's public IP |
| `VM_USER` | `root` |
| `VM_SSH_PRIVATE_KEY` | Full contents of your SSH private key |
| `VM_PORT` | `22` |

After these are set, every push to `main` will auto-deploy.

## Auto Deploy From Main

`.github/workflows/deploy.yml` triggers on every push to `main` and on `workflow_dispatch`.

Normal flow:

1. Work on a branch.
2. Open a pull request.
3. Merge into `main`.
4. GitHub Actions deploys automatically.

## Manual Operations

Run from `/opt/yugioh-bot` on the VM.

```bash
# View status
docker compose -f docker-compose.yml ps

# View logs
docker compose -f docker-compose.yml logs --tail=200

# Follow logs
docker compose -f docker-compose.yml logs -f

# Restart a service
docker compose -f docker-compose.yml restart bot

# Manual image update (does not rebuild the engine bundle; volume data/duel-engine stays)
git fetch --all --prune && git reset --hard origin/main
docker compose -f docker-compose.yml up -d --build

# Stop all
docker compose -f docker-compose.yml down
```

## Backups

The root systemd service runs the repo's `scripts/backup/dueling-backup` with Python's SQLite backup API, including committed WAL writes without stopping the app or requiring the SQLite CLI. The timer runs daily at **07:30 UTC**, with up to ten minutes of random delay and catch-up after downtime. Snapshots are integrity checked, mode 0600, and paired with SHA-256 sidecars in `/var/backups/yugioh-bot` (directory mode 0700). `DUELING_BACKUP_SRC` and `DUELING_BACKUP_DIR` override the source and destination. Deploys update the script used by the service; re-copy the units if their configuration changes.

After a successful backup or verified pull, each side keeps the newest N automatic `bot-YYYYmmdd-HHMMSSZ.sqlite` files by UTC filename and deletes older ones with their sidecars. N defaults to **7** and must be an integer >= 1: set `DUELING_BACKUP_KEEP` in a systemd service drop-in on the VM, or `KEEP` in the workstation script's environment. Manual and other-named files are preserved. Completion lines include `kept` and `total_bytes` for retained automatic SQLite files, excluding sidecars and manual files.

**VM install** — from the deployed checkout:

```bash
cd /opt/yugioh-bot
unit=dueling-backup
sudo cp "scripts/backup/$unit.service" "scripts/backup/$unit.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now "$unit.timer"
sudo systemctl start "$unit.service"
sudo journalctl -u "$unit.service" --no-pager -n 30
```

**Workstation install** — WSL needs `rsync`, `ssh`, `sha256sum`, and `python3`; the SSH alias `dueling-system` must reach the VM as root with a key and trusted host key. `LOCAL_DIR` defaults to `/home/imran/backups/dueling-system`; `pull.log` there keeps at most 1,000 lines. Optional `MIRROR_DIR` copies to a Windows-accessible directory without deleting older mirrored files. Set environment overrides inside the installed script for scheduled runs. Exit 2 warns of no automatic backup or a newest backup older than 36 hours (available files still mirror); other nonzero exits report errors.

From the repo in WSL:

```bash
script=pull-dueling-backup.sh
mkdir -p ~/bin
cp "scripts/backup/$script" "$HOME/bin/$script"
chmod +x "$HOME/bin/$script"
"$HOME/bin/$script"
```

Adjust the distro, Linux user, script path, and time variables at the top of the registration script for your WSL setup. From **Windows PowerShell**, in a Windows-accessible checkout:

```powershell
.\scripts\backup\register-pull-task.ps1
```

The task defaults to **21:00 local time** as the current Windows user while logged on, without storing a password; missed runs catch up when a network is available. Registration replaces that user's task of the same name.

**RESTORE** — run as root on the VM, choose an existing backup below, and stop on any failed command. Pause the timer and take a fresh snapshot before verifying the chosen backup. Keep the original database and WAL/SHM together in the dated folder; only remove these live files after all four writers stop.

```bash
sudo -i
set -euo pipefail
cd /opt/yugioh-bot
unit=dueling-backup
db=data/bot.sqlite
compose=(docker compose -f docker-compose.yml)
services=(bot web duel ws)
systemctl stop "$unit.timer"
systemctl start "$unit.service"
backup=/var/backups/yugioh-bot/bot-YYYYmmdd-HHMMSSZ.sqlite
(cd "$(dirname "$backup")" && sha256sum -c "$(basename "$backup").sha256")
python3 - "$backup" <<'PY'
import sqlite3, sys
from contextlib import closing
from pathlib import Path
with closing(sqlite3.connect(Path(sys.argv[1]).as_uri() + '?mode=ro', uri=True)) as db:
    result = db.execute('PRAGMA integrity_check').fetchall()
    if result != [('ok',)]:
        raise SystemExit('Backup integrity check failed: ' + repr(result))
PY
"${compose[@]}" stop "${services[@]}"
db_owner=$(stat -c '%u:%g' "$db")
db_mode=$(stat -c '%a' "$db")
aside="data/pre-restore-$(date -u +%Y%m%d-%H%M%SZ)"
mkdir -m 0700 "$aside"
for suffix in '' -wal -shm; do
    if [[ -e "$db$suffix" ]]; then mv -- "$db$suffix" "$aside/"; fi
done
cp -- "$backup" "$db"
chown "$db_owner" "$db"
chmod "$db_mode" "$db"
"${compose[@]}" start "${services[@]}"
systemctl start "$unit.timer"
```

## VM Setup Checklist

- [ ] VM created (Hetzner CAX11 or similar, 4GB+ RAM)
- [ ] SSH key added
- [ ] [Firewall and DNS configured](#create-the-server)
- [ ] Docker and Docker Compose installed
- [ ] Repo cloned to `/opt/yugioh-bot`
- [ ] [Production environment configured](#create-env)
- [ ] GitHub Actions secrets configured
- [ ] Push to `main` (or `workflow_dispatch`) installs `data/duel-engine` and starts services
- [ ] [Deployment verification passes](#verify)
- [ ] [Discord OAuth redirect added](#discord-oauth-redirect)
- [ ] `duel` container logs show the private server listening
