#!/usr/bin/env bash
# Build the STOCK (non-Domain) ocgcore wasm used by Standard duels.
#
# Same toolchain and pins as build-domain-core.sh (ocgcore-wasm ref, ygopro-core
# efc21aa, lua, emsdk 4.0.9) but WITHOUT the Domain patch and without
# domain_master.cpp. It applies only domain-core/src/apply-core-fixes.mjs, the
# engine bug fixes that both builds share, so the rules match stock efc21aa. It
# also serves as the stock baseline for differential tests. The npm ocgcore-wasm@0.1.2 core is
# older than the pinned card scripts and must not run Standard duels.
#
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
#     -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
#     -e DUEL_DATA_DIR=/src/data/duel-engine-next \
#     -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
#     bash packages/duel-server/scripts/build-standard-core.sh
#
# Do not docker pull from this script. Git caches under domain-core/.build are
# fetch-only and shared with the Domain build. Pinned trees are extracted with
# git archive into a temporary directory; only that directory is deleted.
# Re-runnable: the manifest step is idempotent and keeps every other key.

set -euo pipefail

ROOT="${DOMAIN_ROOT:-${1:-/src}}"
PKG="$ROOT/packages/duel-server"
DIST="$PKG/domain-core/dist"
CACHE="$PKG/domain-core/.build"
PINS="$PKG/domain-core/pins.json"
DATA_DIR="${DUEL_DATA_DIR:-$ROOT/data/duel-engine}"
WRAPPER="$ROOT/node_modules/ocgcore-wasm/dist/index.js"
CORE_FIXES="$PKG/domain-core/src/apply-core-fixes.mjs"
CORE_FIXES_HASH="$(sha256sum "$CORE_FIXES" | cut -d" " -f1)"

CORE_COMMIT="$(node -p "require('$PINS').ygoproCore.commit")"
WASM_REF="$(node -p "require('$PINS').ocgcoreWasm.ref")"
LUA_REF="$(node -p "require('$PINS').lua.commit")"
WASM_URL="$(node -p "require('$PINS').ocgcoreWasm.repository")"
CORE_URL="$(node -p "require('$PINS').ygoproCore.repository")"
LUA_URL="$(node -p "require('$PINS').lua.repository")"

if [[ ! -f "$WRAPPER" ]]; then
  echo "missing ocgcore-wasm wrapper at $WRAPPER" >&2
  exit 1
fi

# Writes integrity.standardWasm, sources.standardCore and bundleVersion. Keeps every other key.
write_manifest() {
  node --input-type=module - "$DATA_DIR" "$PINS" "$WRAPPER" "$CORE_FIXES" "$1" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [directory, pinsPath, wrapper, coreFixes, mode] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const path = join(directory, 'manifest.json');
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
const standardCore = {
  ygoproCore: pins.ygoproCore.commit,
  ocgcoreWasm: pins.ocgcoreWasm.ref,
  lua: pins.lua.commit,
  emscripten: pins.emscripten,
  coreFixes: hash(readFileSync(coreFixes)),
};
const expected = {
  wasm: hash(readFileSync(join(directory, 'ocgcore.standard.wasm'))),
  wrapper: hash(readFileSync(wrapper)),
};
if (mode === 'check') {
  const ok = JSON.stringify(manifest.sources?.standardCore) === JSON.stringify(standardCore)
    && manifest.integrity?.standardWasm === expected.wasm
    && manifest.integrity?.wrapper === expected.wrapper;
  process.exit(ok ? 0 : 1);
}
manifest.sources ??= {};
manifest.integrity ??= {};
manifest.sources.standardCore = standardCore;
manifest.integrity.wrapper = expected.wrapper;
manifest.integrity.standardWasm = expected.wasm;
// integrity.multiScripts is not part of bundleVersion (the host pins it for duels with more than two seats only).
const { multiScripts: _overlay, ...engineIntegrity } = manifest.integrity;
manifest.bundleVersion = hash(JSON.stringify({ sources: manifest.sources, integrity: engineIntegrity }));
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
JS
}

if [[ -f "$DATA_DIR/manifest.json" && -f "$DATA_DIR/ocgcore.standard.wasm" ]] && write_manifest check; then
  echo "standard wasm bundle already current under $DATA_DIR"
  exit 0
fi

# wasm on disk but manifest lost the key (for example after a parallel Domain build): just re-record.
if [[ -f "$DIST/ocgcore.standard.sync.wasm" && -f "$DATA_DIR/manifest.json" ]] \
  && cmp -s "$DIST/ocgcore.standard.sync.wasm" "$DATA_DIR/ocgcore.standard.wasm" 2>/dev/null \
  && [[ "$(cat "$DIST/standard-build-info.json" 2>/dev/null | node -p "try{const i=JSON.parse(require('fs').readFileSync(0,'utf8'));i.ygoproCore+':'+i.ocgcoreWasm+':'+i.lua+':'+i.coreFixes}catch{''}")" == "$CORE_COMMIT:$WASM_REF:$LUA_REF:$CORE_FIXES_HASH" ]]; then
  write_manifest write
  echo "re-recorded standard wasm in $DATA_DIR/manifest.json"
  exit 0
