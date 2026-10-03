#!/usr/bin/env bash
# Production builds only: both deploy cores, using pins.json and the full patch series.
# Run on the CI runner; compilation happens in the pinned emsdk container, never on the VM.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
builder_commit="$(git rev-parse HEAD)"
image="$(node -p "const e = require('./packages/duel-server/domain-core/pins.json').emscripten; e.image + '@' + e.digest")"
docker pull "$image"
for mode in multi multi-domain; do
  args=()
  if [[ "$mode" == multi-domain ]]; then args+=(-e APPLY_DOMAIN=1 -e DOMAIN_MULTI=1); fi
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
    -e MULTI_TREE=/src/packages/duel-server/domain-core/.build/multi-core-tree \
    -e OUT_NAME="ocgcore.$mode.sync.wasm" "${args[@]}" \
    -v "$root":/src -w /src "$image" \
    bash packages/duel-server/scripts/build-multi-core.sh
  # Cache this identity with the artifact. A later deploy may restore it under a different HEAD.
  BUILDER_COMMIT="$builder_commit" BUILD_INFO_PATH="packages/duel-server/domain-core/dist/ocgcore.$mode-build-info.json" \
    node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.env.BUILD_INFO_PATH;
const info = JSON.parse(readFileSync(path, "utf8"));
info.builderCommit = process.env.BUILDER_COMMIT;
writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`);
NODE
done
