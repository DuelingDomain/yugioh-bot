# Manual FFA stack

Run these commands from your own isolated worktree.
This starts a local web, websocket server, and real duel host, with no Playwright test run.

## Concurrent slots (manual or Playwright)

Set `E2E_SLOT=N`, where N is one digit from 0 through 9. Each concurrent run needs
a different slot, including manual stacks. Slot 0 is isolated too. Unset preserves
the existing ordinary ports (`3300`, `3302`, `4302`, `4303`) and manual ports
(`3400`, `3402`, `4402`, `4403`), with `.stack` and `.next`.

| Service | Slot N default | Slot 1 | Slot 2 | Slot 3 |
| --- | --- | --- | --- | --- |
| Web | `3301 + 10*N` | 3311 | 3321 | 3331 |
| Public websocket | `3303 + 10*N` | 3313 | 3323 | 3333 |
| Internal websocket | `4304 + 10*N` | 4314 | 4324 | 4334 |
| Duel host | `4305 + 10*N` | 4315 | 4325 | 4335 |

All ten default families are disjoint and avoid ordinary, manual, and live ports.
On an 8-CPU machine, run at most **4–5 slots in parallel**, with
**`E2E_WORKERS=1` per slot** during parallel batches. Available slot numbers are
an isolation mechanism, not a recommended concurrency level. Start with fewer
slots when other workloads are running; browser and engine contention can
exhaust action and test timeouts even when the ports are separate.
Explicit `E2E_WEB_PORT`, `E2E_WS_PORT`, `E2E_WS_INTERNAL_PORT`, and `E2E_DUEL_PORT`
still win; callers choosing overrides must keep them disjoint. Occupied and live
ports are refused. Empty, fractional, padded, and out-of-range slots are rejected.

Each slot owns `packages/e2e/.stack-N/`, containing `e2e.sqlite`, `logs/`,
`reports/`, card images, manual runtime data, `supervisor.pid`, `manual.json`, `browsers/`, `.auth/`,
`test-results/` (including traces, videos, screenshots, and the failure index),
`playwright-report/`, `.status/e2e-results.json`, and `.status/e2e-multi/` evidence.
The ws and duel children use private `.stack-N/ws` and `.stack-N/duel` working
directories; temporary files go to `.stack-N/tmp`.
Preset issue badges read the shared `.status/issues/` inbox without writing to it.

The web build lives in `packages/web/.next-e2e-N/`. Its standalone entry point is
`.next-e2e-N/standalone/packages/web/server.js`; the `.e2e-build.json` stamp sits
beside that server. Prepare passes `E2E_NEXT_DIST_DIR` to Next and the standalone
asset packager. With that variable unset, production and Docker still use `.next`.
Each slot bakes its own `NEXT_PUBLIC_WS_URL`. `E2E_STANDALONE_DIR` remains an
explicit override for a copied, already matching standalone build.

**Before launching parallel workers, build shared services once in the foreground:**

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/duel-server
npm run build --workspace=packages/ws
export E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap"

# Optional: prebuild each slot's web once before the test batch.
E2E_SLOT=1 npm run stack:build --workspace=packages/e2e
E2E_SLOT=2 npm run stack:build --workspace=packages/e2e
E2E_SLOT=3 npm run stack:build --workspace=packages/e2e

