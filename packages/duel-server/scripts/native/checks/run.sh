#!/usr/bin/env bash
# Build and run the native rule checks against a multi-duelist core source tree.
#
#   bash packages/duel-server/scripts/native/checks/run.sh                                           # every ready check, core = repo series
#   MULTI_TREE=/path/to/core-tree bash packages/duel-server/scripts/native/checks/run.sh            # the same on another core tree
#   MULTI_TREE=... bash .../run.sh elimination zones                                                 # only these checks
#   MULTI_TREE=... bash .../run.sh --pending                                                         # also run pending checks
#   MULTI_TREE=... bash .../run.sh --domain                                                          # the Domain checks, on a core tree with the Domain layer
#   bash .../run.sh --list                                                                           # print the manifest
#   bash .../run.sh --clean                                                                          # delete the build folder
#
# What it does: (1) compiles the core in MULTI_TREE and the pinned Lua into one library with AddressSanitizer + UBSan
# (the same flags as scripts/build-native-core.sh, plus -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS), (2) compiles every check
# listed in checks.tsv against it, (3) runs each check from the repo root and prints PASS or FAIL per check.
# Exit code 0 only when every selected ready check passes. A MULTI_TREE that you give is only read, never written.
# --domain: the core tree is first copied to $OUT/domain-tree and gets the Domain layer for 3 and 4 duelists (apply-domain-multi.mjs pre,
# apply-domain-patch.mjs, apply-domain-multi.mjs post, the same steps as scripts/build-multi-core.sh with APPLY_DOMAIN=1 DOMAIN_MULTI=1).
# The checks compile against that copy. Without names, only the rows with status `domain` run (they count as ready in this mode).
#
# Environment:
#   MULTI_TREE        core source tree with the patch series applied (field.h, fold.h, ...). Default: the repo series on the
#                     pinned ygopro-core, made by prepare-multi-core-tree.sh into $NATIVE_CHECKS_OUT/multi-core-tree (CI)
#   NATIVE_CHECKS_OUT build folder (default domain-core/.build/native-checks, gitignored). Safe to delete.
#   DUEL_DATA_DIR     engine data (cards.cdb, card-scripts). Default <repo>/data/duel-engine-next. Only read.
#   LUA_SRC           folder with the pinned Lua sources. Default: extracted from the git cache into the build folder.
#   JOBS              parallel compile jobs (default 3)
#   CXX               compiler (default g++)
#   CHECK_TRAP        1 (default) builds with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS, 0 builds without
#   CHECK_TIMEOUT     seconds per check (default 300)
#   CHECKS_SKIP_LIB=1 reuse the library from an earlier run in the same build folder
set -uo pipefail
# WSL captures a crash dump of every aborting process (wsl-capture-crash in core_pattern). Sanitizer aborts are
# expected in a failing check. RLIMIT_CORE of exactly 1 byte makes the kernel skip piped dumps.
prlimit --pid $$ --core=1:1 2>/dev/null || ulimit -c 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/../../.." && pwd)"
REPO="$(cd "$PKG/../.." && pwd)"
OUT="${NATIVE_CHECKS_OUT:-$PKG/domain-core/.build/native-checks}"
MANIFEST="$HERE/checks.tsv"
JOBS="${JOBS:-3}"
CXX="${CXX:-g++}"
CHECK_TRAP="${CHECK_TRAP:-1}"
CHECK_TIMEOUT="${CHECK_TIMEOUT:-300}"
DUEL_DATA_DIR="${DUEL_DATA_DIR:-$REPO/data/duel-engine-next}"

with_pending=0
with_domain=0
list_only=0
names=()
for arg in "$@"; do
  case "$arg" in
    --pending) with_pending=1 ;;
    --domain) with_domain=1 ;;
    --list) list_only=1 ;;
    --clean) rm -rf "${OUT:?}"; echo "deleted $OUT"; exit 0 ;;
    -h | --help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) names+=("$arg") ;;
  esac
done

# ---- manifest: name <TAB> source <TAB> args <TAB> status <TAB> note. status: ready | pending | domain | stale
rows_name=(); rows_src=(); rows_args=(); rows_status=(); rows_note=()
while IFS=$'\t' read -r name src args status note; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  [[ "$args" == - ]] && args=""
  rows_name+=("$name"); rows_src+=("$src"); rows_args+=("$args"); rows_status+=("$status"); rows_note+=("${note:-}")
done < "$MANIFEST"

if ((list_only)); then
  printf '%-28s %-9s %s\n' NAME STATUS NOTE
  for i in "${!rows_name[@]}"; do printf '%-28s %-9s %s\n' "${rows_name[$i]}" "${rows_status[$i]}" "${rows_note[$i]}"; done
  exit 0
