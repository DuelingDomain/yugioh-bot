# Staging for 3-player and 4-player duel tests

Staging is a second copy of the web app, the websocket server and the duel server. It runs on the same VM as
production, but it shares nothing with production. People can test 3-player and 4-player duels there. Production
does not change.

## What staging is

| Part | Production | Staging |
| --- | --- | --- |
| Folder on the VM | `/opt/yugioh-bot` | `/opt/yugioh-bot-staging` |
| Compose project | default | `yugidraft-staging` |
| Services | bot, ws, duel, web, caddy | ws, duel, web, caddy (no bot) |
| Database | `data/bot.sqlite` | a copy: `data-staging/bot.sqlite` |
| Engine files | `data/duel-engine` | `data-staging/duel-engine` (with both multiplayer cores) |
| Docker network | the default network of the project | `yugidraft-staging-net` |
| Address | port 80 | port 8080, plain HTTP (never 80 or 443) |
| Secrets | `.env` | `.env.staging` (new `NEXTAUTH_SECRET` and new internal secrets) |

Files: `docker-compose.staging.yml`, `Caddyfile.staging`, `scripts/staging/`, `.github/workflows/deploy-staging.yml`.

The duel and web services set `MULTIPLAYER_TABLES=1` to permit FFA3, FFA4 and 2v2 Tag tables and presets.

Rules that keep production safe:

- The workflow only runs compose with `scripts/staging/compose.sh`. That script always uses the project name
  `yugidraft-staging`, the file `docker-compose.staging.yml` and the file `.env.staging`. It refuses to run in `/opt/yugioh-bot`.
- Staging reads three things from `/opt/yugioh-bot`: the file `.env` (only to build `.env.staging` the first time),
  `data/bot.sqlite` (read-only, to make the copy) and the git remote address (only for the first clone). It writes nothing there.
- There is no bot in staging. A second bot with the same Discord token would answer every command twice.
  So there are no Discord announcements from staging, and no draft timers (the draft timer runs in the bot).
  Duels do not need the bot.
- The web in staging keeps `DISCORD_TOKEN`. It uses it only to check that a user is in the guild (a REST call).
  It does not open a Discord gateway connection.
- Every service has a memory limit and no swap. If the VM runs out of memory, the kernel stops a staging process first.
- Every service has a lower CPU weight than production (`cpu_shares: 256`). Staging containers never restart by themselves
  (`restart: "no"`): after a crash or a VM reboot staging stays off until you run the workflow again.

## Memory (read this first)

The VM has 4 GB of RAM. Production uses most of it at busy times. The limits of staging add up to 1536 MB:

| Service | Limit |
| --- | --- |
| duel | 768 MB |
| web | 512 MB |
| ws | 192 MB |
| caddy | 64 MB |

The weak point is the build: `next build` needs about 1 GB or more for a short time. The workflow protects production like this:

1. It stops the old staging containers before it builds.
2. It takes the build lock `/var/lock/yugidraft-build.lock` and waits up to 15 minutes for it. The production deploy
   (`.github/workflows/deploy.yml`) takes the same lock, so two builds never run together. The production deploy also
   stops the staging containers before it builds, and staging stays off until you run the staging workflow again.
   It also stops if it sees another build process that does not use the lock.
3. It stops if the VM has less than 1100 MB of available memory before the build, or less than 6000 MB of free disk.
   It checks the disk again after the build (2500 MB). It also deletes the staging card image cache before each build.
4. It stops if the VM has less than 1700 MB of available memory before it starts the containers.
5. After a healthy start it removes the old staging images from the earlier deploy. It removes only those image ids,
   and Docker refuses an image that a container or the production project still uses.

If the health check fails at the end, the workflow stops the staging containers again, so an unhealthy stack does not keep
using memory. The engine bundle in `/tmp` on the VM is removed after every run.

If a check stops the run, staging stays down and production is not touched. Run the workflow again when the VM is quiet.
A push to `main` while staging runs therefore stops staging. This is on purpose: production comes first.