# Separate terminals/workers, all from the same worktree:
E2E_SLOT=1 E2E_WORKERS=1 npm run e2e --workspace=packages/e2e -- <spec>
E2E_SLOT=2 E2E_WORKERS=1 npm run e2e --workspace=packages/e2e -- <spec>
E2E_SLOT=3 E2E_WORKERS=1 npm run e2e --workspace=packages/e2e -- <spec>
```

General parallel invocation: `E2E_SLOT=N E2E_WORKERS=1 npm run e2e --workspace=packages/e2e -- <spec>`.
Prepare skips fresh shared/service/web output. Shared freshness requires a build
after changes to its source or config; service freshness also checks shared dist.
With `E2E_SLOT` set, stale ws or duel-server output is refused: build each service
once before starting the parallel batch. Prepare never rebuilds shared service
output in slot mode, including when `E2E_FORCE_BUILD=1` requests a web rebuild.
Do not edit source/config or rebuild shared/service dist during a parallel batch.
`E2E_FORCE_BUILD=1` is for a serial rebuild, never a parallel batch.
Prepare and manual start refuse a running `supervisor.pid` and probe all stack
ports before building. Startup claims its PID under the same web build lock;
the PID remains until all children stop. Stop a slot before rebuilding its web.

Web builds are serialized with `packages/e2e/.stack-build-lock` because Next also
writes `next-env.d.ts` and `tsconfig.json`. Slot builds restore those files and
their mtimes before stamping success. This serialization affects preparation;
the resulting stacks and tests run concurrently. Do not run a separate web build
or web typecheck during preparation. SIGINT/Ctrl+C and SIGTERM are forwarded to
the build processes; prepare then restores configuration and releases its lock.
Prepare recovers a stale lock automatically when its holder PID no longer exists.
It waits as long as a holder PID is alive; only locks without a valid PID have a
ten-minute wait limit.
Slot builds use **Webpack, not Turbopack**, including with ordinary dependencies.
Webpack supports borrowed dependencies outside the worktree's filesystem root.
Ordinary unset E2E and production builds continue to use Turbopack.

**Before a release, run at least one unset E2E run with Turbopack.** Slot-only
validation does not cover the production bundler. Use a checkout with dependencies
inside its filesystem root, and force the ordinary build before the run:

```bash
env -u E2E_SLOT -u E2E_NEXT_DIST_DIR E2E_FORCE_BUILD=1 npm run e2e --workspace=packages/e2e
```

Select the same slot for manual start, login, report, and failure-index commands:

```bash
E2E_SLOT=2 npm run stack:manual --workspace=packages/e2e
E2E_SLOT=2 npm run stack:login --workspace=packages/e2e -- p1
E2E_SLOT=2 npm run e2e:report --workspace=packages/e2e
E2E_SLOT=2 npm run e2e:index --workspace=packages/e2e
```

Ordinary E2E retains its strict bundle checks. If a read-only snapshot pins a
different wrapper, use the existing `E2E_MANUAL=1` mode for its verified local
runtime manifest (and real-image behavior), or supply an already matching bundle.
Manual wrapper verification checks a temporary copy of the installed bytes against
the checked-in patch, so borrowed dependency symlinks remain read only.

## Refresh a branch-local strict snapshot

Stop this worktree's slots first. Keep the donor snapshot unchanged. If
`data/duel-engine-snap` already exists, move it aside before refreshing; the tool
refuses to overwrite it. Use a legacy engine bundle containing
`ocgcore.domain.legacy.wasm` and `card-scripts/domain.legacy.lua`:

```bash
E2E_SLOT=1 node packages/e2e/stack/refresh-snapshot.mjs \
  /path/to/read-only/duel-engine-snap /path/to/legacy-engine-bundle
export E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap"
env -u E2E_MANUAL E2E_SLOT=1 E2E_WORKERS=1 \
  npm run e2e --workspace=packages/e2e -- tests/duel-presets-multi.spec.ts --retries=0
```

The tool copies the donor cores and card scripts into real directories, checks
the legacy bytes against `legacy-1v1/expected-sha256.txt`, verifies the installed
wrapper against the checked-in patch, and regenerates the manifest using
`duel:prepare`. It refreshes the repo's multiplayer Lua overlay and verifies both
pinned and legacy bundles before installing the snapshot. It requires fresh
duel-server dist and never rebuilds the services. Directory symlinks must not be
used for card scripts: the legality scanner skips them. `data/` is gitignored;
keep this local snapshot for strict E2E runs without `E2E_MANUAL=1`.

## Start

Keep the engine snapshot read only. Select it explicitly; adjust the path if it lives elsewhere:

```bash
export E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap"
npm run build --workspace=packages/shared
npm run stack:manual --workspace=packages/e2e
```

Leave that terminal running. With `E2E_SLOT` unset, the manual entry point builds stale services and the production web;
with a slot set, it requires fresh service builds and prepares that slot's Webpack web output. It
then supervises them until Ctrl+C. Wait for the web to report `Ready`; check readiness from another terminal:

```bash
curl --fail http://localhost:3400/api/auth/session   # 200 with body null before login
```

Defaults:

| Setting | Value |
| --- | --- |
| Web | `http://localhost:3400` |
| Websocket | `http://localhost:3402` |
| Internal websocket / duel host | `4402` / `4403` |
| `E2E_DUEL_DATA_DIR` | `<worktree>/data/duel-engine-snap` |
| `MULTIPLAYER_TABLES`, `DUEL_SCENARIOS` | `1` |
| `DUEL_FX_LAB` (web) | `1` here and in every ordinary e2e stack |
| `DUEL_1V1_ENGINE` | `pinned` |
| `DUEL_BOT_STEP_MS` | `900` (override with `E2E_BOT_STEP_MS`) |

