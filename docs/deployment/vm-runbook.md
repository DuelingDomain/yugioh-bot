# VM Deployment Runbook

This runbook covers deploying the YuGiOh bot + web app to a VM. The stack runs via Docker Compose with Caddy as a reverse proxy. GitHub Actions deploys `main` automatically on push.

## Current Repository State

- GitHub repo: `https://github.com/imran443/yugioh-bot`
- Production branch: `main`
- Deploy workflow: `.github/workflows/deploy.yml`
- VM provider: Hetzner Cloud
- VM public IP: `178.105.36.104`
- VM app path: `/opt/yugioh-bot`
- Runtime user: `root`
- Data path: `/opt/yugioh-bot/data/bot.sqlite`

## SSH Access

The deploy key lives at `~/.ssh/hetzner_deploy` on the maintainer's workstation.

```bash
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104
```

One-liners (run from your workstation, no interactive shell needed):

```bash
# Tail logs
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104 \
  'cd /opt/yugioh-bot && docker compose -f docker-compose.yml logs --tail=100'

# Inspect production .env
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104 \
  'grep -E "^(NEXTAUTH_URL|NEXT_PUBLIC_WS_URL|WEB_URL)=" /opt/yugioh-bot/.env'

# Restart a service
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104 \
  'cd /opt/yugioh-bot && docker compose -f docker-compose.yml restart bot'
```

Optional — add a `~/.ssh/config` entry so you can drop the `-i` flag:

```sshconfig
Host yugioh-bot
    HostName 178.105.36.104
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
   (`cards.cdb`, `card-scripts/`, `strings.conf`, `ocgcore.domain.wasm`, `ocgcore.standard.wasm`, `manifest.json`)
   using `npm run duel:prepare`, `packages/duel-server/scripts/build-domain-core.ts` (Domain wasm) and `packages/duel-server/scripts/build-domain-core.ts standard` (Standard wasm: stock rules plus the shared fixes in `domain-core/src/apply-core-fixes.mjs`, `build-standard-core.sh`)
   inside `docker.io/emscripten/emsdk:4.0.9` (digest from `packages/duel-server/domain-core/pins.json`).
   Identical pins hit the Actions cache and skip regenerate.
   The workflow also builds the multi-duelist core `ocgcore.multi.wasm` (Tag and 3 and 4 player tables) with
   `build-multi-core.sh` in the same emsdk image: the pinned ygopro-core plus the patch series in
   `domain-core/patches`, no `LUA_FIXED_SEED`. It has its own cache key (`duel-multi-core-v1-<hash of the patches and
   the multi build scripts>`). The core is added to the deploy tarball, not to the cached `data/duel-engine` bundle, so
   the bundle key and the standard and domain cores do not depend on it. The Domain core for 3 and 4 seats
   (`ocgcore.multi-domain.wasm`) is not built or shipped yet: the server refuses Domain at those tables.
4. The workflow SSHes into the VM and fetches `origin/main`. Then it runs a **preflight** before anything on the VM
   changes: the install script of the new commit (`git show origin/main:...`) runs with `DUEL_PREFLIGHT=1` on the new
   bundle and installs nothing. It refuses while a duel has `status = 'active'` in `data/bot.sqlite` and the bundle
   would be replaced (a locked or corrupt DB and missing columns fail closed). For a new multi core under an
   identical bundle, only an active Tag or free-for-all duel refuses. On a refuse the deploy stops there: the old
   checkout, images and containers stay as they were. The new duel image needs the new bundle, so a half-done
   deploy followed by `docker compose up` would crash-loop the duel service. That is why the check comes first.
   After the preflight the workflow resets `/opt/yugioh-bot` to `origin/main`, rebuilds Compose images, stops **web**
   (ingress) only, then installs the bundle into `/opt/yugioh-bot/data/duel-engine` **before** `docker compose down`.
   The duel engine stays up during the check. Install is a no-op when `manifest.json` is identical. The install
   script checks the active duels once more (a table could start during the build, which takes minutes); on that
   second refuse `docker compose start web` restores the old web container and the deploy exits without recreating
   duel. It never writes `data/bot.sqlite`.
   The multi core is installed on its own (one atomic rename per file, checked against `ocgcore.multi.sha256`),
   also when `manifest.json` is identical. A changed multi core is refused while a Tag or free-for-all duel is active.
   A 1v1 duel never blocks it and never reads it. Without the multi core, a Tag, 3 or 4 player table answers 409
   with a clear message when it starts.
5. Compose starts bot, ws, duel, web, and caddy. The duel container verifies
   the volume bundle and runs `node packages/duel-server/dist/server.js`
   (`dist/worker.js` is loaded by the compiled host). Container restarts do
   not re-download or recompile the bundle.
6. Caddy reverse-proxies HTTP on port 80. Port 4003 stays on the Docker
   network only — do not publish it.

Remote steps used by the workflow (bundle tarball is built on the runner first):

```bash
cd /opt/yugioh-bot && \
git fetch --all --prune && \
# preflight: install-engine-bundle.sh of origin/main with DUEL_PREFLIGHT=1; refuses while duels are active
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

