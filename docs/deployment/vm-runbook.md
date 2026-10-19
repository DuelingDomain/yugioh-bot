# VM Deployment Runbook

This runbook covers deploying Dueling Domain web/WS/duel/worker to a VM. The stack runs via Docker Compose with Caddy as a reverse proxy. A successful **Test** workflow on a push to `main` automatically deploys that exact SHA to production after gameplay is idle. GitHub Actions builds the ARM64 images and pushes them to GHCR. The VM only pulls images. Staging is removed for now; it returns later on a separate server.

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

Deploy jobs run in the `production` GitHub Environment and require these GitHub Actions secrets:

- `VM_HOST`
- `VM_USER`
- `VM_SSH_PRIVATE_KEY`
- `VM_SSH_KNOWN_HOSTS` (pinned VM host keys in OpenSSH known_hosts format)
- `VM_PORT` (optional, defaults to 22)

## Deployment Pipeline

1. Merge code to `main`. Its push **Test** run must succeed in full: unit/typecheck (including WS)/web shards,
   engine core build/restore, pinned and legacy engine shards (including web engine tests and smoke),
   native ASan/UBSan checks and strict rule coverage. All regular suites run on every main push.
   Native golden checks run when core/data/native inputs or their CI wiring change. The scheduled nduel
   fuzz runs only on schedule or explicit dispatch, so it cannot fail a push release for nightly-only reasons.
   E2E helper unit tests run in Test; browser Playwright flows remain local-only under ADR-0003 and
   `packages/e2e/README.md`. No separate CI test workflow needs another deployment gate.