fi

# ---- select rows
sel=()
for i in "${!rows_name[@]}"; do
  if ((${#names[@]} > 0)); then
    for n in "${names[@]}"; do [[ "$n" == "${rows_name[$i]}" ]] && sel+=("$i"); done
  elif ((with_domain)); then
    # Domain mode: only the Domain rows, and they count as ready (the tree has the Domain layer).
    [[ "${rows_status[$i]}" == domain ]] && sel+=("$i")
  else
    sel+=("$i")
  fi
  if ((with_domain)) && [[ "${rows_status[$i]}" == domain ]]; then rows_status[$i]=ready; fi
done
for n in ${names[@]+"${names[@]}"}; do
  found=0; for r in "${rows_name[@]}"; do [[ "$r" == "$n" ]] && found=1; done
  ((found)) || { echo "no check named $n (see --list)" >&2; exit 2; }
done

# No MULTI_TREE: build the repo series (domain-core/patches) on the pinned ygopro-core into $OUT/multi-core-tree. This is
# what CI does (npm run test:native). prepare-multi-core-tree.sh keeps a current tree and needs the network only for the
# first clone of the pinned ygopro-core and Lua.
if [[ -z "${MULTI_TREE:-}" ]]; then
  MULTI_TREE="$OUT/multi-core-tree"
  echo "== core tree: the repo patch series (prepare-multi-core-tree.sh)"
  mkdir -p "$OUT/logs"
  MULTI_TREE="$MULTI_TREE" bash "$PKG/scripts/prepare-multi-core-tree.sh" > "$OUT/logs/prepare-tree.log" 2>&1 \
    || { tail -n 20 "$OUT/logs/prepare-tree.log"; echo "core tree prepare failed (see $OUT/logs/prepare-tree.log)" >&2; exit 2; }
fi
MULTI_TREE="$(cd "$MULTI_TREE" && pwd)"
[[ -f "$MULTI_TREE/field.h" && -f "$MULTI_TREE/ocgapi.h" ]] || { echo "MULTI_TREE has no field.h / ocgapi.h: $MULTI_TREE" >&2; exit 2; }
[[ -f "$DUEL_DATA_DIR/cards.cdb" && -d "$DUEL_DATA_DIR/card-scripts" ]] || { echo "DUEL_DATA_DIR has no cards.cdb / card-scripts: $DUEL_DATA_DIR" >&2; exit 2; }
tree_id="$(git -C "$MULTI_TREE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if ((with_domain)); then
  # Copy of the core tree with the Domain layer. It is made again on every run (a copy and four node runs, a few seconds).
  mkdir -p "$OUT/logs"
  DOMAIN_TREE="$OUT/domain-tree"
  rm -rf "${DOMAIN_TREE:?}"; mkdir -p "$DOMAIN_TREE"
  tar -C "$MULTI_TREE" --exclude=.git -c . | tar -x -C "$DOMAIN_TREE"
  {
    node "$PKG/domain-core/src/apply-domain-multi.mjs" pre "$DOMAIN_TREE" &&
      node "$PKG/domain-core/src/apply-domain-patch.mjs" "$DOMAIN_TREE" &&
      node "$PKG/domain-core/src/apply-domain-multi.mjs" post "$DOMAIN_TREE"
  } > "$OUT/logs/domain-tree.log" 2>&1 || { tail -n 20 "$OUT/logs/domain-tree.log"; echo "Domain layer did not apply to $MULTI_TREE (see $OUT/logs/domain-tree.log)" >&2; exit 2; }
  # The id goes into the library stamp, so a changed Domain layer makes CHECKS_SKIP_LIB build the library again.
  tree_id="$tree_id+domain-$(cat "$PKG"/domain-core/src/apply-domain-multi.mjs "$PKG"/domain-core/src/apply-domain-patch.mjs "$PKG"/domain-core/src/domain_master.* | sha256sum | cut -c1-8)"
  MULTI_TREE="$DOMAIN_TREE"
fi
echo "core tree: $MULTI_TREE (HEAD $tree_id)"
echo "build dir: $OUT"
mkdir -p "$OUT/obj" "$OUT/lua-obj" "$OUT/bin" "$OUT/logs" "$OUT/tmp" "$OUT/data"

# ---- Lua sources (re-extracted when the pinned Lua ref changes, like scripts/build-native-core.sh)
export DOMAIN_ROOT="$REPO"
# shellcheck source=../../multi-core-common.sh
source "$PKG/scripts/multi-core-common.sh"
if [[ -z "${LUA_SRC:-}" ]]; then
  LUA_SRC="$OUT/lua-src"
  if [[ ! -f "$LUA_SRC/lua.h" || "$(cat "$OUT/lua-src.ref" 2>/dev/null || true)" != "$LUA_REF" ]]; then
    ensure_caches
    rm -rf "$LUA_SRC" "$OUT/lua-obj"; mkdir -p "$LUA_SRC" "$OUT/lua-obj"
    archive_tree "$CACHE_LUA" "$LUA_REF" "$LUA_SRC"
    echo "$LUA_REF" > "$OUT/lua-src.ref"
  fi
fi
[[ -f "$LUA_SRC/lua.h" ]] || { echo "LUA_SRC has no lua.h: $LUA_SRC" >&2; exit 2; }

SAN=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
DEFS=()
[[ "$CHECK_TRAP" == 1 ]] && DEFS=(-DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS)
# -g1: line tables for sanitizer stack traces only (full -g makes the objects very large).
COMMON=(-O1 -g1 "${SAN[@]}" -fno-rtti "${DEFS[@]}" -I"$LUA_SRC" -I"$MULTI_TREE")
CORE_SOURCES=(card duel effect field interpreter libcard libdebug libduel libeffect libgroup ocgapi operations playerop processor_visit processor scriptlib)
# Same rule as scripts/build-native-core.sh: the Domain layer is one extra source file, present only in Domain trees.
[[ -f "$MULTI_TREE/domain_master.cpp" ]] && CORE_SOURCES+=(domain_master)
LUA_SOURCES=(lapi lauxlib lbaselib lcode lcorolib lctype ldblib ldebug ldo ldump lfunc lgc linit liolib llex lmathlib lmem loadlib lobject lopcodes loslib lparser lstate lstring lstrlib ltable ltablib ltm lundump lutf8lib lvm lzio)
export CXX OUT LUA_SRC MULTI_TREE
export COMMON_STR="${COMMON[*]}"

compile_job() {
  local kind="$1" name="$2"
  IFS=' ' read -r -a C <<< "$COMMON_STR"
  if [[ "$kind" == lua ]]; then
    [[ -f "$OUT/lua-obj/$name.o" ]] && return 0
    "$CXX" -x c++ -w "${C[@]}" -c "$LUA_SRC/$name.c" -o "$OUT/lua-obj/$name.o"
  else
    "$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter "${C[@]}" -c "$MULTI_TREE/$name.cpp" -o "$OUT/obj/$name.o"
  fi
}
export -f compile_job

LIB="$OUT/libocgcore-multi.a"
# The library is reused (CHECKS_SKIP_LIB=1) only when it was built from this exact core tree, Lua pin and flags.
lib_stamp="tree=$MULTI_TREE head=$tree_id lua=${LUA_REF:-} lua_src=$LUA_SRC trap=$CHECK_TRAP core=${CORE_SOURCES[*]}"
if [[ "${CHECKS_SKIP_LIB:-0}" == 1 && -f "$LIB" && "$(cat "$OUT/lib.stamp" 2>/dev/null || true)" != "$lib_stamp" ]]; then
  echo "CHECKS_SKIP_LIB=1 ignored: the library in $OUT was built from a different core tree, Lua pin or flags"
  CHECKS_SKIP_LIB=0
fi
if [[ "${CHECKS_SKIP_LIB:-0}" != 1 || ! -f "$LIB" ]]; then
  echo "== core library (trap=$CHECK_TRAP, $JOBS jobs)"
  start=$SECONDS
  rm -f "$OUT"/obj/*.o "$OUT"/lua-obj/*.o "$LIB" "$OUT/lib.stamp"
  {
    for n in "${LUA_SOURCES[@]}"; do echo "lua $n"; done
    for n in "${CORE_SOURCES[@]}"; do echo "core $n"; done
  } | xargs -P "$JOBS" -L 1 bash -c 'compile_job "$0" "$1"' > "$OUT/logs/build-core.log" 2>&1
  rc=$?
  if ((rc != 0)); then tail -n 30 "$OUT/logs/build-core.log"; echo "core build FAILED"; exit 2; fi
  ar rcs "$LIB" "$OUT"/obj/*.o "$OUT"/lua-obj/*.o
  echo "$lib_stamp" > "$OUT/lib.stamp"
  echo "core library built in $((SECONDS - start))s, warnings: $(LC_ALL=C /usr/bin/grep -c 'warning:' "$OUT/logs/build-core.log" || true)"
fi

# ---- cards.tsv (card data as text, the native build has no sqlite headers). Made again when DUEL_DATA_DIR changes.
if [[ ! -f "$OUT/data/cards.tsv" || "$(cat "$OUT/data/source.stamp" 2>/dev/null || true)" != "$DUEL_DATA_DIR" ]]; then
  rm -f "$OUT/data/cards.tsv" "$OUT/data/source.stamp"
  (cd "$REPO" && node "$PKG/scripts/native/dump-card-data.mjs" --data "$DUEL_DATA_DIR" --out "$OUT/data") > "$OUT/logs/dump-card-data.log" 2>&1 \
    || { tail -n 10 "$OUT/logs/dump-card-data.log"; echo "dump-card-data failed"; exit 2; }
  echo "$DUEL_DATA_DIR" > "$OUT/data/source.stamp"
fi

# ---- compile the selected checks (once per source file, in parallel)
want_src=()
for i in "${sel[@]}"; do
  [[ "${rows_status[$i]}" != ready && $with_pending -eq 0 && ${#names[@]} -eq 0 ]] && continue
  s="${rows_src[$i]}"; dup=0
  for w in ${want_src[@]+"${want_src[@]}"}; do [[ "$w" == "$s" ]] && dup=1; done
  ((dup)) || want_src+=("$s")
done
build_check() {
  local src="$1"
  rm -f "$OUT/bin/$src"   # a failed compile must not leave the binary of an earlier run
  IFS=' ' read -r -a C <<< "$COMMON_STR"
  "$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter "${C[@]}" -I"$HERE" "$HERE/$src.cpp" "$LIB" -o "$OUT/bin/$src" > "$OUT/logs/build-$src.log" 2>&1
}
export -f build_check
export HERE LIB
echo "== compile ${#want_src[@]} check programs"
rm -f "$OUT/logs/build-failed.txt"
start=$SECONDS
printf '%s\n' ${want_src[@]+"${want_src[@]}"} | xargs -P "$JOBS" -I{} bash -c 'build_check {} || echo "BUILD-FAIL {}" >> "$OUT/logs/build-failed.txt"'
echo "compiled in $((SECONDS - start))s"

# ---- run
export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0}:disable_coredump=0"
export UBSAN_OPTIONS="${UBSAN_OPTIONS:-print_stacktrace=1:halt_on_error=1}"
export CHECK_SCRIPTS="$DUEL_DATA_DIR/card-scripts" CHECK_DATA="$OUT/data" TMPDIR="$OUT/tmp"
pass=0; fail=0; skipped=0
failed_names=()
echo "== run"
cd "$REPO" || exit 2
for i in "${sel[@]}"; do
  name="${rows_name[$i]}"; src="${rows_src[$i]}"; status="${rows_status[$i]}"
  if [[ "$status" != ready && $with_pending -eq 0 && ${#names[@]} -eq 0 ]]; then
    printf 'SKIP  %-34s %s: %s\n' "$name" "$status" "${rows_note[$i]}"
    skipped=$((skipped + 1)); continue
  fi
  args="${rows_args[$i]//@DATA@/$OUT/data}"; args="${args//@SCRIPTS@/$CHECK_SCRIPTS}"
  log="$OUT/logs/run-$name-$i.log"
  label="$name"; [[ -n "${rows_args[$i]}" && "${rows_args[$i]}" != *@* ]] && label="$name ${rows_args[$i]}"
  if [[ ! -x "$OUT/bin/$src" ]]; then
    printf 'FAIL  %-34s does not compile (see %s)\n' "$name" "$OUT/logs/build-$src.log"
    tail -n 8 "$OUT/logs/build-$src.log" | sed 's/^/        /'
    if [[ "$status" == ready ]]; then fail=$((fail + 1)); failed_names+=("$name"); else skipped=$((skipped + 1)); fi
    continue
  fi
  t0=$SECONDS
  # shellcheck disable=SC2086
  timeout "$CHECK_TIMEOUT" "$OUT/bin/$src" $args > "$log" 2>&1
  rc=$?
  dt=$((SECONDS - t0))
  if ((rc == 0)); then
    printf 'PASS  %-34s %ss\n' "$label" "$dt"; pass=$((pass + 1))
  else
    verdict=FAIL; [[ "$status" == ready ]] || verdict="FAIL ($status)"
    printf '%s  %-34s exit %s, %ss, log %s\n' "$verdict" "$label" "$rc" "$dt" "$log"
    LC_ALL=C /usr/bin/grep -m 6 -E '^FAIL|runtime error|ERROR: AddressSanitizer|YGO_N_TRAP|^RESULT .* FAIL' "$log" | cut -c1-200 | sed 's/^/        /'
    if [[ "$status" == ready ]]; then fail=$((fail + 1)); failed_names+=("$name"); else skipped=$((skipped + 1)); fi
  fi
done
echo "== native checks: $pass pass, $fail fail, $skipped skipped or pending (core $tree_id)"
((fail > 0)) && echo "failed: ${failed_names[*]}"
((fail == 0))