### Before a deploy that changes the engine bundle

The multiplayer merge changes the Standard and Domain cores, so its first deploy replaces the bundle. Before it:

1. Count the active duels. The count must be 0:
   `sqlite3 -readonly /opt/yugioh-bot/data/bot.sqlite "select count(*) from duels where status = 'active'"`
   (or let the preflight do it: it prints the count and stops the deploy).
2. Do not start new tables until the deploy has finished. Tell the players first. A table that starts after the
   preflight is caught by the second check, but then the deploy stops after the images were built.
3. After the deploy, the duel container must be `running restarts=0` (the workflow checks this).
4. Watch memory for the first days (`docker stats --no-stream`). The duel service has `mem_limit` 1g
   (`DUEL_MEM_LIMIT`). The first game loads the card database and scripts (about 114 MB). Each game adds about 2.4 to
   4 MB.

### Rollback

1. Revert the merge commit on `main` (`git revert -m 1 <merge sha>`), and push it.
2. Make sure no duel is active (see above), or let the preflight refuse until it is true.
3. The deploy workflow builds the old bundle and installs it. The multi core file stays in the data directory and
   is not read by the old code.
4. The database is safe: the schema change only adds columns (`format` with default `'1v1'`, `snapshot_seats_json`,
   `setup_json`), so the old code runs on the new database. Replays of duels from before the bundle change stop
   working, as after every bundle change.

## VM Setup (Hetzner CAX11 or similar)

### Create the Server

1. Go to [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. Create a new project → Add server
3. Location: any
4. Image: Ubuntu 24.04
5. Type: CAX11 (ARM64, 4GB RAM, €3.79/mo)
6. Add your SSH public key
7. Firewall: allow TCP 22, 80, 443
8. Name: `yugioh-bot`
9. Create & Buy

Note the IPv4 address after creation.

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

Fill in:

```bash
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_discord_app_id
DISCORD_CLIENT_SECRET=your_discord_app_secret
DISCORD_GUILD_ID=your_guild_id
DISCORD_REMINDER_CHANNEL_ID=your_channel_id
DISCORD_DEFAULT_CHANNEL_ID=your_default_channel_id

NEXTAUTH_SECRET=  # generate with: openssl rand -base64 32
NEXTAUTH_URL=http://YOUR_VM_IP
NEXT_PUBLIC_WS_URL=http://YOUR_VM_IP

WS_INTERNAL_SECRET=  # openssl rand -hex 32; same on web, bot, duel, ws
BOT_ANNOUNCE_SECRET=  # openssl rand -hex 32
DUEL_INTERNAL_SECRET=  # openssl rand -hex 32; same on web and duel

DATABASE_PATH=./data/bot.sqlite
REMINDER_CRON=0 10 * * *
REMINDER_TIMEZONE=America/New_York
```

Do not publish host port 4003. Compose already keeps the duel engine on the internal network.

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

Open `http://YOUR_VM_IP` in a browser.

### Discord OAuth Redirect

In the [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects, add:

```
http://YOUR_VM_IP/api/auth/callback/discord
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

## Adding HTTPS with a Domain

1. Point your domain's A record to the VM IP.
2. Edit `Caddyfile` — replace `:80` with `yourdomain.com`.
3. Update `.env` on the VM:
   ```
   NEXTAUTH_URL=https://yourdomain.com
   NEXT_PUBLIC_WS_URL=https://yourdomain.com
   ```
4. Update Discord redirect URI to `https://yourdomain.com/api/auth/callback/discord`.
5. Open port 443 in the firewall:
   ```bash
   ufw allow 443/tcp
   ```
6. Restart: `docker compose -f docker-compose.yml up -d` — Caddy provisions HTTPS via Let's Encrypt automatically.

## VM Setup Checklist

- [ ] VM created (Hetzner CAX11 or similar, 4GB+ RAM)
- [ ] SSH key added
- [ ] Firewall allows TCP 22, 80, 443 (not 4003)
- [ ] Docker and Docker Compose installed
- [ ] Repo cloned to `/opt/yugioh-bot`
- [ ] `.env` created with all values including `DUEL_INTERNAL_SECRET` and `WS_INTERNAL_SECRET`
- [ ] GitHub Actions secrets configured
- [ ] Push to `main` (or `workflow_dispatch`) installs `data/duel-engine` and starts services
- [ ] `http://YOUR_VM_IP` loads in browser
- [ ] Discord OAuth redirect added
- [ ] `duel` container logs show the private server listening; no public 4003
