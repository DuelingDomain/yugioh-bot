#!/usr/bin/env bash
# Production builds only: both deploy cores, using pins.json and the full patch series.
# Run on the CI runner; compilation happens in the pinned emsdk container, never on the VM.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
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
done
