#!/usr/bin/env bash
# Compile the patched multi-duelist core natively, with AddressSanitizer and UBSan.
#
#   bash packages/duel-server/scripts/build-native-core.sh          # build, then run the smoke test
#   SKIP_SMOKE=1 bash packages/duel-server/scripts/build-native-core.sh
#
# Purpose: a fast gate ("does each patch compile, warning free under -Wall") and a place for
# later ASan fuzzing. It builds the patch series tree (prepare-multi-core-tree.sh) and the pinned
# Lua with g++ and gcc. No cmake or premake. Lua is compiled as C++ on purpose, like the wasm
# build does: the core headers include lua.h without extern "C" and Lua errors must be C++ exceptions.
#
# Output (gitignored, under domain-core/.build/native, or NATIVE_OUT):
#   libocgcore-multi.a   thin static library (core + Lua); it needs obj/ and lua-obj/ next to it
#   smoke                native smoke binary
# Environment: JOBS (default nproc), CXX (default g++), SKIP_SMOKE=1, NATIVE_OUT=dir (use one per parallel build),
# and MULTI_TREE, PATCH_LIMIT=N, EXTRA_PATCHES (see prepare script).
# EXTRA_CXXFLAGS (default empty): extra flags for the core and smoke compiles only (not Lua), for example
# "-DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS" (used by run-nduel.sh).
# APPLY_DOMAIN=1 (default 0): copy the prepared tree to $OUT/domain-tree, apply the Domain patch there (same steps as
# build-multi-core.sh) and build domain_master.cpp too. DOMAIN_MULTI=1 (needs APPLY_DOMAIN=1) adds the layer for 3 and 4
# duelists: apply-domain-multi.mjs `pre` before and `post` after the Domain patch. Headers for any test program that
# links the library are then in $OUT/domain-tree. With APPLY_DOMAIN unset nothing changes.
# Lua objects are cached by Lua commit. Core objects are always rebuilt (a patch can change any header).

set -euo pipefail
# WSL captures a crash dump of every aborting process (wsl-capture-crash in core_pattern). The trap builds abort on
# purpose, and many dumps at once crashed WSL twice (2026-09-30). RLIMIT_CORE of exactly 1 byte makes the kernel skip piped dumps (bash ulimit -c counts 512-byte blocks).
prlimit --pid $$ --core=1:1 2>/dev/null || ulimit -c 0
source "$(dirname "${BASH_SOURCE[0]}")/multi-core-common.sh"

CXX="${CXX:-g++}"
EXTRA_CXXFLAGS="${EXTRA_CXXFLAGS:-}"
JOBS="${JOBS:-$(nproc)}"
OUT="${NATIVE_OUT:-$CACHE/native}"
LUA_SRC="$OUT/lua-src"
mkdir -p "$OUT/obj" "$OUT/lua-obj"

if [[ "${DOMAIN_MULTI:-0}" == "1" && "${APPLY_DOMAIN:-0}" != "1" ]]; then
  echo "DOMAIN_MULTI=1 needs APPLY_DOMAIN=1" >&2
  exit 1
fi

bash "$(dirname "${BASH_SOURCE[0]}")/prepare-multi-core-tree.sh"

if [[ "${APPLY_DOMAIN:-0}" == "1" ]]; then
  DOMAIN_TREE="$OUT/domain-tree"
  rm -rf "$DOMAIN_TREE"
  mkdir -p "$DOMAIN_TREE"
  tar -C "$MULTI_TREE" --exclude=.git --exclude="$MULTI_MARKER" -c . | tar -x -C "$DOMAIN_TREE"
  if [[ "${DOMAIN_MULTI:-0}" == "1" ]]; then node "$DOMAIN_SRC/apply-domain-multi.mjs" pre "$DOMAIN_TREE"; fi
  node "$DOMAIN_SRC/apply-domain-patch.mjs" "$DOMAIN_TREE"
  if [[ "${DOMAIN_MULTI:-0}" == "1" ]]; then node "$DOMAIN_SRC/apply-domain-multi.mjs" post "$DOMAIN_TREE"; fi
  MULTI_TREE="$DOMAIN_TREE"
fi

if [[ ! -f "$LUA_SRC/lua.h" || "$(cat "$OUT/lua-src.ref" 2>/dev/null || true)" != "$LUA_REF" ]]; then
  ensure_caches
  rm -rf "$LUA_SRC" "$OUT/lua-obj"
  mkdir -p "$OUT/lua-obj"
  archive_tree "$CACHE_LUA" "$LUA_REF" "$LUA_SRC"
  echo "$LUA_REF" > "$OUT/lua-src.ref"
fi

SAN=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
# -g1: line tables for sanitizer stack traces, no local variable info. Full -g made each build ~700 MB.
COMMON=(-O1 -g1 "${SAN[@]}" -fno-rtti -I"$LUA_SRC" -I"$MULTI_TREE")
CORE_SOURCES=(card duel effect field interpreter libcard libdebug libduel libeffect libgroup ocgapi operations playerop processor_visit processor scriptlib)
if [[ "${APPLY_DOMAIN:-0}" == "1" ]]; then CORE_SOURCES+=(domain_master); fi
LUA_SOURCES=(lapi lauxlib lbaselib lcode lcorolib lctype ldblib ldebug ldo ldump lfunc lgc linit liolib llex lmathlib lmem loadlib lobject lopcodes loslib lparser lstate lstring lstrlib ltable ltablib ltm lundump lutf8lib lvm lzio)

compile_one() {
  local kind="$1" name="$2" src obj flags
  if [[ "$kind" == lua ]]; then
    src="$LUA_SRC/$name.c"; obj="$OUT/lua-obj/$name.o"
    [[ -f "$obj" ]] && return 0
    "$CXX" -x c++ -w "${COMMON[@]}" -c "$src" -o "$obj"
  else
    src="$MULTI_TREE/$name.cpp"; obj="$OUT/obj/$name.o"
    # shellcheck disable=SC2086
    "$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter "${COMMON[@]}" ${EXTRA_CXXFLAGS:-} -c "$src" -o "$obj"
  fi
}
export -f compile_one
export CXX OUT LUA_SRC MULTI_TREE EXTRA_CXXFLAGS
export COMMON_STR="${COMMON[*]}"
# Arrays cannot be exported. Rebuild COMMON inside the subshell from a string.
compile_job() {
  IFS=' ' read -r -a COMMON <<< "$COMMON_STR"
  compile_one "$1" "$2"
}
export -f compile_job

rm -f "$OUT"/obj/*.o
START=$(date +%s)
{
  for name in "${LUA_SOURCES[@]}"; do echo "lua $name"; done
  for name in "${CORE_SOURCES[@]}"; do echo "core $name"; done
} | xargs -P "$JOBS" -L 1 bash -c 'compile_job "$0" "$1"'

rm -f "$OUT/libocgcore-multi.a"
# Thin archive (T): it points at obj/*.o and does not copy them (saves ~300 MB per build).
ar rcsT "$OUT/libocgcore-multi.a" "$OUT"/obj/*.o "$OUT"/lua-obj/*.o
echo "native core compiled in $(( $(date +%s) - START ))s: $OUT/libocgcore-multi.a"

# shellcheck disable=SC2086
"$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter "${COMMON[@]}" ${EXTRA_CXXFLAGS:-} "$PKG/scripts/native/smoke.cpp" \
  "$OUT/libocgcore-multi.a" -o "$OUT/smoke"

if [[ "${SKIP_SMOKE:-0}" != 1 ]]; then
  ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=1}:disable_coredump=0" UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1" "$OUT/smoke"
fi
