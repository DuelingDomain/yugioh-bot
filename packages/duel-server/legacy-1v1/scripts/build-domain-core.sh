#!/usr/bin/env bash
# Build the LEGACY Domain Format ocgcore wasm: the Domain core that production ran before the n-seat work.
#
# This is packages/duel-server/scripts/build-domain-core.sh of main (commit 2a5a959) with these changes only, all marked LEGACY-1V1:
#   - its inputs are the copies of main's domain-core files under packages/duel-server/legacy-1v1/domain-core (not the merged ones),
#   - it writes ocgcore.domain.legacy.wasm and card-scripts/domain.legacy.lua next to the merged files,
#   - it writes its own manifest keys (domainLegacyWasm, domainLegacyLua, domainLegacyPatch, sources.domainCoreLegacy) and
#     leaves integrity.wrapper (the merged wrapper hash) and the merged Domain keys alone.
# The expected pin includes the owner-approved Deck Master corrections of 2026-10-04 (ADR-0002).
#
# Inside the already-pulled toolchain image:
#   docker run --rm --user "$(id -u):$(id -g)" \
#     -v "$PWD":/src \
#     -w /src \
#     docker.io/emscripten/emsdk:4.0.9 \
#     bash packages/duel-server/legacy-1v1/scripts/build-domain-core.sh
#
# Do not docker pull from this script; parent owns the image.
# Git caches under domain-core/.build are fetch-only. Pinned trees are extracted
# with git archive into a temporary build directory; only that directory is deleted.

set -euo pipefail

ROOT="${DOMAIN_ROOT:-${1:-/src}}"
PKG="$ROOT/packages/duel-server"
LEGACY="$PKG/legacy-1v1" # LEGACY-1V1
CORE_SRC="$LEGACY/domain-core/src" # LEGACY-1V1
LUA_SRC="$LEGACY/domain-core/lua/domain.lua" # LEGACY-1V1
DIST="$LEGACY/domain-core/dist" # LEGACY-1V1
CACHE="$PKG/domain-core/.build" # the fetch-only git cache is shared with the merged build
PINS="$LEGACY/domain-core/pins.json" # LEGACY-1V1
DATA_DIR="${DUEL_DATA_DIR:-$ROOT/data/duel-engine}"
GENERATED="$DIST/generated"

CORE_COMMIT="$(node -p "require('$PINS').ygoproCore.commit")"
WASM_REF="$(node -p "require('$PINS').ocgcoreWasm.ref")"
LUA_REF="$(node -p "require('$PINS').lua.commit")"
WASM_URL="$(node -p "require('$PINS').ocgcoreWasm.repository")"
CORE_URL="$(node -p "require('$PINS').ygoproCore.repository")"
LUA_URL="$(node -p "require('$PINS').lua.repository")"

if [[ ! -f "$CORE_SRC/apply-domain-patch.mjs" ]]; then
  echo "missing $CORE_SRC/apply-domain-patch.mjs" >&2
  exit 1
fi
if [[ ! -f "$ROOT/node_modules/ocgcore-wasm/dist/index.js" ]]; then
  echo "missing ocgcore-wasm wrapper at $ROOT/node_modules/ocgcore-wasm/dist/index.js" >&2
  exit 1
fi
WRAPPER="$ROOT/node_modules/ocgcore-wasm/dist/index.js"

if node --input-type=module - "$DATA_DIR" "$PINS" "$CORE_SRC" "$WRAPPER" <<'JS'
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [directory, pinsPath, source, wrapper] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = join(directory, 'manifest.json');
const wasmPath = join(directory, 'ocgcore.domain.legacy.wasm'); // LEGACY-1V1
const luaPath = join(directory, 'card-scripts/domain.legacy.lua'); // LEGACY-1V1
if (!existsSync(manifestPath) || !existsSync(wasmPath) || !existsSync(luaPath)) process.exit(1);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
if (JSON.stringify(manifest.sources?.domainCoreLegacy) !== JSON.stringify(pins)) process.exit(1); // LEGACY-1V1
const patchFiles = ['apply-domain-patch.mjs', 'domain_master.cpp', 'domain_master.h'];
const checks = { // LEGACY-1V1: own keys, and no wrapper hash
  domainLegacyWasm: hash(readFileSync(wasmPath)),
  domainLegacyLua: hash(readFileSync(luaPath)),
  domainLegacyPatch: hash(Buffer.concat(patchFiles.map(name => readFileSync(join(source, name))))),
};
for (const [key, value] of Object.entries(checks)) {
  if (manifest.integrity?.[key] !== value) process.exit(1);
}
process.exit(0);
JS
then
  echo "domain wasm bundle already current under $DATA_DIR"
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

BUILD_TMP="$(mktemp -d "${TMPDIR:-/tmp}/domain-core-build.XXXXXX")"
trap 'rm -rf "$BUILD_TMP"' EXIT