To look at the memory by hand, on the VM:

```sh
free -m
cd /opt/yugioh-bot-staging
docker stats --no-stream $(sh scripts/staging/compose.sh ps -q)
sh scripts/staging/check-resources.sh now 1000 3000 /opt
```

## One-time steps for the owner

1. **Push the branch** `n-player-ui-implementation` to GitHub. (Nobody and nothing has pushed it for you.)
2. **Put the workflow on `main`.** GitHub lists a manual workflow in the Actions tab only when its file is on the default
   branch. Make a small pull request that adds only `.github/workflows/deploy-staging.yml`. The workflow uses the input
   `ref` to check out the feature branch, so the scripts and the code come from that branch. Note: a push to `main`
   starts the normal production deploy of `main`. That deploy is the usual one and does not include staging.
3. **Open the network.** In the Hetzner Cloud Firewall, allow inbound TCP `8080`. If you can, allow only the IP
   addresses of the testers. Docker publishes ports around `ufw`, so the Hetzner firewall is the real gate.
   Staging is then at `http://YOUR_VM_IP:8080`. Staging is plain HTTP only. It never uses port 80 or 443: the production
   Caddy owns them, and a staging container that held one of them could stop production from starting.
   The scripts refuse a staging port below 1024. Optional: add a second DNS name for the VM, for example
   `staging.example.org`, and set the repository variable `STAGING_DOMAIN` to it. The address is then
   `http://staging.example.org:8080`, and the cookies of staging and production no longer clash.
   HTTPS for staging is a later step: add the staging host name as a second site to the production Caddy.
4. **Add the Discord redirect address.** In the Discord developer portal (the same application that production uses),
   OAuth2, Redirects, add one of:
   - `http://YOUR_VM_IP:8080/api/auth/callback/discord`
   - or, with a staging host name: `http://staging.example.org:8080/api/auth/callback/discord`
5. **Optional repository variables.** They are read only the first time, when `.env.staging` does not exist yet.
   `STAGING_DOMAIN`, `STAGING_HOST` (default: the secret `VM_HOST`) and `STAGING_HTTP_PORT` (default `8080`).
   The secrets `VM_HOST`, `VM_USER`, `VM_SSH_PRIVATE_KEY` and `VM_PORT` are the ones that production already uses.
6. **Run the workflow.** GitHub, Actions, "Deploy Staging", Run workflow. Choose the same branch for
   "Use workflow from" and `ref` (default `n-player-ui-implementation`),
   `refresh_db` = off, `action` = `deploy`. The first run is slow (it builds three images and both multi cores).
   From the CLI, specify the branch twice: `gh workflow run deploy-staging.yml --ref <branch> -f ref=<branch>`.
   For this branch: `gh workflow run deploy-staging.yml --ref n-player-ui-implementation -f ref=n-player-ui-implementation`.
   If the VM user is not `root`, make the folder first: `sudo mkdir /opt/yugioh-bot-staging && sudo chown $USER: /opt/yugioh-bot-staging`.

When the run is green, the job log ends with the container list, the memory use and `staging is running`.
Open the address and sign in with Discord.

## Engine files and image build

The duel server resolves `DUEL_DATA_DIR` from the application root; both Compose files set it to
`/app/data/duel-engine`. Staging mounts `data-staging` at `/app/data`, so the VM files live at
`/opt/yugioh-bot-staging/data-staging/duel-engine`. Production uses `/opt/yugioh-bot/data/duel-engine`.

| Mode and layout | WASM loaded by the engine | Start guard |
| --- | --- | --- |
| Standard FFA3, FFA4, Tag | `ocgcore.multi.wasm` | Plain multi core must exist |
| Domain FFA3, FFA4, Tag | `ocgcore.multi-domain.wasm` | Both multi core files must exist |
| Standard 1v1, pinned engine | `ocgcore.standard.wasm` | Does not use multi cores |
| Domain 1v1, pinned engine | `ocgcore.domain.wasm` | Does not use multi cores |
| Legacy 1v1 (production default) | npm Standard core or `ocgcore.domain.legacy.wasm` | Does not use multi cores |

