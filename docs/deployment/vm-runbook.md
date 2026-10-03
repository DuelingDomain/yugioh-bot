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
2. GitHub Actions starts the `Deploy` workflow on `ubuntu-latest` (amd64), with a 90-minute job limit.
   The job runs only for `refs/heads/main`, including manual dispatches.
3. The workflow builds or restores the pinned duel-engine resource bundle
   (`cards.cdb`, `card-scripts/`, `strings.conf`, `ocgcore.domain.wasm`, `ocgcore.standard.wasm`, `manifest.json`, and the legacy 1v1 files `ocgcore.domain.legacy.wasm` and `card-scripts/domain.legacy.lua`)
   using `npm run duel:prepare`, `packages/duel-server/scripts/build-domain-core.ts` (Domain wasm) and `packages/duel-server/scripts/build-domain-core.ts standard` (Standard wasm: stock rules plus the shared fixes in `domain-core/src/apply-core-fixes.mjs`, `build-standard-core.sh`)
   `... build-domain-core.ts legacy-domain` (the legacy Domain wasm of main, see `packages/duel-server/legacy-1v1/README.md`)
   inside `docker.io/emscripten/emsdk:4.0.9` (digest from `packages/duel-server/domain-core/pins.json`).
   Identical pins hit the Actions cache and skip regenerate.
   The workflow also builds both multi-duelist cores, `ocgcore.multi.wasm` and `ocgcore.multi-domain.wasm`
   (Standard and Domain Tag/FFA3/FFA4), with `build-deploy-multi-cores.sh` in the pinned emsdk image.
   It applies the full patch series; Domain additionally uses `APPLY_DOMAIN=1 DOMAIN_MULTI=1`.
   Neither deploy core uses `LUA_FIXED_SEED`. A separate `duel-multi-cores-v2-<hash>` cache covers the
   pins, patches, Domain sources and build/packaging scripts, and holds both WASMs and their build metadata.
   Each build record stores the builder commit. Packaging prints `builtBy=` and `deployedBy=` separately,
   so cache hits retain the original builder while recording the current deploy checkout.
   The cores and individual checksum/provenance sidecars are added to the deploy tarball, keeping the
   cached base bundle independent. See [staging's engine build details](staging.md#engine-files-and-image-build).
4. The workflow SSHes into the VM and fetches the exact commit checked out on the runner. It also
   fetches `origin main` and checks that the deploy commit is an ancestor of `FETCH_HEAD` before preflight.
   It waits up to 15 minutes for the shared VM build lock. It runs a
   **preflight** before anything on the VM changes: the install script from that commit runs with
   `DUEL_PREFLIGHT=1` on the new bundle and installs nothing. It refuses while a duel has `status = 'active'`
   in `data/bot.sqlite` and the base bundle would be replaced (a locked or corrupt DB fails closed).
   For a new multi core under an identical base bundle, only an active Tag/FFA duel refuses. On refusal, the old
   checkout, images and containers stay as they were. The transfer tarball and preflight files use
   `mktemp` paths and are removed on refusal or any other exit.
   After the preflight the workflow resets `/opt/yugioh-bot` to the same CI commit, prepares the ignored
   `.deploy-duel-engine` named `engine` context from the tarball, tags the current duel/web/bot container
   images as `:prev`, rebuilds Compose images, stops **web**
   (ingress) only, then installs the bundle into `/opt/yugioh-bot/data/duel-engine` **before** `docker compose down`.
   The duel engine stays up during the check. Install is a no-op when `manifest.json` is identical. The install
   script checks the active duels once more (a table could start during the build, which takes minutes); on that
   second refusal or any exit after stopping web, an EXIT trap runs `docker compose start web` and
   cleans temporary files. The web recovery trap is cleared after `up -d` succeeds. It never writes `data/bot.sqlite`.
   Each multi core is installed independently (atomic renames per file, checked against its `.sha256`),
   also when `manifest.json` is identical. A changed multi core is refused while a Tag or free-for-all duel is active.
   A 1v1 duel never blocks it and never reads it. Without the multi core, a Tag, 3 or 4 player table answers 409
   with a clear message when it starts.
5. Compose starts bot, ws, duel, web, and caddy. The duel container verifies
   the volume bundle and runs `node packages/duel-server/dist/server.js`. The `duel-bundled` image carries
   the same bundle at `/opt/duel-engine`, outside the data mount, and verifies it in place during the
   image build. Production sets `DUEL_BUNDLE_SRC=${DUEL_BUNDLE_SRC_ON_START:-}` to empty by default:
   the host deploy installs the volume, and container starts only verify it (`dist/worker.js` is loaded
   by the compiled host). Set `DUEL_BUNDLE_SRC_ON_START=/opt/duel-engine` only for a deliberate fresh-volume
   installation with drained duels; normal production starts should leave it unset. Container restarts
   do not replace, re-download or recompile the bundle.
   After the duel container passes the startup check (`running restarts=0`), the workflow runs
   `docker image prune -f` to remove dangling images. The `:prev` tags retain the rollback images.
6. Caddy reverse-proxies HTTP on port 80. Port 4003 stays on the Docker
   network only — do not publish it.

Image updates should use the workflow: it transfers the pinned bundle, runs active-duel preflight,
prepares `.deploy-duel-engine` for the `duel-bundled` image target, builds and verifies the image, then
installs the volume bundle before recreating containers. It removes the temporary build context afterward.
A later bare `docker compose ... --build` has no such context and fails. Starting already built images
with `docker compose -f docker-compose.yml up -d` needs no build context. For an isolated manual build,
use the complete preparation commands in [the staging runbook](staging.md#local-verification-without-starting-services).

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

### Engine switch and multiplayer flag

The merge deploys with `DUEL_1V1_ENGINE=legacy` (1v1 duels run on main's old engine) and `MULTIPLAYER_TABLES` off (no
Tag, 3-player or 4-player tables). Both are read by a restart of the `duel` service (the flag also by `web`). They need no
empty server. See `duel-engine-switch.md` for the values, the engine saved for each duel and how to switch back.

### Rollback

Before each production build, the workflow tags the images used by the existing duel, web and bot
containers as `:prev` (normally `yugioh-bot-duel:prev`, `yugioh-bot-web:prev`, and
`yugioh-bot-bot:prev`). It uses container image IDs, so an earlier failed build cannot replace the
rollback snapshot with an unused image. These tags survive the dangling-image prune.

For a fast rollback when the installed engine bundle is compatible with the previous code, retag
those snapshots to the current image names and recreate the three services without building:

```sh
cd /opt/yugioh-bot
for service in duel web bot; do
  docker tag "yugioh-bot-$service:prev" "yugioh-bot-$service:latest"
done
docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate duel web bot
```

This restores the three image snapshots; it does not roll back the checkout, ws, database or engine
volume. Use the actual image names if the Compose project name is customized. If the engine bundle
also needs to change, drain active duels and use the workflow rollback below, which installs the
matching bundle and rebuilds every service:

1. Revert the merge commit on `main` (`git revert -m 1 <merge sha>`), and push it.
2. Make sure no duel is active (see above), or let the preflight refuse until it is true.
3. The deploy workflow builds the old bundle and installs it. The multi core file stays in the data directory and
   is not read by the old code.
4. The database is safe: the schema change only adds columns (`format` with default `'1v1'`, `snapshot_seats_json`,
   `setup_json`), so the old code runs on the new database. Replays of duels from before the bundle change stop
   working, as after every bundle change.

## First-turn draw records (2026-10-02)

New duels save the resolved boolean flag as `setup.firstTurnDraw` in `duels.setup_json`.
Recovery and replay use that flag. The pinned engine draws on turn 1 in every Domain seat layout.
The legacy 1v1 engine uses the stock Master Rule flags in Standard and Domain:
MR1/MR2 draw on turn 1; MR3/MR4/MR5 skip only the turn-1 draw.
Standard on the pinned engine uses the same Master Rule draw rule.
Standard FFA and Tag use MR5 only.

Production ran `main`, which had no Tag or FFA duels and no `format` or `setup_json`
columns. Migration adds `format` with the default `'1v1'`, so every old production
row is 1v1 and the server infers its draw rule. Production needs no action.
The FFA check and repair below are for the staging database only.

Staging ran this branch before and after `0fb46df`, but never `d4338a2` or a later commit.
Only FFA gained the new draw rule at `0fb46df`. Thus an old
Domain 1v1 or Tag record with no flag uses the stock rule: no turn-1 draw at MR3-MR5,
and a turn-1 draw at MR1/MR2. The server infers this rule in both modes. No database
backfill is needed for these records. The engine bundle and overlay pin must still match.

Only Standard and Domain FFA records with no flag are ambiguous: before `0fb46df`
they skipped the turn-1 draw; after it they drew. Let those active duels finish before
deployment. If recovery finds such an active duel, it sets the status to `interrupted`
and emits the change. Replay refuses it with the missing-rule message. The saved
final board remains available.

Before a staging deploy, run this read-only query on the staging database. Let
each active duel that it finds finish before deployment.

```sql
SELECT web_slug, guild_id, mode, format, status, created_at
FROM duels
WHERE format IN ('ffa3', 'ffa4')
  AND status = 'active'
  AND seed_json IS NOT NULL
  AND json_extract(setup_json, '$.firstTurnDraw') IS NULL;
```

To restore one staging FFA replay, first prove its start rule from deployment records. On a
database backup, check the selected row, then use the statement below on that row.
Use `json('true')` for a run after `0fb46df` that enabled the FFA draw. Use `json('false')`
for a run before that change. Do not infer this value from the creation date alone.

```sql
UPDATE duels
SET setup_json = json_set(coalesce(setup_json, '{}'), '$.firstTurnDraw', json('true'))
WHERE web_slug = '<verified-duel-slug>'
  AND guild_id = '<verified-guild-id>'
  AND format IN ('ffa3', 'ffa4')
  AND seed_json IS NOT NULL
  AND json_extract(setup_json, '$.firstTurnDraw') IS NULL;
```

Rollback: an older server ignores this key and can drop it on its next setup write.
Keep a backup of the saved flags. A later upgrade can again refuse an FFA record
whose flag was lost.

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
The workflow also prepares the temporary image build context. Start already built images with the
command below; use the workflow for rebuilds.

```bash
docker compose -f docker-compose.yml up -d
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

# Image update: run the Deploy workflow (it pins the application and bundle to one CI commit).
# Start already built images, without a rebuild:
docker compose -f docker-compose.yml up -d

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
