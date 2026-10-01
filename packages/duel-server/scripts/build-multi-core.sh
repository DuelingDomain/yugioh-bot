#!/usr/bin/env bash
# Build ocgcore.multi.sync.wasm: the pinned ygopro-core plus the patch series in
# domain-core/patches (see prepare-multi-core-tree.sh).
#
# Same toolchain, emscripten flags and wrapper glue (ocgcore-wasm scripts/build.sh and
# cpp/wasm.cpp at the pinned ref) as build-standard-core.sh. No Domain patch and no
# domain_master.cpp. Output goes to domain-core/dist (gitignored). It is NOT added to
# any manifest and no server uses it yet. Only the differential test reads it.
#
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
#     -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
#     -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
#     bash packages/duel-server/scripts/build-multi-core.sh
#
# Environment:
#   PATCH_LIMIT=N      build with only the first N patches (sanity gate: 1 = core fixes only, no LUA_FIXED_SEED;
#                      differential reference: 2 = core fixes + deterministic effect order).
#   LUA_FIXED_SEED=1   compile Lua with luai_makeseed() = 0. Lua seeds its string hash and math.random
#                      from addresses and time, so two different binaries only replay the same duel
#                      with a fixed seed. The differential test needs this for both of its cores.
#   EXTRA_EM_FLAGS=... extra em++ flags (for example a libc++ hardening mode for a bounds experiment).
#   EXTRA_CXXFLAGS=... extra compiler flags, same place as EXTRA_EM_FLAGS (for example -DYGO_N_TRAP_LOG for the census
#                      build, see scripts/native/census.patch). Default empty: the output does not change.
#   EXTRA_PATCHES=... extra patch files applied after the series (experiments).
#   OUT_NAME=file      output file name in domain-core/dist (default ocgcore.multi.sync.wasm).
#   APPLY_DOMAIN=1     opt in: apply the Domain patch (domain-core/src/apply-domain-patch.mjs) to a copy of the
#                      prepared tree and build domain_master.cpp too, the same steps as build-domain-core.sh.
#                      The prepared tree itself is not changed. The differential test in Domain mode needs it.
#                      Unset (default): nothing changes and the output is byte for byte the same as before.
#   DOMAIN_MULTI=1     opt in, needs APPLY_DOMAIN=1: the Domain layer for 3 and 4 duelists
#                      (domain-core/src/apply-domain-multi.mjs). Order: `pre`, the Domain patch, `post`. build-info gets
#                      "domainMulti" (sha256 of the .mjs). Unset (default): nothing changes, byte for byte.
# Do not docker pull. Git caches under domain-core/.build are fetch-only.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/multi-core-common.sh"

if ! command -v em++ >/dev/null 2>&1; then
  echo "em++ is not on PATH. Run this script inside docker.io/emscripten/emsdk:4.0.9" >&2
  exit 1
fi

if [[ "${DOMAIN_MULTI:-0}" == "1" && "${APPLY_DOMAIN:-0}" != "1" ]]; then
  echo "DOMAIN_MULTI=1 needs APPLY_DOMAIN=1" >&2
  exit 1
fi

bash "$(dirname "${BASH_SOURCE[0]}")/prepare-multi-core-tree.sh"
ensure_caches
mkdir -p "$DIST"

BUILD_TMP="$(mktemp -d "${TMPDIR:-/tmp}/multi-core-build.XXXXXX")"
trap 'rm -rf "$BUILD_TMP"' EXIT

archive_tree "$CACHE_WASM" "$WASM_REF" "$BUILD_TMP/ocgcore-wasm"
rm -rf "$BUILD_TMP/ocgcore-wasm/cpp/ygo" "$BUILD_TMP/ocgcore-wasm/cpp/lua"
mkdir -p "$BUILD_TMP/ocgcore-wasm/cpp/ygo"
# Copy the patched working tree without git data and without the tree marker.
tar -C "$MULTI_TREE" --exclude=.git --exclude="$MULTI_MARKER" -c . | tar -x -C "$BUILD_TMP/ocgcore-wasm/cpp/ygo"
archive_tree "$CACHE_LUA" "$LUA_REF" "$BUILD_TMP/ocgcore-wasm/cpp/lua"