fi

if ! command -v em++ >/dev/null 2>&1; then
  echo "em++ is not on PATH. Run this script inside docker.io/emscripten/emsdk:4.0.9" >&2
  exit 1
fi

git_cache() {
  local dir="$1"
  shift
  GIT_OPTIONAL_LOCKS=0 git -c "safe.directory=$dir" -C "$dir" "$@"
}

ensure_clone() {
  local dir="$1" url="$2"
  if [[ -e "$dir" && ! -d "$dir/.git" ]]; then
    echo "refusing to clobber non-git cache at $dir" >&2
    exit 1
  fi
  if [[ ! -d "$dir/.git" ]]; then
    mkdir -p "$(dirname "$dir")"
    git clone --filter=blob:none "$url" "$dir"
  fi
}

fetch_pin() {
  local dir="$1" ref="$2"
  if git_cache "$dir" cat-file -e "${ref}^{commit}"; then
    return 0
  fi
  git_cache "$dir" fetch origin "$ref"
  git_cache "$dir" cat-file -e "${ref}^{commit}"
}

archive_tree() {
  local dir="$1" ref="$2" dest="$3"
  mkdir -p "$dest"
  git_cache "$dir" archive --format=tar "$ref" | tar -x -C "$dest"
}

mkdir -p "$CACHE" "$DIST"

CACHE_WASM="$CACHE/ocgcore-wasm"
if [[ -d "$CACHE/ocgcore-wasm/cpp/ygo/.git" ]]; then
  CACHE_YGO="$CACHE/ocgcore-wasm/cpp/ygo"
else
  CACHE_YGO="$CACHE/ygopro-core"
fi
if [[ -d "$CACHE/ocgcore-wasm/cpp/lua/.git" ]]; then
  CACHE_LUA="$CACHE/ocgcore-wasm/cpp/lua"
else
  CACHE_LUA="$CACHE/lua"
fi

ensure_clone "$CACHE_WASM" "$WASM_URL.git"
ensure_clone "$CACHE_YGO" "$CORE_URL.git"
ensure_clone "$CACHE_LUA" "$LUA_URL.git"
fetch_pin "$CACHE_WASM" "$WASM_REF"
fetch_pin "$CACHE_YGO" "$CORE_COMMIT"
fetch_pin "$CACHE_LUA" "$LUA_REF"

BUILD_TMP="$(mktemp -d "${TMPDIR:-/tmp}/standard-core-build.XXXXXX")"
trap 'rm -rf "$BUILD_TMP"' EXIT

archive_tree "$CACHE_WASM" "$WASM_REF" "$BUILD_TMP/ocgcore-wasm"
rm -rf "$BUILD_TMP/ocgcore-wasm/cpp/ygo" "$BUILD_TMP/ocgcore-wasm/cpp/lua"
archive_tree "$CACHE_YGO" "$CORE_COMMIT" "$BUILD_TMP/ocgcore-wasm/cpp/ygo"
archive_tree "$CACHE_LUA" "$LUA_REF" "$BUILD_TMP/ocgcore-wasm/cpp/lua"

node "$CORE_FIXES" "$BUILD_TMP/ocgcore-wasm/cpp/ygo"

BUILD_SH="$BUILD_TMP/ocgcore-wasm/scripts/build.sh"
if [[ ! -f "$BUILD_SH" ]]; then
  echo "missing ocgcore-wasm scripts/build.sh" >&2
  exit 1
fi

# No Domain patch. Only drop the browser JSPI variant: the server uses the sync worker.
python3 - "$BUILD_SH" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
first = text.index("\nem++ ")
last = text.rindex("\nem++ ")
path.write_text(text[:first] + text[last:])
PY

(
  cd "$BUILD_TMP/ocgcore-wasm"
  bash ./scripts/build.sh
)

SYNC_WASM="$BUILD_TMP/ocgcore-wasm/lib/ocgcore.sync.wasm"
if [[ ! -f "$SYNC_WASM" ]]; then
  echo "sync standard artifact missing after emscripten build" >&2
  exit 1
fi

cp -f "$SYNC_WASM" "$DIST/ocgcore.standard.sync.wasm"
mkdir -p "$DATA_DIR"
cp -f "$DIST/ocgcore.standard.sync.wasm" "$DATA_DIR/ocgcore.standard.wasm"

write_manifest write

cat > "$DIST/standard-build-info.json" <<INFO
{
  "ygoproCore": "$CORE_COMMIT",
  "ocgcoreWasm": "$WASM_REF",
  "lua": "$LUA_REF",
  "emscripten": "4.0.9",
  "coreFixes": "$CORE_FIXES_HASH",
  "patched": "core-fixes"
}
INFO

echo "wrote $DIST/ocgcore.standard.sync.wasm and $DATA_DIR/ocgcore.standard.wasm"
