# Staging status and local engine checks

Staging is removed; it returns later on a separate server.

The staging workflow, Compose file, Caddy file and deployment scripts are removed.
Restore them from git only when the separate server is ready. The shared engine
pins and local build checks below remain in use.

## Engine files and image build

Production prepares the pinned 1v1 bundle and both multiplayer cores in GitHub Actions.
The deploy bundle includes a checksum and source record for each multiplayer core.
The `duel-bundled` image uses that bundle through the named `engine` context.
The VM pulls the image and installs the matching bundle before starting services.
See [the deployment pipeline](vm-runbook.md#deployment-pipeline) for the full procedure.

## Engine pins

| Pinned core | SHA-256 |
| --- | --- |
| Standard multiplayer | `eff21477fbb40b0c5a1cf0429642b4aebcf4d7c5ade3a99e2c3f02556deaf9ae` |
| Domain multiplayer | `4c4dccb31589893eedcc1a21f75d4fa3c5b6863a1d875f5d062604a1315db383` |
| Domain 1v1 | `01611db77c00ddef07a3d4cfc88800f5c523e3a388c3732616a79fa19b3c4a63` |

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