if [[ "${APPLY_DOMAIN:-0}" == "1" ]]; then
  # The copy already has patch 1 (the core fix), which is what apply-core-fixes.mjs does for build-domain-core.sh.
  if [[ "${DOMAIN_MULTI:-0}" == "1" ]]; then node "$DOMAIN_SRC/apply-domain-multi.mjs" pre "$BUILD_TMP/ocgcore-wasm/cpp/ygo"; fi
  node "$DOMAIN_SRC/apply-domain-patch.mjs" "$BUILD_TMP/ocgcore-wasm/cpp/ygo"
  if [[ "${DOMAIN_MULTI:-0}" == "1" ]]; then node "$DOMAIN_SRC/apply-domain-multi.mjs" post "$BUILD_TMP/ocgcore-wasm/cpp/ygo"; fi
fi

BUILD_SH="$BUILD_TMP/ocgcore-wasm/scripts/build.sh"
if [[ ! -f "$BUILD_SH" ]]; then
  echo "missing ocgcore-wasm scripts/build.sh" >&2
  exit 1
fi

# Same as build-standard-core.sh: drop only the browser JSPI variant, keep the sync one.
python3 - "$BUILD_SH" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
first = text.index("\nem++ ")
last = text.rindex("\nem++ ")
path.write_text(text[:first] + text[last:])
PY

if [[ "${APPLY_DOMAIN:-0}" == "1" ]]; then
  # Same edit as build-domain-core.sh: add domain_master.cpp to the ygo source list.
  python3 - "$BUILD_SH" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "./cpp/ygo/scriptlib.cpp"
if "domain_master.cpp" not in text:
    if needle not in text:
        raise SystemExit("could not find scriptlib.cpp in ocgcore-wasm build.sh")
    path.write_text(text.replace(needle, needle + " ./cpp/ygo/domain_master.cpp", 1))
PY
fi

# Extra compiler flags for the em++ calls (LUA_FIXED_SEED adds one; EXTRA_EM_FLAGS adds your own).
EXTRA_FLAGS=""
if [[ "${LUA_FIXED_SEED:-0}" == "1" ]]; then EXTRA_FLAGS+=" -D'luai_makeseed()=0u'"; fi
if [[ -n "${EXTRA_EM_FLAGS:-}" ]]; then EXTRA_FLAGS+=" $EXTRA_EM_FLAGS"; fi
if [[ -n "${EXTRA_CXXFLAGS:-}" ]]; then EXTRA_FLAGS+=" $EXTRA_CXXFLAGS"; fi
if [[ -n "$EXTRA_FLAGS" ]]; then
  python3 - "$BUILD_SH" "$EXTRA_FLAGS" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
marker = "  -I./cpp/lua \\\n"
if marker not in text:
    sys.exit("could not add extra flags to build.sh")
path.write_text(text.replace(marker, "  -I./cpp/lua " + sys.argv[2] + " \\\n"))
PY
fi

(
  cd "$BUILD_TMP/ocgcore-wasm"
  bash ./scripts/build.sh
)

SYNC_WASM="$BUILD_TMP/ocgcore-wasm/lib/ocgcore.sync.wasm"
if [[ ! -f "$SYNC_WASM" ]]; then
  echo "sync multi artifact missing after emscripten build" >&2
  exit 1
fi

OUT_NAME="${OUT_NAME:-ocgcore.multi.sync.wasm}"
cp -f "$SYNC_WASM" "$DIST/$OUT_NAME"
PATCH_COUNT="$(git -C "$MULTI_TREE" rev-list --count upstream..HEAD)"
DOMAIN_INFO=""
if [[ "${APPLY_DOMAIN:-0}" == "1" ]]; then DOMAIN_INFO=$'\n  "applyDomain": 1,'; fi
if [[ "${DOMAIN_MULTI:-0}" == "1" ]]; then DOMAIN_INFO+=$'\n  "domainMulti": "'"$(sha256sum "$DOMAIN_SRC/apply-domain-multi.mjs" | cut -d' ' -f1)"$'",'; fi
INFO_NAME="${OUT_NAME%.sync.wasm}-build-info.json"
cat > "$DIST/$INFO_NAME" <<INFO
{
  "ygoproCore": "$CORE_COMMIT",
  "ocgcoreWasm": "$WASM_REF",
  "lua": "$LUA_REF",
  "emscripten": "4.0.9",
  "patches": $PATCH_COUNT,
  "luaFixedSeed": ${LUA_FIXED_SEED:-0},${DOMAIN_INFO}
  "head": "$(git -C "$MULTI_TREE" rev-parse HEAD)"
}
INFO
echo "wrote $DIST/$OUT_NAME ($PATCH_COUNT patches)"