2. **Deploy** listens for Test completion, accepts only successful `push` runs on `main`, and checks out
   that run's `head_sha`, never a later `main` tip. It ignores PR, scheduled and manually dispatched Test runs.
   The whole workflow uses `deploy-production` concurrency with `cancel-in-progress: false`
   and `queue: max`. Up to 100 pending runs are kept. A late older run cannot cancel a newer
   pending deploy. Before preparation, an automatic run exits with a `Superseded` message
   if a newer main commit passed push Test, or if main moved past the target and a newer
   successful-Test deploy is queued. It skips preparation, builds and deployment. Manual
   dispatch is unaffected. An older SHA is also refused before the VM activity wait.
   The prepare and deploy jobs use the `production` environment for its scoped secrets. The environment has no required
   reviewers or wait timer and retains the custom branch policy allowing only branch `main`.
   Manual retry/rollback remains Actions → **Deploy** → Run workflow, using the workflow from `main`.
   Set `ref` to a SHA with a successful main push Test and leave `force=false`, `rollback=false` normally.
   A manual ref is checked against successful push Test runs before building. Prepare runs on
   `ubuntu-latest` (amd64), keeping the existing engine tools and caches. The image matrix runs on
   native `ubuntu-24.04-arm` runners with a 90-minute limit. Deploy runs on `ubuntu-latest` with
   a 180-minute limit for the lock, activity wait and service checks. Build completion order can differ
   from commit order; the VM ancestry check still refuses an older automatic release.
   The target ref must resolve to a commit on `main`.
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
   cached base bundle independent. See [the engine build details](staging.md#engine-files-and-image-build).
   Prepare uploads this exact verified tarball and the workflow revision's guard/image helper as a
   one-day Actions artifact. The image matrix and deploy job both use that artifact.
   The matrix builds `duel-bundled`, `web`, `worker` and `ws` for `linux/arm64` only, then pushes
   `ghcr.io/duelingdomain/yugioh-bot-<service>:<full commit SHA>`. The duel build uses the artifact as
   the named `engine` context. The build job has `packages: write` and `contents: read`, with
   no VM secrets. A separate job retains healthy release tags with only `packages: write`.
   The production public Clerk key is a repository variable/build arg. The Clerk secret
   stays in the VM runtime environment. Non-web targets no longer run the Next.js build.
   Each image has a separate `:buildcache` registry cache with `mode=max`. This keeps dependency and
   intermediate layers outside the Actions cache space used by engine files. Web also imports the
   rolling `:nextcache` image as a named context and exports only `.next/cache` after its build.
   A missing Next cache starts with an empty directory. Local Compose builds use the empty fallback
   stage and still work. npm uses the existing manifest/lockfile dependency layer; no cache mount was
   added because the Dockerfile has no syntax directive and cache mounts are not exported automatically.
   Each build records its output digest in a one-day artifact. Production pulls `image@sha256:...`,
   so a later build of the same SHA cannot change the images selected by this run.
   Both build steps set `provenance: false` and `sbom: false` to avoid extra attestation manifests.
   All deployment actions are pinned to full commit SHAs, with version comments.
   Workflow concurrency covers preparation, builds and deployment. `queue: max` keeps pending runs;
   an older run cannot replace a newer pending deploy. No job-level production group remains.
   See [GitHub workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
   Manual `rollback=true` skips the image matrix. The runner resolves each retained SHA tag to a digest before SSH.
   Release controls and digest artifacts expire after one day. After that, **Re-run failed jobs** can fail
   because its artifacts are gone. Dispatch a new **Deploy** run for the same tested SHA.
4. The workflow SSHes into the VM and fetches the exact commit checked out on the runner. It also
   fetches `origin main` and checks that the deploy commit is an ancestor of `FETCH_HEAD` before preflight.
   The VM also requires `git merge-base --is-ancestor HEAD "$DEPLOY_COMMIT"` before the first activity wait, checkout or image change.
   An older or diverged target is refused unless the owner explicitly sets `rollback=true`. The target must still be on main.
   Rollback does not restore the matching database or env; use the restore procedure when those are needed.
   After retention has run, roll back only to a release that has the codec. Older images show no final board and no history turn count for compressed rows; the old eliminated-spectator reader also throws on gzip BLOBs, returning HTTP 500 for that room request. Roll forward to restore reads; the stored boards are preserved.
   This release defaults retention off in code and Compose. Keep it off through one stable codec release;
   then enable it and recreate the duel container. Turn-count backfill runs while retention is off unless `DUEL_TURN_BACKFILL_ENABLED=0`. Set both maintenance switches to `0` and recreate the duel container to stop both phases.
   It waits only 15 minutes for the VM build lock; missing `flock` fails closed.
   Before checkout changes or backups, it runs `scripts/deployment/check-prod-activity.py`
   from the workflow revision against the VM's `data/bot.sqlite`. It opens SQLite with `mode=ro` and `query_only=on`.
   One snapshot counts live duels and lobby duels with RPS/dice openings, active drafts, open/pending-approval rounds in active tournaments,
   and active/between-game series. Committed WAL writes are included. Missing, locked, corrupt or incomplete
   DBs refuse immediately. Automatic runs use `--live-only`: only duels/openings and active drafts block;
   tournament rounds and series are logged for information. They recheck every 120 seconds for up to 60 minutes,
   with one deadline shared by the initial and pre-stop checks. On timeout they fail clearly, leaving live
   games running; retry manually or let the next merge trigger a new deploy. Manual runs keep the full guard and refuse immediately
   unless `force=true` was explicitly set. Automatic runs always use `force=false` and `rollback=false`.
   Force skips only the activity guard; it never disables the engine preflight, lock or backups.
   It then runs the existing **preflight** before anything on the VM changes: the install script from that commit runs with
   `DUEL_PREFLIGHT=1` on the new bundle and installs nothing. Both read-only guards ignore play duels with more than
   **10 minutes** since `last_activity_at` (falling back to `started_at`, then `created_at`), including ranked and tournament
   games, regardless of the decision clock. Missing activity evidence remains protected. It refuses while a live duel has `status = 'active'`
   in `data/bot.sqlite` and the base bundle would be replaced (a locked or corrupt DB fails closed).
   For a new multi core under an identical base bundle, only a live Tag/FFA duel refuses. On refusal, the old
   checkout, images and containers stay as they were. The transfer tarball and preflight files use
   `mktemp` paths and are removed on refusal or any other exit.
   After preflight, the helper checks free space on Docker's disk. It requires at least **6 GiB free**
   before the first pull. Low or unreadable space stops the deploy without downloading layers.
   The VM pulls all four recorded digests with `--platform=linux/arm64`, then checks each image's
   platform and revision label. Packages must be public; there is no GHCR login on the VM.
   A failed pull leaves the checkout, local `:latest`/`:prev` tags and running services unchanged.
   The workflow then saves matching checkout/deploy commits, image digests and actual container image IDs
   for duel/web/bot/WS/worker, protected env and a WAL-safe online backup under
   `/var/backups/yugioh-bot/pr2-<UTC timestamp>` (directory 0700, env 0600). It tags those image IDs
   as `:prev` before updating the checkout. A retry skips this tag change when the running image already
   has the target SHA. An unconfirmed GHCR image cannot replace an existing rollback image either.
   `data/production-image-ids` records each running image ID only after all health checks pass. This keeps VM-built
   `:prev` images through a failed first cutover, even if the next attempt selects a different SHA.
   For a service with no container, its existing local `:latest` is saved with the same checks. The VM then updates the checkout, ensures the duel secret, and
   retags the pulled images as `yugioh-bot-<service>:latest`. Compose uses these explicit local names.
   No image is built on the VM. A private 0600 temporary Compose JSON file has all `build` fields
   removed, including fields from an older rollback checkout. The four local image names are assigned
   explicitly in this file, so build-only older Compose files can use the pulled images. Bind paths are resolved against the
   production checkout. Every runtime Compose call sets `--project-directory /opt/yugioh-bot`.
   Before any service stop, Compose re-reads the generated JSON. Python compares that resolved model
   with the transformed model. A difference, including a changed `$` value, stops deployment.
   The comparison prints no runtime values. Migration uses `--pull never`; startup uses `--no-build`.
   The temporary file contains runtime values and is deleted on every exit. Never print or publish it.
   Compose fixes `DISCORD_BOT_ENABLED=0` for web and worker. The old bot image is recorded only for rollback;
   any previous bot container is stopped by its project/service labels before migration.
   After image pulls and promotion, it checks gameplay again immediately before any prod service stop, waiting within
   the remaining automatic idle budget if a new game started.
   A refusal there leaves prod containers running, but the checkout/images may already be updated.
   The job prints: **Do not run compose up. Run Deploy again.** Wait for downtime, then run the full workflow again.
   This is a snapshot guard, not an admission lock: the owner must prevent new games during the downtime window.
   It stops web/duel/worker and WS, captures a final drained backup, installs the engine bundle,
   runs `sh scripts/deployment/prepare-runtime-data.sh data`, and runs one migration with the new worker image before starting consumers. FK and integrity
   failures abort. The EXIT trap only cleans temporary files; after the coordinated stop, failure
   leaves traffic stopped and backups intact. Never restart old binaries against the migrated schema.
   Production application images built in Actions run as `node` (uid/gid 1000). The workflow
   carries its ownership helper through the release artifact and SSH transfer, including for
   older deploy refs that lack the helper. The ownership step is idempotent:
   it changes ownership of the `data/` parent and recursively changes `data/bot.sqlite*`,
   `data/card-images`, `data/duel-engine`, `data/duel-reports` and `data/ops-reports` to 1000:1000.
   Existing modes are preserved; a new `ops-reports` directory is created with mode 0700.
   After removing the old containers, the workflow runs the ownership step again immediately
   before service startup, after all host steps that open SQLite. Run it at that point after any
   manual host-side SQLite checks while the stack is stopped, too. Other data entries and
   application files keep their ownership; web's `.next/cache` is the writable image directory.
   The worker heartbeat is container-local
   `/tmp/yugidraft-worker-health.json`, so it needs no host ownership step. Compose sets
   `no-new-privileges` and drops all capabilities; Caddy retains only `NET_BIND_SERVICE`.
   The install script rechecks active duels: a table may have started during the image pulls. Drain those
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
   image helper to remove only GHCR tags with 40 lowercase hexadecimal characters for the four services.
   GHCR SHA bookkeeping tags remain while their image IDs match local `:latest` or `:prev`. Older SHA
   tags are removed after those references move. All local tags remain, including owner safety tags. GHCR cache and owner tags
   also remain. Tag removal uses no force. The helper then prunes dangling images with
   `--filter label=org.opencontainers.image.source=https://github.com/DuelingDomain/yugioh-bot`.
   All tagged images remain protected, including `:latest`, `:prev` and owner tags.
   These deploys create no VM build cache. The owner removed the old cache on 2026-10-13.
6. Caddy serves `https://<SITE_DOMAIN>` and 308-redirects `www.<SITE_DOMAIN>`
   and every plain-HTTP host (including old IP links), preserving path and query.
   Keep `caddy_data` and `caddy_config` volumes so certificates survive deploys.
   Port 4003 stays on the Docker network only — do not publish it.

Image updates must use the workflow. It builds and verifies the images in Actions, transfers the
matching engine bundle, runs VM preflight, pulls the images and installs the volume bundle before
recreating containers. Start existing local images with `docker compose -f docker-compose.yml up -d --no-build`.
After stopped-stack maintenance that installs engine data or opens SQLite as root, run
`sh scripts/deployment/prepare-runtime-data.sh data` before a migration container or service start.
Do not run `docker build` or `docker compose build` on production. Local development can still build
with Compose; the duel target needs the prepared named engine context described in
[the local engine checks](staging.md#local-verification-without-starting-services).

### GHCR owner setup and retention

1. In DuelingDomain organization settings, allow **Public** package creation before changing package visibility.
   Allow GitHub Actions to create packages. The build job uses `GITHUB_TOKEN` with `packages: write`.
   Give this repository write access to existing packages under **Manage Actions access**.
   The cleanup workflow also needs repository admin access to each package to delete versions.
2. After the first image push, open each package: `yugioh-bot-duel`, `yugioh-bot-web`,
   `yugioh-bot-worker` and `yugioh-bot-ws`. Under **Package settings → Change visibility**, select
   **Public**. A public repository does not make new GHCR packages public.
   The source label links each package to this repository. Public packages allow anonymous pulls.
   See [GitHub package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
3. If the first pull fails because packages are private, make all four public and retry the same tested SHA.
   No VM read token or login is needed. Keep the production `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` variable set.
   All release artifacts expire after one day. After expiry, dispatch a new **Deploy** run for that SHA;
   **Re-run failed jobs** cannot download expired artifacts.
4. `.github/workflows/ghcr-cleanup.yml` runs each Sunday at 05:17 UTC. It has only `packages: write`.
   It keeps the newest ten SHA versions per package, all `buildcache` and `nextcache` tags,
   and every other non-SHA tag. It removes untagged versions only after seven days.
   It protects child manifests referenced by retained indexes. If a retained manifest cannot be read,
   it stops that package before deletion and continues with the next package. Cache layers and
   config blobs are never read at the manifest endpoint. Cleanup shares the production workflow queue to avoid build races.
   After all deploy health checks pass, a runner job uses the job token to copy the old
   `production` manifest to `production-prev`, then tags the deployed digest as `production`.
   The job copies the original manifest bytes through the registry API to keep each digest.
   A retry of the same digest keeps `production-prev`. The first deploy has no previous GHCR tag.
   Both non-SHA tags protect their versions beyond the ten-release and seven-day limits.
   This job has no VM secrets. It requires deploy health checks from the current run attempt.
   Retrying only an old failed retention job fails before any registry request. This prevents
   an old retry from moving the tags after a newer deploy. If retention fails, check the registry
   error and dispatch a new Deploy run for the intended current release before cleanup.
   Retrying only the failed retain job reports "Artifact not found"; dispatch a new Deploy instead.
   Add a non-SHA recovery tag to any older registry version that must stay beyond ten releases.
   Cache tags become public with their packages. They contain intermediate build layers and `.next/cache`.
   The build has no secrets. Do not add build-time secrets or private data fetches to these public caches.
5. Before the first GHCR cutover, preserve all current VM-built images under a separate local repository:

   ```sh
   for service in duel web worker ws; do
     docker tag "yugioh-bot-$service:latest" "yugioh-bot-archive:$service-pre-ghcr" || exit 1
   done
   ```

   Keep these archive tags until a healthy GHCR deploy is confirmed and the rollback plan is checked.
   The deploy also keeps the old VM-built images as `:prev` during failed cutover attempts.
6. The owner pruned the old build cache on **2026-10-13**. Disk use was **18%** after that step.
   **If not done**, take a verified backup, then run `docker builder prune -af` once in maintenance.
   Do not repeat this step as part of normal deployment. The deploy's 6 GiB check still applies.
7. Staging is removed for now; it returns later on a separate server. The removed workflow cannot build on production.
   When staging returns, it needs its own server and Clerk key.

### Image rollback

For a compatible release already in GHCR, dispatch **Deploy** from `main`, set `ref` to its full SHA,
set `rollback=true`, and normally keep `force=false`. The selected SHA must be on main and have a
successful main push Test. Prepare restores or builds its matching engine bundle; the image matrix
is skipped. The runner resolves the old SHA to digests. The VM pulls those digests, preserves the good `:prev`, and performs the
same guard, lock, preflight, backup, stop, migration and health checks. A missing SHA tag fails before
any local tag or service change. Do not use this for incompatible schema or auth changes without
first restoring the matching database and protected runtime environment under the procedures below.

For immediate local image recovery, first drain gameplay and acquire the shared build lock. Choose
the matching release metadata, preserve current data, and restore compatible checkout/env/engine data
before starting services. Stop the old bot if present, then stop `web duel worker ws`. Confirm all four
`:prev` images exist before replacing any tag:

Keep a copy of the current ownership helper outside the checkout before selecting older code.
If that code lacks the helper, use the saved copy in the preparation step below, or use the Deploy rollback workflow.

```sh
for service in duel web worker ws; do
  docker image inspect "yugioh-bot-$service:prev" >/dev/null || exit 1
done
for service in duel web worker ws; do
  docker tag "yugioh-bot-$service:prev" "yugioh-bot-$service:latest" || exit 1
done
sh scripts/deployment/prepare-runtime-data.sh data
docker compose -f docker-compose.yml up -d --no-build ws duel web worker caddy
```

Repeat the deploy health checks. Image rollback does not reverse database migrations, Clerk changes,
engine/passcode changes or new writes. For the first release after this change, the previous images
can be VM-built images with no GHCR SHA tag; use `:prev` and the matching release backup for those.

### Internal signing cutover

Deploy web, WS, duel and worker together (and update any separately enabled bot). The v2 internal signing format
has no compatibility period with the previous format. Keep the existing internal secrets and synchronize service
clocks; signed requests must be within 60 seconds of the receiving service's clock. Draft and tournament room
tokens remain valid. Previously issued duel connection tokens are replaced: open duel tabs fetch fresh credentials
and retry once when a join is rejected. After deployment, check that an open duel tab reconnects and that draft
updates still arrive. Roll back all communicating services together if needed.

### Before a deploy that changes the engine bundle

The multiplayer merge changes the Standard and Domain cores, so its first deploy replaces the bundle. Before it:

1. Let the engine preflight count live duels. It refuses a base-bundle replacement while any live duel remains,
   or a multi-core replacement while a live Tag/FFA table remains. An hours-idle active row does not block deployment.
2. Do not start new tables until the deploy has finished. Tell the players first. A table that starts after the
   preflight is caught by the second check, but then the deploy stops after the images were pulled.
   A player returning to an idle table in the seconds between the final check and service stop can make the
   installer refuse the bundle change, leaving production stopped. Keep services stopped, wait until the last
   player input is more than 10 minutes old, then retry Deploy with the same SHA. If the manual series/round guard
   still blocks, use `force=true` for that retry; the engine guard still protects recently active tables.
   To resume play instead, follow the matched release recovery in [Image rollback](#image-rollback).
3. After the deploy, the duel container must be `running restarts=0` (the workflow checks this).
4. Watch memory for the first days (`docker stats --no-stream`). The duel service has `mem_limit` 1g
   (`DUEL_MEM_LIMIT`). The first game loads the card database and scripts (about 114 MB). Each game adds about 2.4 to
   4 MB.

The duel host owns live-table idle expiry. On startup and each normal polling sweep (default 30 seconds), it interrupts
1v1, Tag, FFA3 and FFA4 games after **10 minutes without player input**, including ranked and tournament games.
Accepted responses and explicit chain-response switch changes renew activity. Views, heartbeats, journal recovery,
bot/autopilot steps and automatic time-limit eliminations do not. Even with a long clock bank, thinking for more than
10 minutes without a player click closes the table without a winner. Ranked games have a server-owned 180-second
bank and timeouts always lose. Tournament matches also use timeout losses, while retaining the organizer's timer,
including unlimited. An unlimited tournament match idle for 10 minutes closes without a winner under the current rule.
Before idle closure, the host first tries to settle a saved ranked or tournament deadline; if settlement is impossible
or fails, it interrupts with no winner. Casual clocks shorter than 10 minutes use their existing time-limit result.
Downtime counts as idle time: after a long outage, startup closes live tables whose last
input is more than 10 minutes old. Waiting-lobby expiry keeps its separate existing timeout.

Downtime does **not** count against competitive decision clocks. Each host tick saves `duel_host_heartbeat.last_tick_at`.
At startup, a deadline at or before the previous heartbeat proves a time-limit loss. Later deadlines move forward by
the downtime. Startup rebases each remaining ranked bank once to the lesser of 180 seconds and its live remaining
time at the heartbeat (or boot when no heartbeat exists), starting at boot. Old continue-at-zero freezes receive the
existing 30-second minimum regain. Without a heartbeat, an already exhausted bank also receives that regain instead
of an unproven win. The clock rebases and new heartbeat commit together. Tournament banks retain their configured size.
Clock sweeps rotate through bounded batches so an unrecoverable older game cannot starve newer deadlines.

Idle games use the existing `interrupted` end state with reason `No player activity for 10 minutes.`, null winner and
clock, an end/archive timestamp, and no match/rating result. The host saves final boards when a worker is resident,
keeps the seed/setup/command journal for replay, frees the worker and publishes the usual WS invalidation. An interrupted
series waits between games with unchanged wins and no next-game timer; players must explicitly ready again.
If its tournament has already ended, the series is cancelled instead.

During deployment, preflight and the gameplay activity check stay read-only while services run. After stopping
web, duel, worker and WS and taking the drained backup, the deploy step sets `DUEL_IDLE_CLOSE=1` so the installer
transactionally interrupts stale casual rows before checking the engine guard. Idle ranked and tournament rows allow
replacement but remain unchanged for the restarted host to settle or interrupt. It applies the same input timestamp
rule and interruption state, retains replay journals, and leaves recently active games protected. No fresh final board is available with
the duel service stopped. Clients refetch the
closed state when WS reconnects. Ordinary container starts leave duel rows unchanged for the host sweep to close with
WS events; keep `DUEL_IDLE_CLOSE` unset outside the stopped-service deploy step. `force=true` still bypasses only the
gameplay guard; it cannot replace a live table's core.

The duel host defaults to `DUEL_MAX_WORKERS=12` across live games and replay rebuilds,
`DUEL_MAX_TABLES_PER_PLAYER=3` for each seated player at in-progress Tables, `DUEL_WORKER_HEAP_MB=256` per worker heap,
`DUEL_CREATE_TIMEOUT_MS=120000` for creation and the full recovery/replay initialization phase,
and `DUEL_OP_TIMEOUT_MS=15000` for other worker calls. WASM memory is outside the heap limit,
so the worker count is the memory guard. Replay rebuilds wait in FIFO order (up to 32 queued).
Finished, cancelled and archived Tables free player reservations; their workers count globally until close.
Capacity refusals return 429; worker deadlines return 503 and release the worker. The next room request
can recover an active duel from its saved journal. Set these values in `.env` and recreate `duel` to change them.
Caddy caps app request bodies at 1 MB.

### Engine switch and multiplayer flag

Compose defaults Standard 1v1 to `DUEL_STANDARD_1V1_ENGINE=pinned`, with no production `.env` edit.
Domain keeps `DUEL_1V1_ENGINE=legacy`. To roll back Standard, set `DUEL_STANDARD_1V1_ENGINE=legacy` in `.env`, then run
`docker compose -f docker-compose.yml up -d --no-build --force-recreate duel`. An empty or missing Standard value means `pinned`
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

3. Recreate only the web service so it reads the new values: `docker compose -f docker-compose.yml up -d --no-build web`.

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
sh scripts/deployment/prepare-runtime-data.sh data
docker compose -f docker-compose.yml run --rm --no-deps worker node packages/worker/dist/ops/cli.js merge-users --source 123 --target 456 --apply
# Review the report/FK result before starting traffic again.
sh scripts/deployment/prepare-runtime-data.sh data
docker compose -f docker-compose.yml up -d --no-build ws duel web worker caddy
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

Check the [backup retention policy](#backups) before choosing a release. Database rollback further than **14 days** is not possible from release directories: the daily timer removes their database copies even when no deployments occur. After that window, only the newest release retains checkout/deploy commits, image IDs and protected runtime env for code-only rollback against a compatible current database. Older release directories are deleted; the retained metadata is not a database restore point.

### Replay-fork rollback

After retention has run, roll back only to a release that has the codec. Older images show no final board and no history turn count for compressed rows; the old eliminated-spectator reader also throws on gzip BLOBs, returning HTTP 500 for that room request. Roll forward to restore reads; the stored boards are preserved.

Before rollback to code that predates `duels.kind`, block new fork creation and cancel every
active `replay-fork` through the current host. Stop all writers and WS, then verify on the
drained DB that `select count(*) from duels where kind = 'replay-fork' and status = 'active'`
returns `0`. Save a WAL-safe backup before starting older images. Older code has no kind
filter and can recover an active fork as an ordinary duel with bot seats and live timers.

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

These checks remain for archived staging data. When staging returns on its separate server,
run this read-only query before a deploy. Let each active duel that it finds finish first.

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

The owner keeps new production theme drafts closed for the alpha testers. Existing theme lobbies
and active games can finish when the flag is off. Summary and deck export remain available.
`GET /api/drafts` and `GET /api/cubes` return `themeDraftsEnabled` for browser create flows.

Protect `.env` as 0600. Web has an explicit environment list; no `NEXTAUTH_*`, obsolete `AUTH_*`, Discord bot token, bot announce vars or E2E gate are forwarded. Web receives `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` at runtime for existing-player recovery; retain the original Discord OAuth application's credentials in the protected runtime configuration. The Clerk secret is runtime-only and only web receives it; owner CLI runs use explicit `-e CLERK_SECRET_KEY`. Dev keys never reach production. When staging returns, it needs a separate Clerk instance and source. `WEB_URL` is required; missing it fails Compose config instead of changing WS CORS to localhost.

After runtime edits, recreate affected containers with `docker compose -f docker-compose.yml up -d --no-build`; `restart` does not reload `.env`. Changing the public key requires a web rebuild through the Deploy workflow. Preserve protected PR 1 credentials/env for the rollback window; current Compose has no bot service. Worker timers keep running without Discord delivery.

The ARM VM does not compile Domain wasm. First production start must use the manual **Deploy** workflow so GitHub Actions can install `/opt/yugioh-bot/data/duel-engine`.
The workflow prepares the engine context and builds the images on Actions runners. The VM pulls them.
Start already pulled images with the command below; use the workflow for image updates.

```bash
docker compose -f docker-compose.yml up -d --no-build
```

Image builds take several minutes. The resource bundle is not rebuilt on container restart.

### Verify

```bash
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f
```

After deploy, run `scripts/smoke-test-site.sh <SITE_DOMAIN> <VM IP>` from the repo on your workstation to check certificates, redirects, Socket.IO, the sign-in page (200), and anonymous session (200 `null`).

Manually open `https://<SITE_DOMAIN>` in a browser, exercise email/password and Discord sign-in, invitation ticket + Discord with locked email/required username/consent, email code/resend and password reset. Confirm history recovery, account refresh, channel-free drafts/decks/duels, WS updates, worker deadlines and published legal links; the smoke script cannot verify these checks.

### Product analytics

Leave `NEXT_PUBLIC_POSTHOG_KEY` and `POSTHOG_KEY` empty until the owner-approved privacy policy is live. Create a PostHog EU project and enable cookieless server hash mode. Set repository variable `NEXT_PUBLIC_POSTHOG_KEY` for the Actions web build; changing it requires a new image. Set the same project key as `NEXT_PUBLIC_POSTHOG_KEY` in the VM `.env` for the marketing landing page. Caddy templates omit the script when this key is empty; other marketing pages never include it.

Both app and marketing Caddy blocks import `(posthog_ingest)` before their fallbacks. It strips `/ingest`, routes `/ingest/static/*` to `eu-assets.i.posthog.com` and other ingestion requests to `eu.i.posthog.com`, and removes Cookie, Authorization and Referer upstream. App ingestion bypasses Next.js.

The worker's explicit Compose environment receives `POSTHOG_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and `POSTHOG_HOST` (empty uses `https://eu.i.posthog.com`). The personal key needs persons read/write scope and goes only to the worker, with the project ID used by `/api/projects/<id>/persons/`. Default EU persons requests use `https://eu.posthog.com`. No personal API key is a build argument or browser setting. Recreate worker/Caddy after runtime env changes.

Events queue with the domain change and ship in batches of at most 100 every ten seconds. Failed sends back off exponentially with persistent retry timing; ten attempts stops sending. Sent rows are removed after seven days, unsent rows after thirty. Person lookups without a visible matching profile retry within the same ten-attempt budget; verify deletion jobs during rollout. Empty worker project key discards events and deletion jobs without HTTP. Account deletion removes matching Clerk waitlist entries before deleting the Clerk login and erasing email, then queues person/event deletion. The owner `delete-user` command also performs this cleanup; `--skip-clerk` explicitly skips all remote Clerk cleanup.

### Clerk configuration

Configure production Clerk for `https://app.duelingdomain.com`: waitlist sign-up mode; email/password with email code verification; required username and legal consent; Discord OAuth; passwordless/passkeys/phone off; 30-day maximum session lifetime with no shorter inactivity timeout; bot protection and invitation/waitlist email templates. Consent URLs are `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`. Contact is `support@duelingdomain.com`. Apply the exact Clerk dashboard DNS/email records and verify them; do not invent record values. Register the Clerk-provided Discord callback in the Discord app; the app continuation is `/sso-callback`. Keep previous settings for rollback. Owner approval is required before production cutover.

Existing-player recovery also uses the original application's registered `${WEB_URL}/api/auth/callback/discord` URI, alongside Clerk's callback. Keep that exact HTTPS URI registered; if the domain cutover left only the legacy hostname's callback, add the current `WEB_URL` URI before deploying. Forward `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` to web through the explicit Compose entries, then recreate web so it receives them. No new cookie secret is needed; recovery derives its authenticated-encryption key from `CLERK_SECRET_KEY`. Do not print runtime configuration or credentials when checking this.

Recovery bypasses the waitlist only for a server-proven Discord ID already in `users`; an unlinked row also needs a verified Discord email. An unlinked row gets a one-step `/welcome-back` consent page; no `players` row is required. An email already owned by another Clerk user is a support conflict, never automatic login by email. Clerk private metadata retains the proven Discord ID during initial profile sync. If Clerk's Discord sign-in still transfers into restricted signup after linking, direct OAuth proof issues a sign-in ticket for the stored Clerk ID after checking that Clerk's user exists, is neither banned nor locked, and has no conflicting Discord claim; a missing claim is recorded in private metadata before issuing the ticket. Sync clears that bootstrap metadata best-effort when a matching verified external Discord account appears, so removing that account then clears both application Discord links on the next sync. If no sync observes the matching verified external account before removal, or metadata cleanup keeps failing, the owner must clear `existingPlayerDiscordId` and the application Discord mapping to revoke recovery. Tickets expire in 120 seconds and travel through an encrypted HttpOnly cookie and same-origin POST, never a redirect URL. Verify recovery, preserved history and a second Discord sign-in in a browser before announcing the fix. Keep web private behind Caddy; recovery's bounded per-process limiter relies on Caddy overwriting incoming `X-Forwarded-For`.

## Error reporting

Create the web and server projects in the Sentry EU region. Keep DSNs empty until those projects are ready; empty values use console reporting. Set `SENTRY_DSN` and `SENTRY_ENVIRONMENT` in the protected VM `.env`. Web, ws, duel and worker receive these values through Compose; an independently run bot uses the same server setup.

Set repository variables `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG` and `SENTRY_PROJECT` for source-map uploads. `SENTRY_PROJECT` accepts a comma-separated list; include the projects used by both the web server DSN and browser DSN when they differ. Set `SENTRY_AUTH_TOKEN` as a **production environment secret** with source-map upload access. The Actions `build` job selects the `production` environment for its web matrix entry and passes the token to `docker/build-push-action` through `secrets`. It never reaches the VM, a build argument or a runtime environment. The web runtime and Next cache builds receive identical Sentry arguments and secret mounts; builds with no Sentry values or with only a DSN skip upload. Local builds also skip upload by default. Production Compose only starts pulled images.

The production workflow sets `SENTRY_RELEASE` to the checked-out deploy SHA for the web build and every service. Application source maps are excluded from the Docker context. Dependency installation, non-web compilation and the web build each delete map files in the same Docker step that creates them, before any layer or public build cache is exported. The web build also rejects output containing the upload token. Browser reports use the exact public `/monitoring` tunnel. Reporting uses `sendDefaultPii: false`, a 0.05 trace sample rate and no replay; only application user IDs belong in identity. Request bodies, cookies, credentials and personal fields are redacted before sending.

After deployment, check that the services start and drain normally. Confirm an unexpected error arrives in the configured EU project with the deployed release and readable web stack frames. Remote delivery and source-map upload require the owner's project configuration and cannot be checked with empty DSNs.

## GitHub Actions Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions, and add:

| Secret | Value |
|--------|-------|
| `VM_HOST` | Your VM's public IP |
| `VM_USER` | `root` |
| `VM_SSH_PRIVATE_KEY` | Full contents of your SSH private key |
| `VM_PORT` | `22` |

Also set repository **variable** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the production `pk_live_...` value. The runtime `CLERK_SECRET_KEY` stays on the VM. Production automatically deploys successful main push Test SHAs. Complete the [GHCR owner setup](#ghcr-owner-setup-and-retention) before the first image deploy.

## Automatic Production

`.github/workflows/deploy.yml` deploys after a successful main push **Test**, and retains manual dispatch
from `main` for retry and rollback. The `production` environment's required reviewers were removed at
owner request; its custom branch policy still allows only `main`, and its environment secrets stay scoped.
Staging is removed for now; it returns later on a separate server.

Normal flow:

1. Work on a branch and open a pull request.
2. Wait for PR CI, then merge into `main`.
3. The merge's push **Test** runs all regular release suites. Failure prevents automatic production deployment.
4. **Deploy** pins the successful run's SHA, builds ARM64 images in Actions, waits for live duels/openings and active drafts,
   runs VM engine preflight, pulls images, saves backups, rechecks activity and completes deployment with health checks. It reports `Production deployed SHA` in logs and summary.
5. Verify the Deploy result and `GET https://app.duelingdomain.com/sign-in` returns 200.

Manual production deploys keep the full activity guard, including open tournament rounds and
active/between-game series. Automatic deploys log those counts without blocking on them.
Production keeps its 15-minute lock wait. Owner maintenance must use the same lock.

Local safety checks (no VM access):

```bash
python3 -B -m unittest discover -s scripts/deployment -p test_deploy_safety.py -v
node --test scripts/deployment/container-runtime.test.mjs
node --test scripts/ci/deploy-flow.test.mjs
npx vitest run scripts/deployment/deploy.test.ts
node --test scripts/ci/production-images.test.mjs scripts/ci/ghcr-cleanup.test.mjs
# Actionlint 1.7.12 does not yet recognize GitHub's documented queue property.
# Exclude only this schema diagnostic; all other checks remain enabled.
actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/deploy.yml .github/workflows/ghcr-cleanup.yml
shellcheck scripts/deployment/production-images.sh
sh -n scripts/deployment/production-images.sh
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
# Start already pulled local images:
docker compose -f docker-compose.yml up -d --no-build

# Stop all
docker compose -f docker-compose.yml down
```

## Backups

The root systemd service runs the repo's `scripts/backup/dueling-backup` to back up `/opt/yugioh-bot/data/bot.sqlite` with Python's SQLite backup API, including committed WAL writes without stopping the app or requiring the SQLite CLI. The timer runs daily at **07:30 UTC**, with up to ten minutes of random delay and catch-up after downtime. Snapshots are integrity checked, mode 0600, and paired with SHA-256 sidecars in `/var/backups/yugioh-bot` (directory mode 0700). `DUELING_BACKUP_SRC` and `DUELING_BACKUP_DIR` override the source and destination. Deploys update the script used by the service; re-copy the units if their configuration changes.

After closing the live database, the backup restores any remaining WAL/SHM sidecars to the
database file's uid/gid, including on backup failure. Their modes are preserved so a root-run
backup while containers are stopped leaves the sidecars usable by the application user.

After a successful backup, the server keeps up to **7** automatic `bot-YYYYmmdd-HHMMSSZ.sqlite` files by UTC filename and deletes older ones with their sidecars. `DUELING_BACKUP_KEEP` changes that count and must be an integer >= 1; set it in a systemd service drop-in on the VM. A separate **14-day age cap** (applied from 13 days, because the timer runs once a day) removes expired automatic files even when fewer than the configured count exist: missed timers and manual runs make count-only retention insufficient. At least the newest automatic snapshot is retained. A successful run creates a fresh snapshot before pruning, so that safeguard does not retain an expired snapshot during normal operation. Completion lines include `kept` and `total_bytes` for retained automatic SQLite files, excluding sidecars and manual files.

The same daily service then prunes release directories in its backup root, without requiring another deployment. Only exact `pr2-YYYYmmdd-HHMMSSZ` directory names with valid UTC timestamps qualify; age and newest-release selection use the name, not filesystem mtime. Database copies expire after **14 days** (removed by the first daily run after they turn 13 days old, so none outlives 14 days), including entire `online/` and `drained/` trees and any `*.sqlite*` entries elsewhere within the release. `DUELING_RELEASE_KEEP_DAYS` can shorten this database window to an integer from 1 to 14; invalid values warn and fall back to 14 days. Whole release directories older than 14 days are deleted except the newest release overall. That newest release keeps its small `checkout-commit`, `deploy-commit`, `images.jsonl`, image digest files and `runtime.env` metadata for code-only rollback, but its database copies still expire. `runtime.env` contains secrets and remains protected; do not publish or print it. Database rollback further than 14 days is not possible from release directories.

Pruning resolves paths inside the backup root and refuses symlinks. Release-pruning failures emit `WARNING: dueling-backup: release pruning:` in the service journal without failing the verified daily backup, and pruning continues with other safe releases. Review these warnings and correct the affected paths or permissions so expired copies do not persist. If free space is short, release pruning runs before the space check fails, and it also runs when the daily prune fails. Expiry is evaluated on each daily run, including catch-up after downtime; an inactive timer or failed backup delays cleanup. The deploy workflow's `online/` and `drained/` invocations use their own backup destinations and do not prune the parent backup root.

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

**RESTORE** — run as root on the VM, choose an existing backup below, and stop on any failed command. Pause the timer and take a fresh snapshot before verifying the chosen backup. Keep the original database and WAL/SHM together in the dated folder; only remove these live files after every writer and WS stop. The commands below restore a backup compatible with the current release. For pre-PR1 rollback, also restore the matching code/images/env, remove worker from the service list before restarting, and keep it stopped while the old bot owns timers.

```bash
sudo -i
set -euo pipefail
cd /opt/yugioh-bot
unit=dueling-backup
db=data/bot.sqlite
compose=(docker compose -f docker-compose.yml)
services=(web duel worker ws)
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
sh scripts/deployment/prepare-runtime-data.sh data
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
- [ ] GitHub Actions secrets and production public Clerk variable configured
- [ ] Four GHCR packages are public; repository has package write access
- [ ] Weekly GHCR cleanup enabled; repository has package admin access
- [ ] **Deploy** installs `data/duel-engine` and starts production services after a successful main push Test
- [ ] Staging workflow and deployment files are removed
- [ ] [Deployment verification passes](#verify)
- [ ] [Clerk instance, callback, DNS/email and production keys configured](#clerk-configuration)
- [ ] `duel` container logs show the private server listening

## Manual duel storage VACUUM

Snapshot retention only makes SQLite pages reusable. It never runs VACUUM. Schedule a drain window after compaction. The host logs pass counts, busy deferrals, and `backlogDone`, including turn-backfill progress while retention is off. `backlogDone` covers the enabled phases; unreadable turns stay null and are retried on the next cursor scan. After a scan wraps to the start, the host waits at least one hour before a new full turn scan. Compaction and fork cleanup continue during this delay.

As root, first set `DUEL_DB_FILE` to the existing database, `DUEL_DB_BACKUP` to a new backup file outside application cleanup, and `DUEL_SQLITE_TMPDIR` to a writable temporary directory on the database volume. Use operator-selected paths. The backup directory must already exist. Never overwrite a backup. Check the remaining eligible rows with the same configured age (30 days below); queued or failing forks leave the backlog unfinished:

```bash
: "${DUEL_DB_FILE:?Set DUEL_DB_FILE to the existing database path}"
sqlite3 -readonly "$DUEL_DB_FILE" "select count(*) as turns_pending from duels where turn_count is null and status in ('completed','interrupted','cancelled') and (clock_json is not null or snapshot_public_json is not null or snapshot_seat0_json is not null or snapshot_seat1_json is not null or snapshot_seats_json is not null); select count(*) as boards_pending from duels where snapshot_compacted_at is null and status in ('completed','interrupted','cancelled') and julianday(ended_at)<julianday('now','-30 days'); select count(*) as forks_pending from duels where status='cancelled' and kind='replay-fork' and series_id is null and julianday(ended_at)<julianday('now','-7 days');"
```

`turns_pending` is an upper bound. It includes rows whose stored values have no readable turn. These rows stay null after a scan completes.

1. Stop new duel admissions, let active duels finish, and verify the count is zero with the [active-duel drain check](#before-a-deploy-that-changes-the-engine-bundle). Pause `dueling-backup.timer`, wait for any running `dueling-backup.service` to finish, then stop web, bot (if separately running), worker, ws, and duel. Keep all database readers and writers stopped through verification.
2. Run the guarded subshell below. It verifies the live DB and backup, requires at least **2x the database file size in free space after backup**, and places SQLite's temporary copy on that same volume via `SQLITE_TMPDIR`. This accounts for the temporary database and WAL copy-back; leave additional room for filesystem overhead. If using a different temp volume instead, independently reserve 2x the file size there and on the database volume and change the same-volume guard only after checking both.
3. Every failed prerequisite check exits the subshell before VACUUM. The SSH shell stays open. The exit trap repairs ownership and permissions of any `-wal` and `-shm` files left by the root CLI, including on failure.

```bash
# Set the three variables and stop all readers/writers before this block.
(
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  test -n "${DUEL_DB_FILE:-}" || fail 'Set DUEL_DB_FILE'
  test -n "${DUEL_DB_BACKUP:-}" || fail 'Set DUEL_DB_BACKUP'
  test -n "${DUEL_SQLITE_TMPDIR:-}" || fail 'Set DUEL_SQLITE_TMPDIR'
  test -f "$DUEL_DB_FILE" || fail 'Database does not exist'
  test ! -e "$DUEL_DB_BACKUP" || fail 'Backup already exists'
  test -d "$(dirname "$DUEL_DB_BACKUP")" || fail 'Backup directory does not exist'
  test -d "$DUEL_SQLITE_TMPDIR" || fail 'SQLite temp directory does not exist'
  test -w "$DUEL_SQLITE_TMPDIR" || fail 'SQLite temp directory is not writable'
  # The CLI .backup argument uses single quotes; refuse paths it cannot quote safely.
  case "$DUEL_DB_BACKUP" in *"'"*|*$'\n'*) fail 'Unsupported backup path';; esac
  fix_sidecars() {
    for sidecar in "$DUEL_DB_FILE-wal" "$DUEL_DB_FILE-shm"; do
      if test -e "$sidecar"; then
        chown --reference="$DUEL_DB_FILE" "$sidecar" || return 1
        chmod --reference="$DUEL_DB_FILE" "$sidecar" || return 1
      fi
    done
  }
  trap 'fix_sidecars || { printf "%s\n" "Sidecar ownership repair failed; keep services stopped" >&2; exit 1; }' EXIT
  source_check=$(sqlite3 -readonly "$DUEL_DB_FILE" 'PRAGMA integrity_check;') || fail 'Live DB check failed'
  test "$source_check" = ok || fail 'Live DB integrity check is not ok'
  sqlite3 "$DUEL_DB_FILE" ".backup '$DUEL_DB_BACKUP'" || fail 'Backup failed'
  chown --reference="$DUEL_DB_FILE" "$DUEL_DB_BACKUP" || fail 'Backup owner fix failed'
  chmod 600 "$DUEL_DB_BACKUP" || fail 'Backup permission fix failed'
  backup_check=$(sqlite3 -readonly "$DUEL_DB_BACKUP" 'PRAGMA integrity_check;') || fail 'Backup check failed'
  test "$backup_check" = ok || fail 'Backup integrity check is not ok'
  db_device=$(stat -c %d "$DUEL_DB_FILE") || fail 'Database volume check failed'
  tmp_device=$(stat -c %d "$DUEL_SQLITE_TMPDIR") || fail 'Temp volume check failed'
  test "$db_device" = "$tmp_device" || fail 'SQLite temp directory must be on the data volume'
  # Checkpoint before sizing: committed WAL pages may enlarge the database file.
  checkpoint=$(sqlite3 "$DUEL_DB_FILE" 'PRAGMA wal_checkpoint(TRUNCATE);') || fail 'Checkpoint failed'
  case "$checkpoint" in '0|0|0'|'0|-1|-1') ;; *) fail 'Checkpoint is busy or incomplete';; esac
  db_bytes=$(stat -c %s "$DUEL_DB_FILE") || fail 'Database size check failed'
  available=$(df --output=avail -B1 "$DUEL_DB_FILE") || fail 'Free-space check failed'
  available=${available##*$'\n'}
  available=${available//[[:space:]]/}
  case "$available" in ''|*[!0-9]*) fail 'Invalid free-space result';; esac
  test "$available" -ge "$((2 * db_bytes))" || fail 'Need at least 2x DB file size free after backup'
  export SQLITE_TMPDIR="$DUEL_SQLITE_TMPDIR"
  sqlite3 "$DUEL_DB_FILE" 'VACUUM;' || fail 'VACUUM failed'
  integrity=$(sqlite3 -readonly "$DUEL_DB_FILE" 'PRAGMA integrity_check;') || fail 'Post-VACUUM check failed'
  test "$integrity" = ok || fail 'Post-VACUUM integrity check is not ok'
  foreign_keys=$(sqlite3 -readonly "$DUEL_DB_FILE" 'PRAGMA foreign_key_check;') || fail 'Foreign-key check failed'
  test -z "$foreign_keys" || fail 'Foreign-key violations remain'
  fix_sidecars || fail 'Sidecar ownership repair failed'
  ls -ln "$DUEL_DB_FILE" "$DUEL_DB_BACKUP" || fail 'File inspection failed'
)
```

Pause the timer with `systemctl stop dueling-backup.timer`. Check `systemctl is-active dueling-backup.service` and wait until it is inactive before stopping the application services. If the subshell fails, keep services and the timer stopped and investigate with the preserved backup. On success, inspect numeric owners with `ls -ln` in the data directory, including any `-wal`/`-shm` files, compare file sizes, then restart the application services and `systemctl start dueling-backup.timer`. Check a finished room, history count, and public/own-seat replay. Keep the backup under the operator's backup policy. Do not add VACUUM to startup or periodic jobs.

This release defaults `DUEL_SNAPSHOT_RETENTION_ENABLED=0`. Keep it off until all board readers use the codec and one stable codec release is available for rollback. Then enable it and recreate the duel container. Turn-only backfill still runs while compression and fork cleanup are off. When enabled, the policy compresses final boards after 30 days and deletes only cancelled replay forks after 7 days. See [stored duel boards](../architecture.md#stored-duel-boards) for limits and settings.
