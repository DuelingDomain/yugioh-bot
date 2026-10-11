# VM Deployment Runbook

This runbook covers deploying Dueling Domain web/WS/duel/worker to a VM. The stack runs via Docker Compose with Caddy as a reverse proxy. After owner setup and `STAGING_AUTO_DEPLOY=1`, a push to `main` can deploy staging. The owner runs the manual **Deploy** workflow for production in downtime.

## Current Repository State

- GitHub repo: `https://github.com/DuelingDomain/yugioh-bot`
- Production branch: `main`
- Deploy workflow: `.github/workflows/deploy.yml`
- VM provider: Hetzner Cloud
- VM public IP: `178.105.36.104`; pre-cutover hostname: `duelistskingdom.com`; PR 2 app host: `app.duelingdomain.com` (activate only during the coordinated cutover)
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
  'grep -E "^(SITE_DOMAIN|WEB_URL)=" /opt/yugioh-bot/.env'

# Restart a service
ssh -i ~/.ssh/hetzner_deploy root@YOUR_VM_IP \
  'cd /opt/yugioh-bot && docker compose -f docker-compose.yml restart web'
```

Optional — add a `~/.ssh/config` entry so you can drop the `-i` flag:

```sshconfig
Host yugioh-bot
    HostName YOUR_VM_IP
    User root
    IdentityFile ~/.ssh/hetzner_deploy
```

Then `ssh yugioh-bot` works.

Deploy jobs run in the `production` / `staging` GitHub Environments and require these GitHub Actions secrets:

- `VM_HOST`
- `VM_USER`
- `VM_SSH_PRIVATE_KEY`
- `VM_SSH_KNOWN_HOSTS` (pinned VM host keys in OpenSSH known_hosts format)
- `VM_PORT` (optional, defaults to 22)

## Deployment Pipeline

1. Complete [staging setup and tests](staging.md#one-time-steps-for-the-owner), then set repository variable `STAGING_AUTO_DEPLOY=1`.
   Merge code to `main`. **Deploy Staging** can build and start the separate staging stack on the VM.
   It skips for live production duels, openings or active drafts, a failed activity guard, low memory/disk or a busy build lock.
   Open tournament rounds and series alone do not block staging. Manual dispatch can skip only the activity guard.
2. Test the deployed staging SHA. In downtime, open Actions → **Deploy** → Run workflow.
   Use workflow from `main`, set `ref` to the tested SHA (default `main`), and leave `force=false`, `rollback=false`.
   Prod has no push trigger. The prod job runs only with the workflow on `refs/heads/main`, on
   `ubuntu-latest` (amd64), with a 90-minute limit. The target ref must resolve to a commit on `main`.
   Right after target checkout, the runner runs `git fetch origin main && git merge-base --is-ancestor HEAD FETCH_HEAD`.
   This check runs before `npm rebuild`, `duel:prepare`, `tsx` or other code from that ref.
   `VM_SSH_PRIVATE_KEY` is in the Configure SSH key step only. This placement does not isolate the key from code that ran earlier.
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
   The VM also requires `git merge-base --is-ancestor HEAD "$DEPLOY_COMMIT"` before any checkout or image change.
   An older or diverged target is refused unless the owner explicitly sets `rollback=true`. The target must still be on main.
   Rollback does not restore the matching database or env; use the restore procedure when those are needed.
   It waits only 15 minutes for the shared VM build lock; missing `flock` fails closed. A cold staging build can take longer.
   If prod reaches the lock timeout, let staging finish, then run Deploy again.
   Before checkout changes, backups or stopping staging, it runs `scripts/deployment/check-prod-activity.py`
   from the workflow revision against the VM's `data/bot.sqlite`. It opens SQLite with `mode=ro` and `query_only=on`.
   One snapshot counts active duels and lobby duels with RPS/dice openings, active drafts, open/pending-approval rounds in active tournaments,
   and active/between-game series. Committed WAL writes are included. Missing, locked, corrupt or incomplete
   DBs refuse the deploy. Any active count refuses unless `force=true` was explicitly set.
   Force skips only this new guard; it never disables the engine preflight, lock or backups.
   It then runs the existing **preflight** before anything on the VM changes: the install script from that commit runs with
   `DUEL_PREFLIGHT=1` on the new bundle and installs nothing. It refuses while a duel has `status = 'active'`
   in `data/bot.sqlite` and the base bundle would be replaced (a locked or corrupt DB fails closed).
   For a new multi core under an identical base bundle, only an active Tag/FFA duel refuses. On refusal, the old
   checkout, images and containers stay as they were. The transfer tarball and preflight files use
   `mktemp` paths and are removed on refusal or any other exit.
   After preflight, the workflow saves matching checkout/deploy commits, actual container image IDs
   for duel/web/bot/WS/worker, protected env and a WAL-safe online backup under
   `/var/backups/yugioh-bot/pr2-<UTC timestamp>` (directory 0700, env 0600). It tags those image IDs
   as `:prev` before resetting the checkout or rebuilding, then prepares the ignored `.deploy-duel-engine`
   context and builds web/WS/duel/worker images. The repository variable
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` supplies the production public key as a build arg;
   the secret is read only by web at runtime from the protected VM `.env`.
   Compose fixes `DISCORD_BOT_ENABLED=0` for web and worker. The old bot image is recorded only for rollback;
   any previous bot container is stopped by its project/service labels before migration.
   After the image build, it checks gameplay again immediately before any prod service stop.
   A refusal there leaves prod containers running, but the checkout/images may already be updated and staging stopped.
   The job prints: **Do not run compose up. Run Deploy again.** Wait for downtime, then run the full workflow again.
   This is a snapshot guard, not an admission lock: the owner must prevent new games during the downtime window.
   It stops web/duel/worker and WS, captures a final drained backup, installs the engine bundle,
   and runs one migration with the new worker image before starting consumers. FK and integrity
   failures abort. A failed drained backup starts the existing web/duel/worker/WS containers and
   exits with status 1. HUP and TERM during this step also start these containers before exit.
   The retired bot stays stopped. Once engine installation or schema work begins, failure leaves
   traffic stopped and backups intact. Never restart old binaries against the migrated schema.
   The install script rechecks active duels: a table may have started during the build. Drain those
   games under the existing procedure before retrying; engine data is never replaced before preflight.
   Bundle rollback does not reverse completed passcode migrations. Saved decks/cubes may already use official
   codes absent from the older bundle: retain a bundle containing all remap targets or use a matched DB
   backup with intervening writes reconciled under the restore procedure below; do not reverse remaps blindly.
   Each multi core is installed independently (atomic renames per file, checked against its `.sha256`),
   also when `manifest.json` is identical. A changed multi core is refused while a Tag or free-for-all duel is active.
   A 1v1 duel never blocks it and never reads it. Without the multi core, a Tag, 3 or 4 player table answers 409
   with a clear message when it starts.
