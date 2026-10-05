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
6. Caddy serves `https://<SITE_DOMAIN>` and 308-redirects `www.<SITE_DOMAIN>`
   and every plain-HTTP host (including old IP links), preserving path and query.
   Keep `caddy_data` and `caddy_config` volumes so certificates survive deploys.
   Port 4003 stays on the Docker network only — do not publish it.

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

The merge deploys with `DUEL_1V1_ENGINE=legacy` (1v1 duels run on main's old engine) and `MULTIPLAYER_TABLES` on (Tag,
3-player and 4-player tables open; `MULTIPLAYER_TABLES=0` in `.env` closes them). Both are read by a restart of the `duel` service (the flag also by `web`). They need no
empty server. See `duel-engine-switch.md` for the values, the engine saved for each duel and how to switch back.

### Report bug button (GitHub issues)

The "Report bug" button (a quiet chip at the bottom-right of the page, or in the header of a live duel) saves every report in the `bug_reports` table of `data/bot.sqlite`. The `web` service also opens
a GitHub issue for it when it has a token. The repo is public, so an issue holds only the report number, the player's
text, public duel facts and the last public log lines. It never holds a hand, a Discord id or name, or the guild id. The
full report with the player id stays in the database. Each player may send 5 reports in 10 minutes.

Set it up once:

1. In GitHub open Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
   Resource owner `imran443`, repository access "Only select repositories" with `imran443/yugioh-bot`, repository
   permission **Issues: Read and write** (the Metadata read permission is added by itself). Pick an expiry and note the date.
2. On the VM add these lines to `/opt/yugioh-bot/.env` (the token never goes in git or in a `NEXT_PUBLIC_` name):

   ```bash
   BUG_REPORT_GITHUB_TOKEN=github_pat_xxxxxxxx
   BUG_REPORT_GITHUB_REPO=imran443/yugioh-bot   # optional, this is the default
   ```

3. Recreate only the web service so it reads the new values: `docker compose -f docker-compose.yml up -d web`.

Checks and limits:

- Send one test report from the Report bug button. The dialog shows "issue #N" with a link when GitHub accepted it, and
  "Saved — the team will see it" when the token is missing or GitHub refused it.
- A failed issue never loses a report. Read the reason with
  `sqlite3 data/bot.sqlite "select id, created_at, github_error from bug_reports where github_issue_number is null order by id desc limit 10"`.
- Issues get the labels `bug`, `needs-triage` and `from-app`. If a label does not exist the issue is created without labels.
- When the token expires, create a new one and repeat steps 2 and 3. Reports sent in the gap stay in the database.
- Before it sends, the dialog calls `POST /api/bug-reports/precheck`. It reads the open issues with the label `from-app` (cached
  for 60 seconds) with the same token. With no token, or if GitHub fails, it uses the reports saved in the database that already
  have an issue. If the check itself fails or takes more than 5 seconds, the report is sent without it. A "Yes, same bug" answer
  adds a "+1" comment to the open issue instead of making a new one. The token needs only Issues: Read and write for this.
- A human reviews each `needs-triage` issue. See `docs/agents/triage-labels.md`. Create the labels `from-app`, `invalid` and
  `duplicate` in the repository once.

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
Recovery and replay use that flag, preserving each duel's historical rule.
Since 2026-10-04, new 1v1 Domain duels skip the turn-1 duelist's draw at every Master Rule
on both the pinned and legacy engines; the second duelist draws as usual.
In Tag, FFA3 and FFA4 Domain duels, every duelist draws on their first turn, including turn 1.
Standard is unchanged on both engines: MR1/MR2 draw on turn 1; MR3/MR4/MR5 skip only
the turn-1 duelist's draw. Tag and FFA use MR5 only.

Production ran `main`, which had no Tag or FFA duels and no `format` or `setup_json`
columns. Migration adds `format` with the default `'1v1'`, so every old production
row is 1v1 and the server infers its draw rule. Production needs no action.
The FFA check and repair below are for the staging database only.

Before 2026-10-02 (this change), staging ran this branch before and after `0fb46df`,
but never `d4338a2` or a later commit.
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

# Image update: run the Deploy workflow (it pins the application and bundle to one CI commit).
# Start already built images, without a rebuild:
docker compose -f docker-compose.yml up -d

# Stop all
docker compose -f docker-compose.yml down
```

## Backups

The root systemd service runs the repo's `scripts/backup/dueling-backup` to back up `/opt/yugioh-bot/data/bot.sqlite` with Python's SQLite backup API, including committed WAL writes without stopping the app or requiring the SQLite CLI. The timer runs daily at **07:30 UTC**, with up to ten minutes of random delay and catch-up after downtime. Snapshots are integrity checked, mode 0600, and paired with SHA-256 sidecars in `/var/backups/yugioh-bot` (directory mode 0700). `DUELING_BACKUP_SRC` and `DUELING_BACKUP_DIR` override the source and destination. Deploys update the script used by the service; re-copy the units if their configuration changes.

After a successful backup, the server keeps the newest N automatic `bot-YYYYmmdd-HHMMSSZ.sqlite` files by UTC filename and deletes older ones with their sidecars. `DUELING_BACKUP_KEEP` defaults to **7** and must be an integer >= 1; set it in a systemd service drop-in on the VM. Manual and other-named files are preserved. Completion lines include `kept` and `total_bytes` for retained automatic SQLite files, excluding sidecars and manual files.

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

**Workstation migration** — backups now stay on the VM. If you used the previous workstation setup, deleting the repo's pull tooling does not remove the installed script or Windows scheduled task. Run these commands in **Windows PowerShell**, as the Windows user who registered the task (use your configured task name if changed):

```powershell
$taskName = 'Dueling System backup pull'
Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
```

Confirm the task is absent in Task Scheduler and no pull is still running in WSL. Before deleting the installed script, note any `LOCAL_DIR` or `MIRROR_DIR` overrides. In the WSL distro and Linux account used by the task, remove the copied script and retained workstation backups, including sidecars and `pull.log` (adjust these paths if customized):

```bash
rm -f -- "$HOME/bin/pull-dueling-backup.sh"
rm -rf -- /home/imran/backups/dueling-system
```

Also delete retained SQLite backups and SHA-256 sidecars from any configured `MIRROR_DIR` and other workstation copies.

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