The Domain guard needs the plain multi file as well, even though the Domain game loads only the Domain
variant. The `capabilities` operation reports `multiDomainCoreReady` from the Domain file; preset
availability (`multiCoreAvailable`) checks the plain file. Neither existence check validates the WASM;
the deploy and image checks do that separately.

Both multi modes also read `cards.cdb`, the pinned `card-scripts` directory and the `multi-scripts` Lua
overlay (`mp-utility.lua`, `MANIFEST.json` and the card overrides). Domain loads `card-scripts/domain.lua`.
The startup bundle check also requires the pinned Standard/Domain 1v1 cores, `manifest.json` and the
legacy files/hashes. The installer requires `strings.conf` and verifies the overlay hash. Installing
only two WASMs into an empty directory is insufficient.

The staging and production workflows now compile both multiplayer cores on the GitHub runner using
`packages/duel-server/scripts/build-deploy-multi-cores.sh`. Nothing compiles a core on the small VM.
The build uses the same inputs as the engine session:

- `domain-core/pins.json`: ygopro-core `efc21aa433b88cd35b7c37db4072a35c58d9d435`, wrapper source
  `9f36452f2a2464f057f7fd6e2273aa5ab589401e`, Lua `75ea9ccbea7c4886f30da147fb67b693b2624c26`,
  and emsdk `4.0.9` at digest `sha256:3c853ef9c3b4c2708da1adac2fdfdba49c775fdc4144ceef4989423963e96811`.
- All numbered patches in `domain-core/patches` (currently 0001–0084 and 0090; 85 patches). No experimental patches or
  `PATCH_LIMIT`. The current series hash is `1d683feae7b0deb90ba5b7b8e0fddc12d9db0ace22e442cdd3fa81f32f66355c`.
- Domain additionally uses `APPLY_DOMAIN=1 DOMAIN_MULTI=1`, the existing Domain patch, `domain_master.cpp`
  and `apply-domain-multi.mjs`. The current multi layer hash is
  `cf5100707bce7701cb0be0ac4a8ff47308a13b278174f03c157f2f2e46dd849a`.

The 85-patch CI builds use `LUA_FIXED_SEED=1` with the pinned image above. Both multi cores were rebuilt for the 2026-10-04 FFA response-order change using the TypeScript build entry point and the shared build lock, with `EMCC_CORES=2`. The full series reapplied cleanly and the Domain pre/patch/post scripts succeeded. Their verified hashes are:

| CI core | SHA-256 |
| --- | --- |
| Standard multiplayer | `c74b4c452b22e6f2a5e804c52b66676df5f6cf236a3c6bb95467dc2da6f7585f` |
| Domain multiplayer | `f6da4b828e022b84c76be0955241dfad8d3154189a426e8f8714c6808cf0ae30` |
| Domain 1v1 (unchanged) | `16f60edf2c1e246886d1962fad32238fde0dd969c36bc959251df488c83aefc7` |

Deploys omit `LUA_FIXED_SEED`; the differential test workflow uses it. The multi cache keys include all
build/packaging scripts, pins, patches and Domain sources. Each cache stores both WASMs and their
build-info JSON files. `package-deploy-multi-cores.mjs` checks those records and rejects test-seeded or
incomplete builds, then writes a `.sha256` and `.SOURCE` sidecar for **each** deployed core. Each build-info
JSON stores `builderCommit`; the sidecars and packaging logs print `builtBy=` from that record and
`deployedBy=` from the checked-out HEAD. A cache hit preserves the original builder, while a manual
staging dispatch records the requested checkout as deployer. The VM fetches and checks out that exact CI commit, even if the requested branch
advances during compilation. The workflows verify installation in a scratch directory before transfer.

