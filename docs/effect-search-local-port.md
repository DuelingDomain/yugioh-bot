# Effect search local port

The branch is `port/effect-search`. Its parent is
`e6ae83c4e0233887948a9869d4afd0b793b0aeae` on `test/local-all`.
The source is `a99d174e7a85507592e241565be73904f947a4a6` on
`feat/effect-search`. The exact source base is
`27721b01744d182e59567222e09c32e25b880a82`.

The port includes effect search, works-with results, cube tools, smart draft
picks, and release dates. It uses NextAuth and text Discord IDs. Tests use
`players` rows and the local session shapes. It keeps the sandbox access rule,
the theme draft flag, the local HTTP transport, and the searchygo credit.
No new unit tests were added.

The port was made in `es-port`. The `local-all` checkout and its services were
not changed. No `.env` file was read. No engine data was changed. No push was
made.

## Checks

All commands used Node 22.23.3 and `prlimit --core=0`.
Vitest used `--maxWorkers=1`. Web tests used the web configuration.

| Check | Result |
| --- | --- |
| `npm ci` | Passed |
| Shared build | Passed |
| TypeScript: shared, web, duel server, E2E, effect scripts | Passed |
| Six shared and tagging integration files | 113 passed; one optional benchmark skipped |
| Duel effect integration file | 72 passed |
| Web effect integration files | 40 passed |
| Standalone startup integration file | 1 passed |
| Existing sandbox, theme, and pick route checks | 111 passed |
| Effect search and smart pick browser tests | 33 passed, including 5 login checks |

The evaluation completed all 69 queries. It recorded 93 positive labels and
79 negative labels. It recorded no false positives or false negatives.
The evaluation passed with both the original engine catalog and the
`engine-facing` catalog used by the local stack. These results apply to the
labelled candidate pools.

The browser checks used 1920x1080, 2560x1440, 1366x768, and 390x844.
They checked search, works-with, dates, cube batch import, phrase seeds, draft
pools, theme lobbies, and smart picks. They checked stable hover positions,
card badge separation, and summaries without an "AI" label. The credit stays:
`Effect search powered by searchygo`.

Evidence remains in `.status/effect-search/eval.json`,
`packages/e2e/.stack-8/test-results/`, and `/tmp/es-port-ui/`.
Build output and TypeScript build caches are removed after the checks.
`node_modules` remains.

## Artifact and deployment issue

The effect artifact is in `packages/shared/data/effects/`. Its version is
`7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`.
`duel:prepare` does not need to download this artifact. To verify it, run:

```bash
prlimit --core=0 -- python3 packages/duel-server/scripts/verify-effect-artifact.py
```

One deployment issue must be handled after a fresh `npm ci`. The existing
engine manifest pins wrapper hash
`1098364ea36ff76c52b5d2f26ace3ec53db9bc6d10009b772c3626ce03dc990d`.
The wrapper from the checked-in patch has hash
`fa6c3ada17d25135406af675b151c02af4fd052d6c476fb6e40909b0cfcb87cb`.
The port does not change that patch. The existing installed wrapper and the
fresh install differ.

The browser test stack used `prepareManualData` to check the installed patch
and make a separate manifest in `/tmp/es-port-engine`. Its engine files are
read-only links. Engine verification remained active. The coordinator can use
the same method for `engine-facing`, as shown below.

## Coordinator steps

Only the coordinator must run these commands. Check that the target has no
tracked edits before the merge. If the fast-forward fails, keep both branches
and check the new target history.

```bash
cd /home/sulman633/orca/workspaces/yugioh-bot/local-all
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
git status --short
git merge --ff-only port/effect-search

systemctl --user stop yugidraft-web-local.service yugidraft-duel-server.service
prlimit --core=0 -- npm ci
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npm run build --workspace=packages/duel-server
prlimit --core=0 -- python3 packages/duel-server/scripts/verify-effect-artifact.py
EFFECT_SEARCH=1 NEXT_PUBLIC_WS_URL=http://localhost:3002 NEXT_TELEMETRY_DISABLED=1 prlimit --core=0 -- npm exec --workspace=packages/web -- next build --webpack
prlimit --core=0 -- npm run package:standalone --workspace=packages/web

prlimit --core=0 -- node --input-type=module -e 'import { prepareManualData } from "./packages/e2e/stack/manual-data.mjs"; prepareManualData("/home/sulman633/repos/yugioh-bot/data/engine-facing", { outputDirectory: "/home/sulman633/orca/workspaces/yugioh-bot/effect-search-runtime" });'

cp -a packages/web/.next/standalone/. /home/sulman633/orca/workspaces/yugioh-bot/web-live/
mkdir -p /home/sulman633/orca/workspaces/yugioh-bot/web-live/packages/shared/data
cp -a packages/shared/data/effects /home/sulman633/orca/workspaces/yugioh-bot/web-live/packages/shared/data/

mkdir -p /home/sulman633/.config/systemd/user/yugidraft-web-local.service.d
mkdir -p /home/sulman633/.config/systemd/user/yugidraft-duel-server.service.d
cat > /home/sulman633/.config/systemd/user/yugidraft-web-local.service.d/zzzz-effect-search.conf <<'EOF'
[Service]
Environment=EFFECT_SEARCH=1
Environment=DUEL_DATA_DIR=/home/sulman633/orca/workspaces/yugioh-bot/effect-search-runtime
EOF
cp /home/sulman633/.config/systemd/user/yugidraft-web-local.service.d/zzzz-effect-search.conf /home/sulman633/.config/systemd/user/yugidraft-duel-server.service.d/zzzz-effect-search.conf

systemctl --user daemon-reload
systemctl --user restart yugidraft-duel-server.service yugidraft-web-local.service
systemctl --user is-active yugidraft-duel-server.service yugidraft-web-local.service
curl -fsS -o /dev/null http://localhost:3000/login
```

The web unit serves the separate `web-live` build. A branch merge alone does
not update that build. Both units need runtime `EFFECT_SEARCH=1`.
The commands keep the current sandbox and theme draft settings. Keep the
runtime build files that these services use.