archive_tree "$CACHE_WASM" "$WASM_REF" "$BUILD_TMP/ocgcore-wasm"
rm -rf "$BUILD_TMP/ocgcore-wasm/cpp/ygo" "$BUILD_TMP/ocgcore-wasm/cpp/lua"
archive_tree "$CACHE_YGO" "$CORE_COMMIT" "$BUILD_TMP/ocgcore-wasm/cpp/ygo"
archive_tree "$CACHE_LUA" "$LUA_REF" "$BUILD_TMP/ocgcore-wasm/cpp/lua"

node "$CORE_SRC/apply-domain-patch.mjs" "$BUILD_TMP/ocgcore-wasm/cpp/ygo"

BUILD_SH="$BUILD_TMP/ocgcore-wasm/scripts/build.sh"
if [[ ! -f "$BUILD_SH" ]]; then
  echo "missing ocgcore-wasm scripts/build.sh" >&2
  exit 1
fi

# Keep the upstream compile line wrapper-compatible; only add domain_master.cpp.
python3 - "$BUILD_SH" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "./cpp/ygo/scriptlib.cpp"
addition = "./cpp/ygo/scriptlib.cpp ./cpp/ygo/domain_master.cpp"
if "domain_master.cpp" not in text:
    if needle not in text:
        raise SystemExit("could not find scriptlib.cpp in ocgcore-wasm build.sh")
    text = text.replace(needle, addition, 1)
    path.write_text(text)
# Only the synchronous server worker is used. Keep the upstream source lists and
# synchronous ABI flags, without building its unused browser JSPI variant.
first = text.index("\nem++ ")
last = text.rindex("\nem++ ")
path.write_text(text[:first] + text[last:])
PY

(
  cd "$BUILD_TMP/ocgcore-wasm"
  bash ./scripts/build.sh
)

SYNC_WASM="$BUILD_TMP/ocgcore-wasm/lib/ocgcore.sync.wasm"
SYNC_MJS="$BUILD_TMP/ocgcore-wasm/lib/ocgcore.sync.mjs"
if [[ ! -f "$SYNC_WASM" || ! -f "$SYNC_MJS" ]]; then
  echo "sync domain artifacts missing after emscripten build" >&2
  exit 1
fi

mkdir -p "$DIST"
rm -f "$DIST/ocgcore.domain.jspi.wasm" "$DIST/ocgcore.domain.jspi.mjs"
cp -f "$SYNC_WASM" "$DIST/ocgcore.domain.sync.wasm"
cp -f "$SYNC_MJS" "$DIST/ocgcore.domain.sync.mjs"

rm -rf "$GENERATED"
mkdir -p "$GENERATED"
cp -a "$BUILD_TMP/ocgcore-wasm/cpp/ygo" "$GENERATED/ygo"
cp -a "$BUILD_SH" "$GENERATED/build.sh"

mkdir -p "$DATA_DIR/card-scripts"
cp -f "$DIST/ocgcore.domain.sync.wasm" "$DATA_DIR/ocgcore.domain.legacy.wasm" # LEGACY-1V1
cp -f "$LUA_SRC" "$DATA_DIR/card-scripts/domain.legacy.lua" # LEGACY-1V1

node --input-type=module - "$DATA_DIR" "$PINS" "$CORE_SRC" "$WRAPPER" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [directory, pins, source, wrapper] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const path = join(directory, 'manifest.json');
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const patchFiles = ['apply-domain-patch.mjs', 'domain_master.cpp', 'domain_master.h'];
// LEGACY-1V1: own keys; integrity.wrapper and the merged Domain keys are not touched.
manifest.sources.domainCoreLegacy = JSON.parse(readFileSync(pins, 'utf8'));
manifest.integrity.domainLegacyWasm = hash(readFileSync(join(directory, 'ocgcore.domain.legacy.wasm')));
manifest.integrity.domainLegacyLua = hash(readFileSync(join(directory, 'card-scripts/domain.legacy.lua')));
manifest.integrity.domainLegacyPatch = hash(Buffer.concat(patchFiles.map(name => readFileSync(join(source, name)))));
manifest.bundleVersion = hash(JSON.stringify({ sources: manifest.sources, integrity: manifest.integrity }));
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
JS

cat > "$DIST/build-info.json" <<EOF
{
  "ygoproCore": "$CORE_COMMIT",
  "ocgcoreWasm": "$WASM_REF",
  "emscripten": "4.0.9",
  "pins": "$PINS",
  "generatedSource": "packages/duel-server/legacy-1v1/domain-core/dist/generated"
}
EOF

# LEGACY-1V1: the build must make main's files. A different sha256 (another toolchain, another input) fails here.
sh "$PKG/scripts/check-legacy-pin.sh" "$DATA_DIR" "$LEGACY/expected-sha256.txt"

echo "wrote $DIST/ocgcore.domain.sync.wasm and $DATA_DIR/ocgcore.domain.legacy.wasm"