The VM prepares `.deploy-duel-engine` from that tarball and passes it as the named `engine` build
context. `.dockerignore` excludes it from the application context. Both deploy Compose files use
Docker target `duel-bundled`, which copies the complete bundle once to `/opt/duel-engine` with readable
permissions and verifies it there with `verify-deploy-multi-cores.mjs`. No engine copy is baked into
`/app/data`. Staging installs on the host before startup; its installer also checks the image source
against the mounted bundle at startup. Production leaves `DUEL_BUNDLE_SRC` empty, so starts only
verify the installed volume. The temporary build context and randomized transfer tarball are removed
after deployment, including clone/fetch failures. The local dev override retains the bare `duel`
target, clears the named context, and keeps its existing volume.

The shared installer validates both checksums before writing, updates either multi core even under an
identical base manifest, and refuses a changed multi core while a Tag/FFA duel is active. Staging's
wrapper requires both WASMs and all four checksum/provenance sidecars. Production carries the same
cores but still defaults `MULTIPLAYER_TABLES` to off; shipping them does not open multiplayer tables.

### Local verification without starting services

From a disposable checkout, prepare the bundle and build the deploy image:

```sh
npm ci
mkdir -p .deploy-duel-engine
export DUEL_DATA_DIR="$PWD/.deploy-duel-engine"
npm run duel:prepare
npx tsx packages/duel-server/scripts/build-domain-core.ts
npx tsx packages/duel-server/scripts/build-domain-core.ts standard
npx tsx packages/duel-server/scripts/build-domain-core.ts legacy-domain
bash packages/duel-server/scripts/build-deploy-multi-cores.sh
node packages/duel-server/scripts/package-deploy-multi-cores.mjs "$DUEL_DATA_DIR"
docker build --target duel-bundled --build-context engine=./.deploy-duel-engine -t yugidraft-multicore-test .
docker run --rm --network none --env DUEL_DATA_DIR=/opt/duel-engine --entrypoint node yugidraft-multicore-test \
  packages/duel-server/scripts/verify-deploy-multi-cores.mjs --smoke
```

The check verifies the bundle, WASM syntax, both checksums, `multiCoreAvailable=true` and the real host
response `multiDomainCoreReady=true`. `--smoke` starts all six Standard/Domain FFA3, FFA4 and Tag layouts
from the deployed filenames and checks Domain Deck Masters. It opens no ports and uses an in-memory
application database. Repeat with an empty writable bind mount to test the startup copy:

```sh
mkdir -p .status/multicore-check
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/.status/multicore-check:/app/data" --entrypoint sh yugidraft-multicore-test \
  -c 'sh packages/duel-server/scripts/install-engine-bundle.sh && node packages/duel-server/scripts/verify-deploy-multi-cores.mjs --smoke'
docker image rm yugidraft-multicore-test
```

Remove only this checkout's generated `.deploy-duel-engine`, test data and core build output afterward.
Do not prune shared Docker images, volumes or build caches. No external release asset is required: all
patches and Domain sources are tracked, and upstream repositories are pinned to commits.

Earlier local verification of the original packaging on 2026-10-02 rebuilt both production cores with bytes identical to the engine
snapshot: Standard multi SHA256 `896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`,
Domain multi SHA256 `f1f8adaeaff21328970ffe894bf70cd86cc3afa18731a8aae4a397206824e2cb`.
The Docker build, baked-data check, fresh non-root bind-mount install, repeat install, and real staging
tarball install passed. All six engine startups passed in the image and installed bundles; the
installer/availability suites passed 47 tests. Packaging rejected a test seed, wrong core pin and wrong
Domain layer before copying any file. Smoke checks prove loading and startup; the rule coverage limits
below still apply. The workflows were checked locally, without deploying or pushing.

The deployment-review changes were checked separately with a synthetic bundle: the named-context
image build verified `/opt/duel-engine` in place, with no engine copy in `/app/data` or the application
context. This check covered image packaging and capability reporting; it did not execute real duels.

## Normal use

