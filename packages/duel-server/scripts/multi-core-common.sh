#!/usr/bin/env bash
# Shared helpers for the multi-duelist core scripts (prepare-multi-core-tree.sh,
# build-multi-core.sh, build-native-core.sh). Source this file. Do not run it.
#
# Uses the fetch-only git caches under domain-core/.build, the same ones
# build-standard-core.sh and build-domain-core.sh use. Never pulls a docker image.

ROOT="${DOMAIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
PKG="$ROOT/packages/duel-server"
DIST="${DOMAIN_CORE_DIST:-$PKG/domain-core/dist}"
CACHE="$PKG/domain-core/.build"
PINS="$PKG/domain-core/pins.json"
PATCHES="$PKG/domain-core/patches"
DOMAIN_SRC="$PKG/domain-core/src"
MULTI_TREE="${MULTI_TREE:-$CACHE/multi-core-tree}"
MULTI_MARKER=".multi-core-tree"

CORE_COMMIT="$(node -p "require('$PINS').ygoproCore.commit")"
WASM_REF="$(node -p "require('$PINS').ocgcoreWasm.ref")"
LUA_REF="$(node -p "require('$PINS').lua.commit")"
WASM_URL="$(node -p "require('$PINS').ocgcoreWasm.repository")"
CORE_URL="$(node -p "require('$PINS').ygoproCore.repository")"
LUA_URL="$(node -p "require('$PINS').lua.repository")"

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

# Sets CACHE_WASM, CACHE_YGO, CACHE_LUA and makes sure the pinned commits are present.
ensure_caches() {
  mkdir -p "$CACHE"
  CACHE_WASM="$CACHE/ocgcore-wasm"
  if [[ -d "$CACHE/ocgcore-wasm/cpp/ygo/.git" ]]; then CACHE_YGO="$CACHE/ocgcore-wasm/cpp/ygo"; else CACHE_YGO="$CACHE/ygopro-core"; fi
  if [[ -d "$CACHE/ocgcore-wasm/cpp/lua/.git" ]]; then CACHE_LUA="$CACHE/ocgcore-wasm/cpp/lua"; else CACHE_LUA="$CACHE/lua"; fi
  ensure_clone "$CACHE_WASM" "$WASM_URL.git"
  ensure_clone "$CACHE_YGO" "$CORE_URL.git"
  ensure_clone "$CACHE_LUA" "$LUA_URL.git"
  fetch_pin "$CACHE_WASM" "$WASM_REF"
  fetch_pin "$CACHE_YGO" "$CORE_COMMIT"
  fetch_pin "$CACHE_LUA" "$LUA_REF"
}