Override ports with `E2E_WEB_PORT`, `E2E_WS_PORT`, `E2E_WS_INTERNAL_PORT`, and `E2E_DUEL_PORT` **on the manual command**.
It builds with the matching websocket URL. `E2E_SKIP_BUILD=1` is only for an already matching build.
Ports `3000`, `3001`, `3002`, `3100`, `3110`, `4001`, `4002`, `4003`, and `4010` are refused,
as are occupied ports. Do not change `data/services/duel.env`, live engine data, or `yugidraft-*` services.

The source manifest may pin the engine branch's wrapper while the merged UI has a different checked-in wrapper patch.
In that case manual mode verifies the installed wrapper against that patch and creates `.stack/manual-duel-data`:
symlinks to the unchanged snapshot files and a derived manifest with the local wrapper hash and bundle version.
No source manifest, core, or Lua script is changed. Normal e2e mode keeps its original integrity checks.

Set `E2E_CARD_IMAGE_SOURCE_DIR=/path/to/cache` on the manual command to read real art from that **read-only source**.
`CARD_IMAGE_CACHE_DIR` also selects a source when `E2E_CARD_IMAGE_SOURCE_DIR` is unset.
When neither is set, startup warns that card art will download from YGOPRODeck. Missing cached cards also download there.
Downloaded art is written only into `packages/e2e/.stack/manual-card-images`.
Normal e2e runs keep tiny stub images in their separate `.stack/card-images` cache.

With `E2E_SLOT` unset, manual and ordinary e2e supervisors share `.stack/e2e.sqlite`;
run them one at a time. A chosen slot likewise permits only one supervisor at a time.
Each startup resets this isolated database. It seeds p1–p4, each with:

- `Manual Standard · EARTH normals`: 40 unique low-level EARTH Normal Monsters.
- `Manual Domain · Axe Raider`: 60 unique EARTH Normal Monsters and Axe Raider as Deck Master.

Both come from the real host's practice-deck builder and use the copied card database.

## Log in

Chromium must be installed for Playwright (`npx playwright install chromium` once).
Run each player in a separate terminal on a machine with a graphical display:

```bash
npm run stack:login --workspace=packages/e2e -- p1
# Other terminals, if needed:
npm run stack:login --workspace=packages/e2e -- p2
npm run stack:login --workspace=packages/e2e -- p3
npm run stack:login --workspace=packages/e2e -- p4
```

Equivalent from `packages/e2e`: `node stack/login.mjs p1`.
Each opens a headed persistent browser, authenticates through the E2E credentials provider,
checks the session's player id, and opens `/duels/new`. Profiles live in `.stack/browsers/pN`.
The helper discovers the running stack's URL and throwaway auth secret from `.stack/manual.json` (mode `0600`).
The supervisor deletes that login handoff on shutdown. No Discord OAuth redirect registration is required.

## Play FFA3 with two bots

1. As p1, open `http://localhost:3400/duels/new`.
2. Enter a table name, choose the 3-player free-for-all (`ffa3`) under **Table type**, and choose **Standard**.
   Use **Unlimited** for the turn timer when exploring. Create the game.
3. In the lobby choose `Manual Standard · EARTH normals` under **Use a saved deck**,
   then click **Ready with this deck**.
4. Click **Add bot** in each of the two open seat rows (seats 2 and 3).
   Each bot receives a legal deck and is ready automatically.
5. Once all three seats are ready, click **Start duel**. If prompted to open a separate window,
   choose **Open here instead** to play in the existing tab.
6. Make choices in the table prompts; bots act at a readable pace. The host uses the real n-seat core.

For Domain, choose **Domain** at creation and use `Manual Domain · Axe Raider`.
For another human, open the room link in their logged-in player window, take an open seat,
choose their saved deck, and ready up. FFA4 uses the same stack and one more seat.
Tag (2v2) and the shared FFA4 Extra Monster Zone are outside this task's validation.

Other useful pages:

- Presets: `http://localhost:3400/duels/dev-presets`.
- Fixture table: `http://localhost:3400/dev/table-preview/ffa3` (no engine).

## Stop and clean up

Close each login browser or press Ctrl+C in its terminal. Press Ctrl+C in the stack terminal;
the supervisor sends SIGTERM to all three children and waits, with a bounded SIGKILL fallback.
Then remove the generated build, database, downloaded images, profiles, and logs:

```bash
rm -rf packages/web/.next packages/e2e/.stack
```

For a slot, stop its run first and delete only its output, for example
`rm -rf packages/web/.next-e2e-2 packages/e2e/.stack-2`. Leave other workers' slots
and the read-only snapshot alone. Remove shared dist only after all slots stop.