New duels save `setup.firstTurnDraw`, the resolved `DUEL_1ST_TURN_DRAW` flag, when they start.
Worker recovery and all journal replay paths use this saved flag. The engine resource pin still checks the
bundle and Lua overlay. A rule change alone does not change an existing duel's draw flag.

The legacy 1v1 engine uses the stock Master Rule draw rule in Standard and Domain:
MR1/MR2 draw on turn 1; MR3-MR5 do not. The pinned engine draws on turn 1 in every
Domain seat layout. Standard on the pinned engine uses the stock Master Rule draw rule.

Old records have no saved flag. Production ran `main`; after migration, all its old duels are 1v1
and need no action. Before 2026-10-02 (this change), staging ran this branch before and after `0fb46df`,
but never `d4338a2` or a later commit.
Only FFA gained the new draw rule at `0fb46df`. Standard and Domain
1v1 and Tag therefore used the stock Master Rule draw flag: MR1/MR2 drew on turn 1; MR3-MR5 did not.
The server infers those old rules. No backfill is needed for Domain 1v1 or Tag records.

Only Standard and Domain FFA records with no flag are ambiguous: before `0fb46df` they skipped the
turn-1 draw; after it they drew. The resource pin did not change. A creation date does not prove which
server version started a duel. Recovery interrupts an ambiguous active duel and emits the status change.
Recovery and replay refuse these records with this message:
"The first-turn draw rule was not saved for this duel. Its old rule cannot be determined safely; recovery
and replay are unavailable." The saved final board remains available.

