#!/usr/bin/env bash
# One isolated CI build. Serial mode exists only for clean hash-parity checks.
set -euo pipefail
target="${1:?core target required}"
case "$target" in
  standard|domain|legacy-domain|multi|multi-domain|multi-ref|multi-ref-domain|multi-trap|multi-domain-trap) ;;
  *) echo "unknown core target: $target" >&2; exit 1 ;;
esac
out="${CI_CORE_OUTPUT:-ci-core}/$target"
mode="${2:-build}"
case "$mode" in
  build|--verify-only) ;;
  *) echo "unknown core build mode: $mode" >&2; exit 1 ;;
esac

verify_core() {
  local wasm="$out/dist/ocgcore.$target.sync.wasm"
  if [[ "$target" == legacy-domain ]]; then wasm="$out/bundle/ocgcore.domain.legacy.wasm"; fi
  test -s "$wasm" || { echo "core missing or empty: $wasm" >&2; return 1; }
  local -a wasms
  mapfile -d '' -t wasms < <(find "$out/bundle" "$out/dist" -name '*.wasm' -type f -print0)
  sha256sum "${wasms[@]}"
  if [[ "$target" == legacy-domain ]]; then
    sh packages/duel-server/scripts/check-legacy-pin.sh "$out/bundle"
    return
  fi
  # pins.json pins sources/toolchain; fixed binary hashes live in expected-sha256.txt.
  local expected=packages/duel-server/domain-core/expected-sha256.txt want name got pinned=0
  test -f "$expected" || { echo "core pin file missing: $expected" >&2; return 1; }
  while read -r want name; do
    if [[ "$name" == "ocgcore.$target.sync.wasm" ]]; then
      got="$(sha256sum "$wasm" | cut -d' ' -f1)"
      if [[ "$got" != "$want" ]]; then
        echo "core pin: $target has sha256 $got, expected $want" >&2
        return 1
      fi
      pinned=1
    fi
  done < "$expected"
  if [[ "$target" == standard || "$target" == domain ]]; then
    cmp -s "$wasm" "$out/bundle/ocgcore.$target.wasm" || { echo "bundle core does not match dist core: $target" >&2; return 1; }
  fi
  if [[ "$pinned" == 0 ]]; then echo "No fixed binary SHA256 pin for $target; source/toolchain pins are in pins.json."; fi
}

# Cache hits must take this path before save/upload, without rebuilding or rewriting the manifest.
if [[ "$mode" == --verify-only ]]; then verify_core; exit 0; fi
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
        case "$target" in multi-domain|multi-ref-domain|multi-domain-trap) export APPLY_DOMAIN=1 ;; esac
        case "$target" in multi-domain|multi-domain-trap) export DOMAIN_MULTI=1 ;; esac
        case "$target" in multi-trap|multi-domain-trap) export EXTRA_CXXFLAGS=-DYGO_N_TRAP ;; esac
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
verify_core