Delete any Playwright traces or screenshots you created. Keep `data/duel-engine-snap` for the later test stage;
only the final owner cleanup deletes it. All runtime directories and `data/` are git-ignored.

## Concurrent-slot proof on 2026-10-02

Shared, duel-server, and ws were each built once, then web slots 1–3 were built
once. All three runs were launched together and awaited in the foreground. Each
ran the same real-core test: `tests/duel-3p-ffa-table.spec.ts --grep 'mounts three own-EMZ'`.

The environment for each was:

```bash
E2E_SLOT=N E2E_WORKERS=1 E2E_MANUAL=1 E2E_BOT_STEP_MS=900 \
E2E_DUEL_DATA_DIR="$PWD/data/duel-engine-snap" \
E2E_CARD_IMAGE_SOURCE_DIR="$PWD/packages/e2e/.stack/manual-card-images" \
npm run e2e --workspace=packages/e2e -- tests/duel-3p-ffa-table.spec.ts --grep 'mounts three own-EMZ'
```

Manual mode was needed because the source snapshot pins a different wrapper;
each slot derived its verified manifest locally and read the existing art cache.
Both sources stayed read only. No production engine data or services were used.

Captured Playwright output:

```text
slot 1: 5 passed (28.6s)
slot 2: 5 passed (27.9s)
slot 3: 5 passed (29.3s)
```

Each count is four credentials-provider setup tests plus one real FFA3 browser
test (three fields, own EMZs, Standard first draw, first-round turn/Battle Phase
rules). There were zero failures, skips, or retries in this successful batch.
The batch ran from `22:57:51.088Z` to `22:58:20.919Z`; at `22:57:54.159Z` all
12 service ports were listening simultaneously. Every prepare log said shared,
ws, duel-server, and its own web build were up to date.

Before/after fingerprints confirmed shared dist contents/mtimes and all three
web build stamps unchanged. A recursive content fingerprint of the entire source
snapshot also stayed unchanged. Database inodes were distinct (1220507, 1220567,
1220570). Each slot held its own four auth files, test results/index, HTML report,
and JSON report. All 12 slot ports were free afterward; each manual login handoff
was removed. The existing 3300 stack and live ports were left alone.

`npm run test:unit --workspace=packages/e2e`: **42 passed, 0 failed**.
`npm run typecheck --workspace=packages/e2e`: passed. All three production web
builds typechecked successfully. The helper test checks every slot 0–9 and confirms
unset still resolves to web 3300, `.stack`, `.next`, and all legacy output paths.

An earlier simultaneous attempt with `E2E_BOT_STEP_MS=120` passed all credentials
setups but failed this spec's browser turn-3 observation in every slot. The real
engine reached turn 4; no port/database clash or build mutation occurred. The same
spec passed in all slots with the readable 900 ms pace. The full E2E suite, all ten
slots as live stacks, and headed manual login in each slot were not run.

Generated builds, slot stacks/results, proof logs, shared service dist, and the four
borrowed dependency symlinks are removed at completion; the worktree is retained.

## Earlier manual-stack verification on 2026-10-02

- `npm run test:unit --workspace=packages/e2e`: 27 tests passed, including manual defaults/port exclusions,
  image passthrough versus normal e2e stubs, player-owned saved decks, credentials login, and immutable snapshot handling.
- `npm run typecheck --workspace=packages/e2e` and the production stack build passed.
- **Manual FFA3 startup with real art**: one API smoke passed as p1, room `00hhqej5`, two bots, status `active`.
  Deck validation/submission, ready, both bot additions, start, room view, and debug trace all returned HTTP 200
  (table creation returned 201). The host supplied three seat views, each with three seats,
  and reported `ocgcore.multi.wasm`, SHA `896d6528b16227e1702088c42da8570a6c394be9c0dd93ad4f2aac9951e5c22e`.
- All four real E2E credentials sessions worked and listed two seeded decks each. The Domain saved deck passed
  the real FFA3 host's legality checks with no issues.
- **Browser FFA3 render**: one smoke passed, HTTP 200, visible Duel field, LP seats 0/1/2, real 268×391 art,
  and zero page errors. Card `69247929` also returned full 813×1185 art (160,063 bytes), HTTP 200.
- **Headed p1 login**: one launch passed using `npm run stack:login --workspace=packages/e2e -- p1`.
- **Manual shutdown**: all four isolated ports were free and `.stack/manual.json` was removed after Ctrl+C.

These checks prove startup and rendering. A complete played match, FFA4 gameplay, and Domain gameplay remain
for the later smoke stage. The transient smoke database, browser profiles, logs, and web build were deleted;
the source core snapshot was retained.