Before a staging deploy, use the read-only query in [the runbook](vm-runbook.md#first-turn-draw-records-2026-10-02)
to find ambiguous active FFA duels and let them finish. The FFA repair is for staging only.
To restore an old replay, first establish the server
rule used at its start from deployment records, then save the flag in its setup: `true` for Standard or
Domain FFA under `0fb46df`, `false` for either FFA mode before that change. The per-row SQL statement is
in [the runbook](vm-runbook.md#first-turn-draw-records-2026-10-02). Do not set an old flag from
the current mode or creation date alone. This change does not alter existing database rows.
Rollback: an older server ignores the key and can drop it on its next setup write. Keep a backup of the
saved flags; a later upgrade can again refuse an FFA record whose flag was lost.

**Developers:** Local/test databases that ran builds from `d4338a2` up to, but not including, `42e66c3`
may hold Domain 1v1/Tag duels with no saved flag. These duels drew on turn 1.
Interrupt or delete those duels, or set the flag to `true` with this statement for each verified local/test row.

```sql
UPDATE duels
SET setup_json = json_set(coalesce(setup_json, '{}'), '$.firstTurnDraw', json('true'))
WHERE web_slug = '<verified-local-duel-slug>'
  AND guild_id = '<verified-guild-id>'
  AND mode = 'domain'
  AND format IN ('1v1', 'tag')
  AND seed_json IS NOT NULL
  AND json_extract(setup_json, '$.firstTurnDraw') IS NULL;
```

- **Update staging to a newer commit.** Push the branch. Run the workflow again with `action` = `deploy`.
  The staging database is kept. Staging is stopped during a deploy, so a duel that is running in staging at that time
  is set to `interrupted` (the engine install refuses a new bundle while a duel is active).
- **Refresh the database from production.** Run the workflow with `refresh_db` on. Staging duels and anything
  else that was only in staging are lost. Active duels in the copy are set to `interrupted`.
  The old staging database stays as `data-staging/bot.sqlite.before-copy` (one older copy).
- **Stop staging.** Run the workflow with `action` = `stop`. This removes the staging containers and the staging network.
  The data folder stays. The three images that staging built are removed. It does not touch production.
- **Start it again.** Run `deploy` again.
- **Look at the logs.** On the VM: `cd /opt/yugioh-bot-staging && sh scripts/staging/compose.sh logs -f --tail=100 duel`
  (or `web`, `ws`, `caddy`).
- **Change the address or the ports.** On the VM, delete `/opt/yugioh-bot-staging/.env.staging`, change the repository
  variables, and run `deploy`. A new file gets new internal secrets.
- **Remove staging completely.** Stop it. Then on the VM:
  `rm -rf /opt/yugioh-bot-staging`. The stop already removed the staging images.
  Take the port out of the Hetzner firewall and the redirect out of Discord.

## Limits for testers

- **Standard and Domain support FFA3, FFA4 and Tag once this bundle is deployed.** A missing core still
  closes the corresponding start guard. Domain uses `ocgcore.multi-domain.wasm`; deploying an older
  workflow that ships only the plain core leaves Domain blocked.
- **Rules that are not proven by a test yet.** `docs/specs/multiplayer-rule-coverage.md` lists 19 rules that have no outcome
  test yet (8 are covered). In plain words, five groups. Cards that rely on them can behave wrongly:
  1. Cards that say "opponent", "each player" or "all" (separate fields, Extra Monster Zones, picking an opponent for hand
     and Deck effects, ongoing effects on opponents, the Forbidden and Limited list per Deck).
  2. Chains and triggers at 3 and 4 seats (who may respond first, trigger order) and the response order in Tag.
  3. Negation and lock cards (for example Solemn Judgment, Jinzo).
  4. Tag partners (sharing cards and costs, the partner is not an opponent, seeing the partner's hand).
  5. Tag loss and turn-count cards (a team loss from an empty Deck, Final Countdown).
- The legacy Standard 1v1 engine uses the older npm core. Staging defaults to the legacy 1v1 engine, as production does (`STAGING_DUEL_1V1_ENGINE=pinned` tests the merged one);
  multiplayer games load the separately built multi cores.
- Staging has a copy of the production database. Testers sign in with their real Discord accounts, and the guild check applies.
- Staging has its own `NEXTAUTH_SECRET`. A sign-in made in staging is not valid in production, and the other way round.
  Sign-in cookies are tied to the host name, not to the port. At the same IP address, a sign-in on staging replaces the
  production cookie in that browser, and the production page then asks to sign in again. This is only a nuisance.
  A separate host name for staging (a second DNS name for the VM) stops it.

## Test tools in staging (warning for testers)

Staging runs with `DUEL_SCENARIOS=1` on the duel service and on the web service. This opens tools that production
does not have:

- **Report button** in the duel room. It writes a report folder on the VM (`data-staging/duel-reports`) with your note,
  the journal and the debug trace.
- **Stall reports.** The duel server writes a report by itself when a duel makes no progress for 30 seconds while the
  core or a bot seat must act.
- **Scenario presets.** The page `/duels/dev-presets` and the route `/api/duels/preset` make a ready table with bot seats
  from a preset and start it. Use them only for the checks you are asked to do.
- **Debug trace.** The route `/api/duels/<room>/debug-trace` shows every seat view of a duel. WARNING: it can show hidden
  cards (the hands of all players, the Deck order and face-down cards). A player of the duel can open it. Do not open it during a
  real test, and do not read it to find the cards of an opponent. The Report button puts the same data in the report folder,
  so the owner can read it. Do not press Report for a reason other than a problem.

Staging is a test place. Do not use these tools in production: the production stack does not set `DUEL_SCENARIOS`.

The multi core in staging is a production-like build: it is built without `LUA_FIXED_SEED` (the test flag that makes the
Lua random numbers repeatable). `test.yml` keeps the flag, because tests need repeatable results.

## Tester notes

- Standard and Domain are available at 3 or more players after deployment of both multi cores.
- The special card rules for 3 or more players are not built yet. These cards can act wrong:
  - Kaiju, Lava Golem, Volcanic Queen, Ra (Sphere Mode).
  - Cards that summon to the field of an opponent (Ojama Trio, Jormungardr, Grinder Golem and about 100 more).
  - Cards that count and compare (Evenly Matched, Pineapple Blast).
  - Cards that say "your opponent chooses".
  - Dice and coin cards of the duel type.
  - Messenger of Peace, Snatch Steal, Royal Tribute, Soul Exchange.
- These rules have no full outcome test yet. Report anything odd:
  - Effects that say "all" or "each player" (Dark Hole, Raigeki).
  - Ongoing locks (Jinzo).
  - Negation (Solemn Judgment, Ash Blossom).
  - The order of triggers that happen at the same time.
  - Extra Monster Zones and Link zones.
- At 3 players, the turn of every other player counts as one opponent turn. This is an owner rule. It is not a bug.
- A frozen duel cannot be ended from the page. Send the room link to the owner.
- A staging deploy stops the duels that run at that time. They are marked `interrupted`.
- When you find a problem, write: the room link, the turn, the card, what you did and what you expected.
  Then press Report.

## Test script (3 players)

Do the steps in this order. Write down the result of each step. Report every step that does not match.

1. Make a 3-player free-for-all Standard table. First try a deck with Ring of Destruction or Swords of Revealing Light.
   Expect a refusal. Then use legal decks.
2. Start the duel. Expect: the seat order is shown. Standard MR5 skips only the turn-1 draw (p0 has 5 cards).
   Domain in every seat layout draws on turn 1 (p0 has 6 cards with default settings).
   Standard MR1/MR2: the first duelist draws (where the core allows MR1/MR2).
   Standard MR3/MR4/MR5 skip only the turn-1 draw.
   Standard FFA uses MR5 only; the core rejects MR1-MR4 with more than 2 duelists.
3. Turns 1 to 3: there is no attack option. Attacks start on turn 4.
4. The turn passes in the order 0, 1, 2, 0. The "To play" and "Choosing" tags follow the turn.
5. Attack when one opponent has monsters and one has none. Expect: the targets are right, a direct attack is possible only
   on the opponent with an empty field, and the right player loses LP.
6. Use Mind Crush or a burn card. Pick one living opponent. Expect: only that player is hit.
7. Use Ojama Trio or a card that disables zones. Expect: only the zones of the picked opponent are changed. Write down
   where the tokens go.
8. Use Raigeki: it clears every opponent. Use Dark Hole: it clears all fields.
9. Make a chain with 3 players (A, then B, then C). Use Solemn Judgment against another player.
10. Reload the page while a prompt is open. Expect the same prompt. Then close the tab for 1 minute and come back.
11. A player who has no prompt surrenders. Expect: that player is Eliminated, the cards leave the field, the turns of
    that player are skipped, and the duel goes on.
12. Make a second duel with a short timer. Let the timer run out (a timeout is a loss). Expect: only that player is eliminated.
13. Reduce a player to 0 LP by battle in your own turn. Expect: your turn continues, and the next turn goes to the next
    living player.
14. Finish the duel. Expect: all players see the right winner and the right reason, and the history shows it.
15. Play a short 1v1 Standard duel and a short 1v1 Domain duel. Expect: Domain p0 draws on turn 1. Standard MR3/MR4/MR5 p0 skips the draw; Standard MR1/MR2 p0 draws.

## Open risks

- **RAM.** See the memory section. A very busy production plus a staging duel can still use all 4 GB. The limits and
  `oom_score_adj` make the kernel stop staging first, but nothing can promise it.
- **Disk.** Three staging images and the Docker build cache use several GB. The build cache is shared with production, so
  the workflow does not prune it (`docker builder prune` or `docker system prune` would also hit production). The workflow
  stops below 6000 MB free before the build and below 2500 MB after it, removes the old staging images after each healthy
  start, and deletes the staging card image cache. The disk also holds the production SQLite file: a full disk breaks production.
- **Database copy on a read-only mount.** If the VM has no `python3`, the copy runs `node` inside the staging duel image with
  the production data folder mounted read-only. This path is not tested with a live WAL database.
- **First-run clone.** It uses the git remote address of `/opt/yugioh-bot`. If that address needs a key that only works from there, the clone fails and you
  must clone `/opt/yugioh-bot-staging` by hand once.