5. Compose removes orphan services (including the old bot), starts WS, duel, web and exactly one worker, then recreates Caddy. The duel container verifies
   the volume bundle and runs `node packages/duel-server/dist/server.js`. The `duel-bundled` image carries
   the same bundle at `/opt/duel-engine`, outside the data mount, and verifies it in place during the
   image build. Production sets `DUEL_BUNDLE_SRC=${DUEL_BUNDLE_SRC_ON_START:-}` to empty by default:
   the host deploy installs the volume, and container starts only verify it (`dist/worker.js` is loaded
   by the compiled host). Set `DUEL_BUNDLE_SRC_ON_START=/opt/duel-engine` only for a deliberate fresh-volume
   installation with drained duels; normal production starts should leave it unset. Container restarts
   do not replace, re-download or recompile the bundle.
   After the duel startup check (`running restarts=0`), WS/worker health checks (`running 0 healthy`),
   and anonymous web auth checks (`/sign-in` 200 and `/api/auth/session` 200 with `null`), the workflow runs
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

Compose defaults Standard 1v1 to `DUEL_STANDARD_1V1_ENGINE=pinned`, with no production `.env` edit.
Domain keeps `DUEL_1V1_ENGINE=legacy`. To roll back Standard, set `DUEL_STANDARD_1V1_ENGINE=legacy` in `.env`, then run
`docker compose -f docker-compose.yml up -d --force-recreate duel`. An empty or missing Standard value means `pinned`
in Compose. A Compose `restart` does not apply changed environment values. Each game of a series reads the switch
at its start; active games keep their saved engine.

`MULTIPLAYER_TABLES` is on (Tag, 3-player and 4-player tables open); `MULTIPLAYER_TABLES=0` in `.env` closes new multi
tables after `duel` and `web` are recreated. Switch changes need no empty server. See `duel-engine-switch.md` for the
values, the engine saved for each game and bundle rebuild checks.

### Report bug button (GitHub issues)

The "Report bug" button (a quiet chip at the bottom-right of the page, or in the header of a live duel) saves every report in the `bug_reports` table of `data/bot.sqlite`. The `web` service also opens
a GitHub issue for it when it has a token. The repo is public, so an issue holds only the report number, the player's
text, public duel facts and the last public log lines. It never holds a hand, a Discord id or name, or the guild id. The
full report with the player id stays in the database. Each player may send 5 reports in 10 minutes.

Set it up once:

1. In GitHub open Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
   Resource owner `DuelingDomain`, repository access "Only select repositories" with `DuelingDomain/yugioh-bot`, repository
   permission **Issues: Read and write** (the Metadata read permission is added by itself). Pick an expiry and note the date.
   The organization must allow fine-grained PATs and approve the token if its policy requires approval. After a repository
   transfer, re-issue a token previously scoped to the personal resource owner: it cannot write to the organization's repo.
   See [GitHub's token setup instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
2. On the VM add these lines to `/opt/yugioh-bot/.env` (the token never goes in git or in a `NEXT_PUBLIC_` name):

   ```bash
   BUG_REPORT_GITHUB_TOKEN=github_pat_xxxxxxxx
   BUG_REPORT_GITHUB_REPO=DuelingDomain/yugioh-bot   # optional, this is the default
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

### PR 2 cutover and owner CLI

Before cutover, record the PR 1-compatible commit, actual image IDs (including its bot), protected env and WAL-safe DB backup. Keep its NextAuth/Discord settings only in that protected rollback release. Production Clerk must use the final app origin, exact DNS/email records and Discord callback from its dashboard. Finish approved marketing privacy/terms disclosures before enabling imports or combined waitlist writes. Rehearse import/linking on a copy with dev keys; never copy those Clerk IDs back to production. Domain/DNS order belongs in `domains.md` after the marketing branch merges.

Owner tools are compiled into the worker image; no `tsx` or host scripts are required. Dry-run is default, `--apply` writes, and `--report <path>` chooses a private 0600 report (default `/app/data/ops-reports/<command>-<utc>.json`). Reports contain counts/IDs and omit emails/secrets. The worker Compose environment includes community ID but no Clerk secret.

```bash
# Read-only season state; start/end need --apply to write.
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js season status
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js season start --name 'Community season' --actor 123
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js season start --name 'Community season' --actor 123 --apply
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js season end --apply

# Export the correct instance secret securely in this shell first; -e forwards it only to this run.
# Plain dry-runs make no remote writes; reconcile is offline unless --check-remote is supplied.
docker compose -f docker-compose.yml run --rm --no-deps -e CLERK_SECRET_KEY worker node packages/worker/dist/ops/cli.js clerk-precreate-users
docker compose -f docker-compose.yml run --rm --no-deps -e CLERK_SECRET_KEY worker node packages/worker/dist/ops/cli.js clerk-precreate-users --apply
docker compose -f docker-compose.yml run --rm --no-deps -e CLERK_SECRET_KEY worker node packages/worker/dist/ops/cli.js clerk-reconcile-waitlist --check-remote
docker compose -f docker-compose.yml run --rm --no-deps -e CLERK_SECRET_KEY worker node packages/worker/dist/ops/cli.js clerk-reconcile-waitlist --apply --notify
unset CLERK_SECRET_KEY

# Review identities/history counts first; replace these example users.id values.
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js merge-users --source 123 --target 456
# Revoke the source account's Clerk sessions first. Drain active work and stop ALL writers and WS.
docker compose -f docker-compose.yml stop web duel worker ws
# Stop any separately run shelved bot too; take a final backup before apply.
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js merge-users --source 123 --target 456 --apply
# Review the report/FK result before starting traffic again.
docker compose -f docker-compose.yml up -d ws duel web worker caddy
```

`--actor` must identify an existing `users.id`. Precreate selects verified-email Discord users without a Clerk ID, persists each success for resume, skips duplicate local emails, and never binds an existing account by email alone. Only precreate accepts `--skip-legal-checks`, for an owner-approved legacy import. Reconcile respects pending/invited/revoked/rejected entries and existing users; `--no-notify` suppresses notifications. Verify invitation delivery and locked email/username/consent flows before announcing the new URL.

Merge refuses two Clerk IDs or two Discord IDs; resolve the conflict in Clerk first. It moves ownership/history in one transaction, checks foreign keys and rolls back constraint conflicts. Read the report's manual-review references in `config_json.themeAssignments` and `tournament_matches.metadata_json.winnerId`; those embedded IDs are not rewritten.

### PR 2 rollback

Stop web/duel/worker and WS (and any separately run bot). Preserve the current DB/WAL/SHM and Clerk mappings/new activity. Restore the recorded **PR 1-compatible** checkout/images/env/origin, with its explicit bot service and `DISCORD_BOT_ENABLED=1`, then start exactly one worker with the PR 1 bot that has no migrated timers. NextAuth cannot sign in email-only users; keep their rows/history and Clerk accounts for forward recovery. Never replace new activity with a stale backup for a PR 2 auth rollback. Coordinate cached domain redirects. A pre-PR1 rollback requires the separate matched DB restore below.

Code before per-host draft/tournament names recreates guild-wide current-name indexes at startup. If two hosts now have current entries with the same name, index creation fails and every service crash-loops. Check the current DB read-only before starting older code:

```sh
sqlite3 -readonly /opt/yugioh-bot/data/bot.sqlite "select guild_id, name, count(*) from drafts where status in ('pending','active') group by guild_id, name having count(*) > 1"
sqlite3 -readonly /opt/yugioh-bot/data/bot.sqlite "select guild_id, name, count(*) from tournaments where status in ('pending','active') group by guild_id, name having count(*) > 1"
```

Resolve these duplicates, or restore the matched DB backup using the restore procedure below, before starting older code; preserve new activity for reconciliation.

Check the [backup retention policy](#backups) before choosing a release. Only the newest **3 copies per deploy kind** are kept by default, so frequent deploys can remove a restore point before 14 days. The daily timer enforces the **14-day age cap** even without new deploys. The last verified copy of each kind remains until a replacement exists, including its matching release metadata; it can exceed the age cap. Other expired release directories are deleted, except the newest release's small rollback metadata. Metadata alone is not a database restore point. Check database and code compatibility before rollback.

An older checkout can have a backup script that ignores `.sqlite.gz` and `.sqlite.zst` daily copies. Its deploy pruning can also remove the last verified copy, and it can lack `dueling-restore`. Before a code rollback, pause the daily timer, wait for an active backup to finish, and save the current tools outside the checkout:

```bash
sudo systemctl stop dueling-backup.timer
# If this shows an active backup, wait for it to finish before continuing.
sudo systemctl status dueling-backup.service --no-pager
sudo install -d -m 0700 /usr/local/lib/dueling-backup
sudo install -m 0700 /opt/yugioh-bot/scripts/backup/dueling-backup \
  /opt/yugioh-bot/scripts/backup/dueling-restore /usr/local/lib/dueling-backup/
```

While the old checkout is installed, keep its daily timer paused. Use the saved tools for manual backups, cleanup of compressed copies, and restore. Run this backup from a root shell; it reads the same settings as deploys and applies count/age retention to raw and compressed copies:

```bash
(
  set -euo pipefail
  set -a
  if [[ -f /etc/default/dueling-backup ]]; then source /etc/default/dueling-backup; fi
  set +a
  python3 /usr/local/lib/dueling-backup/dueling-backup
)
```

A successful run removes excess or expired compressed copies and their sidecars while it keeps the last verified copy of each kind. The old script cannot do this cleanup. Follow the restore block below with `tools=/usr/local/lib/dueling-backup` to restore from an old checkout; use the saved backup command above for its safety backup. Keep zstd installed for `.zst` sources. After returning to current code, re-install the units and resume the timer.

### PR 1 migration rollback (historical)

Before PR 1, obtain a WAL-safe backup using `scripts/backup/dueling-backup`, save matching commit/image IDs/env, and rehearse migration on an owner-provided copy. Drain active games under the existing engine procedure. Build all images, stop web/bot/duel/worker and WS, capture the final drained backup, migrate once using the new worker image, and verify counts, ownership mappings, unchanged player/gameplay IDs, foreign keys and integrity before accepting traffic. Start WS/duel/web, the updated bot with literal `DISCORD_BOT_ENABLED=1`, and one worker. Check worker/WS health, unattended deadlines, Discord commands/status/completion, reconnecting draft sockets and existing NextAuth sessions. The owner then asks members to sign in for verified-email capture; retain NextAuth credentials.

Old binaries cannot read the integer-owner schema. If rollback is needed, stop every writer and WS first. Preserve the current DB/WAL/SHM and record intervening writes for reconciliation. Restore the pre-PR1 drained backup and its matching code, images and env using the existing checksum/integrity/ownership-preserving restore procedure below, then start the old service set without the worker. Never start the old bot on the new schema, and never run old bot timers alongside the worker. If a matched restore is unavailable, keep writers stopped and fix forward. Image retagging alone is not a PR 1 rollback. Keep the matching engine bundle for replay compatibility; follow the existing engine drain/install procedure if it must change.

The protected release directory records exact image IDs; `:prev` tags are convenience references that a later release may replace. Use the recorded IDs and matching checkout/env for recovery. Do not run the deployment workflow with old code against the new schema as a rollback shortcut.

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
git clone https://github.com/DuelingDomain/yugioh-bot.git
cd yugioh-bot
```

### Create `.env`

```bash
cp .env.example .env
nano .env
```

Fill in (Compose expands `${SITE_DOMAIN}` in unquoted URL values):

```bash
SITE_DOMAIN=app.duelingdomain.com
MARKETING_DOMAIN=duelingdomain.com
LEGACY_DOMAIN=duelistskingdom.com
WEB_URL=https://${SITE_DOMAIN}
MARKETING_URL=https://duelingdomain.com
DISCORD_GUILD_ID=your_community_id
DISCORD_BOT_ENABLED=0
THEME_DRAFTS=0
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # production key, also set as the repository variable
CLERK_SECRET_KEY=  # production web runtime only; never a build arg
WS_INTERNAL_SECRET=  # openssl rand -hex 32; web/duel/worker/ws share it
DUEL_INTERNAL_SECRET=  # openssl rand -hex 32; web/duel share it
DATABASE_PATH=/app/data/bot.sqlite
CARD_IMAGE_CACHE_DIR=/app/data/card-images
CARD_IMAGE_CACHE_MAX_BYTES=16106127360
SETS_SYNC_CRON=0 6 * * *
SETS_SYNC_TIMEZONE=UTC
IMAGE_CLEANUP_CRON=0 4 * * *
IMAGE_CLEANUP_TIMEZONE=UTC
```

| Environment variable | Default | Behavior |
| --- | --- | --- |
| `THEME_DRAFTS` | `0` for production web | Only `1`, `true` and `on` permit new theme drafts. The code default is off in every build. |
| `STAGING_THEME_DRAFTS` | `1` for staging web | Sets web's `THEME_DRAFTS` in staging Compose. Use `0` to close new theme drafts there. |

The owner keeps new production theme drafts closed for the alpha testers. Existing theme lobbies
and active games can finish when the flag is off. Summary and deck export remain available.
`GET /api/drafts` and `GET /api/cubes` return `themeDraftsEnabled` for browser create flows.

Protect `.env` as 0600. Web has an explicit environment list; no `NEXTAUTH_*`, obsolete `AUTH_*`, Discord bot token, bot announce vars or E2E gate are forwarded. Web receives `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` at runtime for existing-player recovery; retain the original Discord OAuth application's credentials in the protected runtime configuration. The Clerk secret is runtime-only and only web receives it; owner CLI runs use explicit `-e CLERK_SECRET_KEY`. Dev keys never reach staging/production. Staging uses a separate instance and source. `WEB_URL` is required; missing it fails Compose config instead of changing WS CORS to localhost.

After runtime edits, recreate affected containers with `docker compose -f docker-compose.yml up -d`; `restart` does not reload `.env`. Changing the public key requires a web rebuild through the Deploy workflow. Preserve protected PR 1 credentials/env for the rollback window; current Compose has no bot service. Worker timers keep running without Discord delivery.

The ARM VM does not compile Domain wasm. First production start must use the manual **Deploy** workflow so GitHub Actions can install `/opt/yugioh-bot/data/duel-engine`.
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

After deploy, run `scripts/smoke-test-site.sh <SITE_DOMAIN> <VM IP>` from the repo on your workstation to check certificates, redirects, Socket.IO, the sign-in page (200), and anonymous session (200 `null`).

Manually open `https://<SITE_DOMAIN>` in a browser, exercise email/password and Discord sign-in, invitation ticket + Discord with locked email/required username/consent, email code/resend and password reset. Confirm history recovery, account refresh, channel-free drafts/decks/duels, WS updates, worker deadlines and published legal links; the smoke script cannot verify these checks.

### Clerk configuration

Configure production Clerk for `https://app.duelingdomain.com`: waitlist sign-up mode; email/password with email code verification; required username and legal consent; Discord OAuth; passwordless/passkeys/phone off; 30-day maximum session lifetime with no shorter inactivity timeout; bot protection and invitation/waitlist email templates. Consent URLs are `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`. Contact is `support@duelingdomain.com`. Apply the exact Clerk dashboard DNS/email records and verify them; do not invent record values. Register the Clerk-provided Discord callback in the Discord app; the app continuation is `/sso-callback`. Keep previous settings for rollback. Owner approval is required before production cutover.

Existing-player recovery also uses the original application's registered `${WEB_URL}/api/auth/callback/discord` URI, alongside Clerk's callback. Keep that exact HTTPS URI registered; if the domain cutover left only the legacy hostname's callback, add the current `WEB_URL` URI before deploying. Forward `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` to web through the explicit Compose entries, then recreate web so it receives them. No new cookie secret is needed; recovery derives its authenticated-encryption key from `CLERK_SECRET_KEY`. Do not print runtime configuration or credentials when checking this.

Recovery bypasses the waitlist only for a server-proven Discord ID already in `users`; an unlinked row also needs a verified Discord email. An unlinked row gets a one-step `/welcome-back` consent page; no `players` row is required. An email already owned by another Clerk user is a support conflict, never automatic login by email. Clerk private metadata retains the proven Discord ID during initial profile sync. If Clerk's Discord sign-in still transfers into restricted signup after linking, direct OAuth proof issues a sign-in ticket for the stored Clerk ID after checking that Clerk's user exists, is neither banned nor locked, and has no conflicting Discord claim; a missing claim is recorded in private metadata before issuing the ticket. Sync clears that bootstrap metadata best-effort when a matching verified external Discord account appears, so removing that account then clears both application Discord links on the next sync. If no sync observes the matching verified external account before removal, or metadata cleanup keeps failing, the owner must clear `existingPlayerDiscordId` and the application Discord mapping to revoke recovery. Tickets expire in 120 seconds and travel through an encrypted HttpOnly cookie and same-origin POST, never a redirect URL. Verify recovery, preserved history and a second Discord sign-in in a browser before announcing the fix. Keep web private behind Caddy; recovery's bounded per-process limiter relies on Caddy overwriting incoming `X-Forwarded-For`.

## GitHub Actions Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions, and add:

| Secret | Value |
|--------|-------|
| `VM_HOST` | Your VM's public IP |
| `VM_USER` | `root` |
| `VM_SSH_PRIVATE_KEY` | Full contents of your SSH private key |
| `VM_PORT` | `22` |

Also set repository **variable** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the production `pk_live_...` value. The runtime `CLERK_SECRET_KEY` stays on the VM. Complete staging's [one-time setup and tests](staging.md#one-time-steps-for-the-owner), then set repository variable `STAGING_AUTO_DEPLOY=1` to enable staging push deploys. Production deploys are manual.

## Staging First, Manual Production

`.github/workflows/deploy-staging.yml` runs on pushes to `main` only with `STAGING_AUTO_DEPLOY=1`, and on manual dispatch from `main`.
`.github/workflows/deploy.yml` runs only on manual dispatch from `main`. Both use the shared VM build lock.

The SSH key step does not protect the production key from staging ref code that runs before it. That code can use
`GITHUB_ENV`, `GITHUB_PATH` or `RUNNER_TEMP` to reach the key in a later step. For a real control, put the production key
in a GitHub environment with a required reviewer. This is an owner choice for later; it is not configured by these changes.

Normal flow:

1. Work on a branch.
2. Open a pull request.
3. Merge into `main`.
4. After auto deploy is enabled, GitHub Actions deploys staging, or skips for prod activity, guard failure, or resource limits.
5. Test staging and record its deployed SHA. A green run can mean a skip; check warnings, the step summary and the site.
6. During downtime, the owner runs **Deploy** from `main`, with the tested SHA as `ref`, `force=false`, `rollback=false`.

For a manual staging test of a branch or SHA, dispatch **Deploy Staging** from `main`, set that target as `ref`, and use
`action=deploy`, `refresh_db=false`, `ignore_prod_activity=false`. Set `ignore_prod_activity=true` to build during production play.
This input skips only the activity guard. It keeps the shared lock and all resource checks. Push deploys cannot enable it.
Staging checks only live duels, openings and active drafts, before clone, fetch or checkout reset.
Production keeps its full activity guard, including open tournament rounds and active/between-game series.
Prod stops staging before its build; staging stays down until its workflow runs again.
Prod waits only 15 minutes for the lock. A cold staging build can take longer and cause a prod lock timeout.

Local safety checks (no VM access):

```bash
python3 -B -m unittest discover -s scripts/deployment -p test_deploy_safety.py -v
node --test scripts/ci/deploy-flow.test.mjs
npx vitest run scripts/staging/deploy.test.ts
npx --yes @action-validator/cli@0.6.0 .github/workflows/deploy.yml
npx --yes @action-validator/cli@0.6.0 .github/workflows/deploy-staging.yml
npx --yes @action-validator/cli@0.6.0 .github/workflows/test.yml
sh -n scripts/staging/remote-deploy.sh
```

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
docker compose -f docker-compose.yml restart web

# Image update: run the Deploy workflow (it pins the application and bundle to one CI commit).
# Start already built images, without a rebuild:
docker compose -f docker-compose.yml up -d

# Stop all
docker compose -f docker-compose.yml down
```

## Backups

The root systemd service runs `scripts/backup/dueling-backup` to back up `/opt/yugioh-bot/data/bot.sqlite`. Python's SQLite backup API takes a consistent snapshot of committed WAL writes without stopping the app or requiring the SQLite CLI. The script then compresses the closed snapshot with **zstd** if the host has it, or **gzip** otherwise. The documented Ubuntu VM setup installs Docker and Git; it does not install zstd. Gzip uses Python's standard library. Zstd uses one thread at level 3 to limit memory use on the 4 GB ARM VM. No package install is required for gzip; `apt install -y zstd` is optional. Keep zstd available to restore any `.zst` copies.

The script decompresses the archive to a temporary SQLite file, runs `PRAGMA integrity_check`, and deletes the temporary file. Only a verified archive and its SHA-256 sidecar are published, with atomic renames. The checksum covers the compressed bytes. Snapshots and sidecars have mode 0600; the backup root has mode 0700. Failure removes the script's temporary files. A lock on the backup root prevents daily and deploy runs from pruning each other's in-progress copies.

The timer runs daily at **07:30 UTC**, with up to ten minutes of random delay and catch-up after downtime. The layout is:

```text
/var/backups/yugioh-bot/
  bot-YYYYmmdd-HHMMSSZ.sqlite.gz          # Daily copy; .zst when zstd is installed
  bot-YYYYmmdd-HHMMSSZ.sqlite.gz.sha256
  pr2-YYYYmmdd-HHMMSSZ/
    checkout-commit, deploy-commit, images.jsonl, runtime.env
    online/bot-YYYYmmdd-HHMMSSZ.sqlite.gz
    online/bot-YYYYmmdd-HHMMSSZ.sqlite.gz.sha256
    drained/bot-YYYYmmdd-HHMMSSZ.sqlite.gz
    drained/bot-YYYYmmdd-HHMMSSZ.sqlite.gz.sha256
```

Old `.sqlite` files remain valid restore sources and count toward the same limits. Deployment copies use the backup script saved from the workflow revision, including on first rollout and code rollback. Old copies are not recompressed in place; retention replaces them with new compressed copies over time. `DUELING_BACKUP_SRC` and `DUELING_BACKUP_DIR` override the source and destination. Deploys update the checkout script used by the daily service; re-copy the units if their configuration changes.

After a successful backup, keep **7 daily copies** by default. Set `DUELING_BACKUP_KEEP` to an integer >= 1 to change this count. Keep **3 deploy copies per kind** across all release directories by default; set `DUELING_DEPLOY_BACKUP_KEEP` to an integer >= 1 to change this count. Online and drained copies have separate limits, so an incomplete deploy does not displace a drained restore point. Daily and online deploy runs prune the parent root. A drained run does not prune or check the online copy again; the next daily or online run applies retention. If no copy of a kind would be removed, retention does not verify that kind again. Completion lines include `kept` and `total_bytes`, excluding sidecars and manual files; a drained line reports only the copy just made.

Keep the **14-day age cap** for automatic copies. The daily timer applies expiry at 13 days to allow for its next run. Deploy age comes from the release directory's UTC name; daily age comes from the snapshot's UTC name. Filesystem mtime does not control retention. `DUELING_RELEASE_KEEP_DAYS` can shorten the deploy database window to an integer from 1 to 14; invalid values warn and use 14. Count limits can remove copies sooner. **Never delete the last verified copy of a kind:** keep the newest copy that passes its checksum and SQLite checks, even if it exceeds the age cap. Keep its release metadata too. A fresh verified replacement permits expiry of the old copy. If no copy can be verified, pruning leaves that kind untouched and logs warnings.

Whole expired release directories are deleted unless they hold a retained copy or are the newest release overall. The newest release keeps its small `checkout-commit`, `deploy-commit`, `images.jsonl` and `runtime.env` metadata for code rollback. `runtime.env` contains secrets; do not publish or print it. Expired extra SQLite copies within managed release directories are also removed. Only exact `pr2-YYYYmmdd-HHMMSSZ` names with valid timestamps are managed.

Before making a snapshot, require free space of **1 GiB plus 3 times the source DB and WAL sizes**. Set `DUELING_BACKUP_MIN_FREE_BYTES` to a nonnegative integer to change the reserve. If free space is lower, log `SKIPPED: dueling-backup: insufficient free space` with required and available bytes, create no snapshot, and return status 1. Use `python3 scripts/backup/dueling-backup --check-space` for a read-only space check: it takes no backup lock, creates no directory, and deletes no file. If the destination does not exist, it checks its nearest existing ancestor's filesystem. Deployment checks space again after the build and before stopping any production service. `--before-backup <command> [args...]` holds the backup lock, checks space, runs the service stop command, then makes the drained snapshot without a second lock or space check. A lock timeout or low-space skip leaves production running. If the drained snapshot fails after the stop, the deploy starts the existing `web duel worker ws` containers and exits with status 1, before engine installation or schema work. Skipped or failed backups do not prune old restore points to make space; check disk use and resolve the cause first.

Daily runs wait up to **1800 seconds** if another backup holds the root lock. Online deploy runs default to **900 seconds**. Set `DUELING_BACKUP_LOCK_WAIT_SECONDS` to a nonnegative integer to change these limits; zero fails immediately. The deploy overrides this setting to **300 seconds** for the drained run, reducing the final wait within the 90-minute job budget. All lock waiting occurs before service shutdown. The lock covers the drained preflight, service stop command, and snapshot. Deployment checks active gameplay again after the lock wait and before either service stop command. SIGTERM and SIGHUP run temporary-file cleanup. While holding the lock, each snapshot run removes managed `.dueling-{backup,compressed,verify,sha256}-*.tmp` files and their journals older than six hours, plus old orphan automatic sidecars. The sweep covers the root and managed release `online`/`drained` directories and never follows symlinks. A sweep error logs `WARNING: dueling-backup: stale cleanup:` and the backup continues; inspect the warning and correct the cleanup failure.

Pruning stays inside the backup root and refuses symlinks. Release-pruning failures log `WARNING: dueling-backup: release pruning:` without failing a verified backup. Fix affected paths, codecs or permissions so retention can run. An inactive timer or failed backup delays expiry. Review skipped backups and warnings in the service journal.

### Backup disk budget and checks

Let `B` be the raw database size and `r` be the measured compressed/raw size ratio. The previous backup estimate was about `16B`. The new default limit is `7 + 3 + 3 = 13` copies, or about **`13rB`** after old raw copies expire. Estimated saving is **`100 × (1 - 13r/16)%`**. This estimate assumes similar snapshot sizes and excludes manual copies, sidecars, release metadata and temporary files.

| Compressed/raw ratio | Backup use for a 1 GiB DB | Saving from 16 GiB |
| --- | --- | --- |
| 1.0 | 13 GiB | 18.8% |
| 0.5 | 6.5 GiB | 59.4% |
| 0.3 | 3.9 GiB | 75.6% |

These ratios are examples, not measurements of production data. Measure a new copy and the raw DB before making a capacity plan. The VM disk is thought to be about 40 GB; confirm its actual size. Production and staging share it. Add the live DB, WAL files, staging's working DB and its one `bot.sqlite.before-copy`, Docker images/cache, engine data, logs, and the snapshot/verification headroom. Compression does not reduce the live DB or staging's working copies.

Check after each deploy and at least weekly:

```bash
df -h /opt /var/backups/yugioh-bot
du -sh /var/backups/yugioh-bot /opt/yugioh-bot/data \
  /opt/yugioh-bot-staging/data-staging /var/lib/docker
systemctl list-timers dueling-backup.timer
journalctl -u dueling-backup.service --no-pager -n 30
# Check CPU cgroups and the disk scheduler on the VM.
cat /sys/fs/cgroup/system.slice/cgroup.subtree_control
cat /sys/block/*/queue/scheduler
systemctl show dueling-backup.service -p CPUWeight -p IOWeight
```

On cgroup v2, a listed `cpu` controller means cgroup weights control CPU share between the service and Docker containers. Confirm `CPUWeight=20` (the usual default is 100). Keep `Nice=10` too. The service sets `IOWeight=10` and idle I/O priority; their effect depends on the disk scheduler and cgroup I/O support. With `none` or `mq-deadline`, idle priority may have no effect. Online deploy backups use `systemd-run --scope --quiet -p CPUWeight=20 -p IOWeight=10` with `nice -n 10 ionice -c3`. If the `systemd-run` command is absent or its scope cannot start, they run Python directly. A backup failure in the scope aborts the deploy; it does not retry the backup outside the scope. During a staging deploy, read `/proc/<backup-pid>/cgroup` and confirm that the scope has the configured weights. The drained backup uses normal priority to limit downtime. Gzip fallback uses level 1; zstd uses level 3 and one thread.

On staging, put a temporary failing `zstd` command first on `PATH` for the drained backup. Confirm that the deploy exits with status 1, starts the existing web/duel/worker/WS containers, and does not install the engine bundle or run migration. Delete the temporary command after the check.

On staging, use a database copy with production-like size to compare drained-step duration before and after the change. Time the snapshot/compression/verification step and confirm no retention verification occurs while services are stopped. To compare gzip levels, run `time gzip -1 -c "$copy" > "$copy.gz1"` and `time gzip -6 -c "$copy" > "$copy.gz6"`, compare sizes, then delete both test archives. These measurements require a staging copy; no production timing is assumed here.

Configure an alert at **70% used** on each filesystem that holds application data or backups. No disk alert hook exists in this repo. Add a filesystem-use alert to the owner's monitoring service, with a five-minute check interval and an owner notification. Staging's `scripts/staging/check-resources.sh` stops builds below its free-space limits; it sends no alerts. The backup free-space guard is also not an alert service.

Other names are unmanaged and untouched by automated retention, including `wipe.sql` and `run-wipe.py`. The owner-kept pre-alpha database exceptions are exactly the following files, which contain no email addresses:

- `pre-competitive-wipe-20261003-232821Z.sqlite`
- `bot-20261001-224200-manual.sqlite`
- `bot-20261002-140023-pre-reboot.sqlite`
- `bot-20261002-211806-pre-https.sqlite`

Do not create new database backups outside the automatic filename patterns as a way to bypass retention; only these named pre-alpha archives are exceptions to the privacy policy.

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

Defaults work without an environment change. Use one root-owned file, `/etc/default/dueling-backup`, for daily and deploy counts, age, space reserve, and lock wait. Create it only if it does not exist, then edit it with `sudoedit`:

```bash
if ! sudo test -e /etc/default/dueling-backup; then
  sudo install -o root -g root -m 0600 /dev/null /etc/default/dueling-backup
fi
sudoedit /etc/default/dueling-backup
```

Use shell-compatible assignments, without `export`, commands, or secrets:

```sh
DUELING_BACKUP_KEEP=7
DUELING_DEPLOY_BACKUP_KEEP=3
DUELING_RELEASE_KEEP_DAYS=14
DUELING_BACKUP_MIN_FREE_BYTES=1073741824
# Optional shared override: without it, daily waits 1800 s and online waits 900 s.
# DUELING_BACKUP_LOCK_WAIT_SECONDS=900
```

The unit reads this file with `EnvironmentFile=`; the deploy shell sources and exports the same file. New runs pick up changed values. The drained deploy always uses its shorter 300-second lock limit. Remove backup-setting `Environment=` entries from old service drop-ins, and delete the old GitHub backup count/reserve variables after migration. Re-install the unit and run `sudo systemctl daemon-reload` when changing the unit or drop-ins. Leave the production `.env` unchanged. To check propagation, temporarily set a smaller deploy count and age in the file, then compare `kept=` in a daily run and an online deploy run with enough copies to trigger retention.

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

**RESTORE** — run as root on the VM. Run the block in a subshell so a failed command stops the procedure and leaves the interactive root shell open. `scripts/backup/dueling-restore` accepts `.sqlite`, `.sqlite.gz` and `.sqlite.zst`, checks the SHA-256 sidecar, decompresses when necessary, and checks SQLite integrity before an atomic rename. It refuses an existing target or WAL/SHM/journal. Use `python3 scripts/backup/dueling-restore --verify "$backup"` for a verification-only check. Install zstd first if the selected copy ends in `.zst` and the command is absent.

Choose a copy compatible with the current release. Pause the timer and extract the chosen copy to a new candidate file before taking a fresh safety backup; the safety backup can prune the selected source. The candidate needs additional disk space. If the safety backup is SKIPPED, the block exits before stopping writers; inspect disk use, make safe space, and retry. Stop every writer and WS, including any separately run bot. Preserve the current DB and WAL/SHM in the printed dated folder, then move the verified candidate into place with its original owner and mode. For pre-PR1 rollback, restore matching code/images/env, remove worker from the service list, and keep it stopped while the old bot owns timers. Resume the timer only after a successful restore on current code. If a command fails after service shutdown, keep writers stopped and inspect the printed preserved-file path.

```bash
sudo -i
(
set -euo pipefail
cd /opt/yugioh-bot
unit=dueling-backup
tools=scripts/backup
# On an old checkout, use tools=/usr/local/lib/dueling-backup (saved before rollback).
db=data/bot.sqlite
compose=(docker compose -f docker-compose.yml)
services=(web duel worker ws)
systemctl stop "$unit.timer"
backup=/var/backups/yugioh-bot/bot-YYYYmmdd-HHMMSSZ.sqlite.gz
# A deploy source can be pr2-<timestamp>/drained/<file>; old .sqlite copies also work.
candidate="data/restore-candidate-$(date -u +%Y%m%d-%H%M%SZ).sqlite"
aside="data/pre-restore-$(date -u +%Y%m%d-%H%M%SZ)"
printf 'Candidate: %s\nPreserved files: %s\n' "$candidate" "$aside"
python3 "$tools/dueling-restore" "$backup" "$candidate"
trap 'rm -f -- "$candidate"' EXIT
# Read the same backup settings. A failure here leaves writers running.
set -a
if [[ -f /etc/default/dueling-backup ]]; then source /etc/default/dueling-backup; fi
set +a
python3 "$tools/dueling-backup"
"${compose[@]}" stop "${services[@]}"
db_owner=$(stat -c '%u:%g' "$db")
db_mode=$(stat -c '%a' "$db")
mkdir -m 0700 "$aside"
for suffix in '' -wal -shm -journal; do
    if [[ -e "$db$suffix" ]]; then mv -- "$db$suffix" "$aside/"; fi
done
chown "$db_owner" "$candidate"
chmod "$db_mode" "$candidate"
mv -T -- "$candidate" "$db"
trap - EXIT
"${compose[@]}" start "${services[@]}"
if [[ "$tools" == scripts/backup ]]; then systemctl start "$unit.timer"; fi
)
```

## VM Setup Checklist

- [ ] VM created (Hetzner CAX11 or similar, 4GB+ RAM)
- [ ] SSH key added
- [ ] [Firewall and DNS configured](#create-the-server)
- [ ] Docker and Docker Compose installed
- [ ] Repo cloned to `/opt/yugioh-bot`
- [ ] [Production environment configured](#create-env)
- [ ] GitHub Actions secrets configured
- [ ] Manual **Deploy** installs `data/duel-engine` and starts production services
- [ ] [Staging DNS, HTTPS and separate Clerk instance configured](staging.md#one-time-steps-for-the-owner)
- [ ] [Deployment verification passes](#verify)
- [ ] [Clerk instance, callback, DNS/email and production keys configured](#clerk-configuration)
- [ ] `duel` container logs show the private server listening
