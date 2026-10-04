#!/usr/bin/env bash
# One isolated CI build. Serial mode exists only for clean hash-parity checks.
set -euo pipefail
target="${1:?core target required}"
case "$target" in
  standard|domain|legacy-domain|multi|multi-domain|multi-ref|multi-ref-domain|multi-trap) ;;
  *) echo "unknown core target: $target" >&2; exit 1 ;;
esac
out="${CI_CORE_OUTPUT:-ci-core}/$target"
mkdir -p "$out/bundle" "$out/dist"
printf '{"sources":{},"integrity":{}}\n' > "$out/bundle/manifest.json"
pins=packages/duel-server/domain-core/pins.json
if [[ "$target" == legacy-domain ]]; then pins=packages/duel-server/legacy-1v1/domain-core/pins.json; fi
image="$(node -p "const e=require('./$pins').emscripten; e.image+'@'+e.digest")"
docker pull "$image"
docker run --rm --ulimit core=1:1 --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e DOMAIN_ROOT=/src -e "DUEL_DATA_DIR=/src/$out/bundle" \
  -e "CI_SERIAL=${CI_SERIAL:-0}" \
  -v "$PWD":/src -w /src "$image" bash -c '
    set -euo pipefail
    target="$1"
    # The emsdk entrypoint clears EM_CACHE. Set it after startup so Actions can restore it.
    export EM_CACHE=/src/.cache/emscripten
    export EMCC_CORES="$(nproc)"
    if [[ "$CI_SERIAL" != 1 ]]; then
      export CI_REAL_EMXX="$(command -v em++)"
      export PATH="/src/scripts/ci/bin:$PATH"
    fi
    case "$target" in
      standard|domain) bash "packages/duel-server/scripts/build-$target-core.sh" ;;
      legacy-domain) bash packages/duel-server/legacy-1v1/scripts/build-domain-core.sh ;;
      *)
        export LUA_FIXED_SEED=1 OUT_NAME="ocgcore.$target.sync.wasm"
        export MULTI_TREE="/src/packages/duel-server/domain-core/.build/$target-tree"
        case "$target" in multi-ref*) export PATCH_LIMIT=2 ;; esac
        case "$target" in multi-domain|multi-ref-domain) export APPLY_DOMAIN=1 ;; esac
        if [[ "$target" == multi-domain ]]; then export DOMAIN_MULTI=1; fi
        if [[ "$target" == multi-trap ]]; then export EXTRA_CXXFLAGS=-DYGO_N_TRAP; fi
        bash packages/duel-server/scripts/build-multi-core.sh
        ;;
    esac
  ' bash "$target"
dist=packages/duel-server/domain-core/dist
case "$target" in
  standard) cp "$dist/ocgcore.standard.sync.wasm" "$dist/standard-build-info.json" "$out/dist/" ;;
  domain) cp "$dist/ocgcore.domain.sync."{wasm,mjs} "$dist/build-info.json" "$out/dist/" ;;
  legacy-domain) ;; # Its files and manifest keys are in bundle/, not the merged core dist.
  *) cp "$dist/ocgcore.$target.sync.wasm" "$dist/ocgcore.$target-build-info.json" "$out/dist/" ;;
esac
mapfile -d '' -t wasms < <(find "$out/bundle" "$out/dist" -name '*.wasm' -type f -print0)
test "${#wasms[@]}" -gt 0
sha256sum "${wasms[@]}"
