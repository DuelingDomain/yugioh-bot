#!/usr/bin/env bash
# Build the native nduel driver and run the N-duelist matrix.
#
#   bash packages/duel-server/scripts/run-nduel.sh
#   NDUEL_SEEDS=5 NDUEL_CASES="n2 n3" bash packages/duel-server/scripts/run-nduel.sh
#   NDUEL_PATCHES=/path/to/out/0046-x.patch bash packages/duel-server/scripts/run-nduel.sh
#
# Steps: (1) build libocgcore-multi.a with -DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS into its own folder,
# (2) compile nduel.cpp against it, (3) run the matrix with at most NDUEL_JOBS processes,
# (4) write $NDUEL_STATUS_DIR/nduel-summary.json (default $REPO/.status) and print a table. Exit code 1 when a run fails.
#
# Environment (all optional):
#   NDUEL_DIR        work folder (default domain-core/.build/nduel)
#   NDUEL_TREE       MULTI_TREE for the core source tree (default $NDUEL_DIR/tree)
#   NDUEL_PATCHES    EXTRA_PATCHES: patch files (or mbox files) applied AFTER the repo series. Default: none, so the core is
#                    the repo series domain-core/patches/NNNN-*.patch on the pinned ygopro-core (prepare-multi-core-tree.sh).
#   NDUEL_PATCH_LIMIT PATCH_LIMIT: apply only the first N repo patches. Default 0 = ALL repo patches. Do not set it in CI:
#                    the nightly fuzz must test the core that ships. Use it to bisect (for example 2 = the two base fixes).
#   NDUEL_NO_LOCK=1  do not wait for a build slot. The default uses domain-core/.build/phase1/run-locked.sh when that file
#                    exists (a local convenience that keeps parallel agents from overloading the machine) and runs the
#                    commands directly when it does not (CI, a clean checkout).
#   DUEL_DATA_DIR    engine data with cards.cdb and card-scripts (default $REPO/data/duel-engine-next, as in CI)
#   DUEL_MULTI_SCRIPTS_DIR  Lua overlay folder for n>2 (mp-utility.lua, card suffixes). Default: the repo folder
#                    packages/duel-server/domain-core/multi-scripts. n=2 runs ignore it (they read the original scripts only).
#   NDUEL_STATUS_DIR folder for nduel-summary.json and nduel-check.json (default $REPO/.status). Set it when two runs share one tree.
#   NDUEL_SEEDS      seeds per case (default 20)    NDUEL_TURNS  turn limit (default 60)
#   NDUEL_LP         starting LP (default 3000)     NDUEL_JOBS   parallel runs (default 3, max 3)
#   NDUEL_CASES      space list of: n2 n2b n2s n3 n4 tag d3 d4 dtag (default: the first six, plus d* with NDUEL_DOMAIN=1; n2b = repeat of n2, n2s = --setup-always)
#   NDUEL_DOMAIN=1   also run d3, d4, dtag (ffa3, ffa4, tag with --domain: domain.lua and one Deck Master per seat).
#                    They need a second native lib built with APPLY_DOMAIN=1 DOMAIN_MULTI=1 (build-native-core.sh),
#                    in $NDUEL_DIR/domain-native with its own tree and binary $NDUEL_DIR/nduel-domain.
#                    NDUEL_DOMAIN_MULTI=0 builds the stock Domain layer only (enough for a --domain --n 2 check).
#                    Without the D1 layer that build stops and the script says so. The n=2 cases do not use it.
#   NDUEL_SKIP_BUILD=1 reuse the built lib and binary
#   NDUEL_CENSUS=1   census build: native/census.patch is applied to the census tree only (not the core series) and
#                    opponent_of logs each missed site once per process and goes on (-DYGO_N_TRAP_LOG). The summary gets
#                    census: [{file, line, fn, runs, firstCase, firstSeed}]. Default NDUEL_DIR becomes .../nduel/census.
#   NDUEL_FUTURE=1   pass --check-future (checks that need the T3/T4/T5 core work become failures)
#
# Golden hashes (scripts/native/golden.tsv: n, mode, seed, steps, hash; line 2 holds the turns and LP used):
#   run-nduel.sh --record   run n=2 (and n>2 when the core has Debug.SetupDuelists) and write golden.tsv
#   run-nduel.sh --check    rerun every golden row, print one line per mismatch, exit 1 on any mismatch;
#                           also writes $REPO/.status/nduel-check.json (mismatches with an exact cmd)
# Golden metadata fingerprints the scripts/database/strings pins from prepare-data.ts, the Lua overlay and patches.
# A data bump or overlay/patch edit needs an explicit
# --record before --check can run: the updater must never synchronize this historical fingerprint automatically.
#   run-nduel.sh --one <case> <seed>   run one duel (case: n2 n2b n2s n3 n4 tag) with its output on the terminal,
#                           with --trace unless NDUEL_TRACE=0. Builds first unless NDUEL_SKIP_BUILD=1.
# The summary gives an exact `cmd` (full nduel command line, with --trace) for every trap, failure and census site.
# Rows for n>2 are skipped with a note when the core has no Debug.SetupDuelists.
set -uo pipefail
# WSL captures a crash dump of every aborting process (wsl-capture-crash in core_pattern). The trap builds abort on
# purpose, and many dumps at once crashed WSL twice (2026-09-30). RLIMIT_CORE of exactly 1 byte makes the kernel skip piped dumps (bash ulimit -c counts 512-byte blocks).
prlimit --pid $$ --core=1:1 2>/dev/null || ulimit -c 0

MODE_RUN=matrix
ONE_CASE=""; ONE_SEED=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --record) MODE_RUN=record ;;
    --check) MODE_RUN=check ;;
    --one)
      [[ $# -ge 3 ]] || { echo "usage: run-nduel.sh --one <case> <seed>" >&2; exit 2; }
      MODE_RUN=one; ONE_CASE="$2"; ONE_SEED="$3"; shift 2 ;;
    *) echo "usage: run-nduel.sh [--record|--check|--one <case> <seed>]" >&2; exit 2 ;;
  esac
  shift
done

PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$PKG/../.." && pwd)"
GOLDEN="$PKG/scripts/native/golden.tsv"
MULTI_DIR="${DUEL_MULTI_SCRIPTS_DIR:-$PKG/domain-core/multi-scripts}"
# Check metadata before creating work directories, building a core, dumping card data or running any native duels.
DATA_PINS_SHA256=""
MULTI_SCRIPTS_SHA256=""; PATCHES_SHA256=""
if [[ "$MODE_RUN" == check || "$MODE_RUN" == record ]]; then
  if [[ ${NDUEL_PATCHES+x} || ${NDUEL_PATCH_LIMIT+x} ]]; then
    echo "golden modes require NDUEL_PATCHES and NDUEL_PATCH_LIMIT to be unset" >&2; exit 2
  fi
  if [[ "$MODE_RUN" == check && ! -f "$GOLDEN" ]]; then
    echo "no golden file: $GOLDEN (run --record first)" >&2; exit 2
  fi
  DATA_PINS_SHA256="$(python3 - "$PKG/scripts/prepare-data.ts" "$GOLDEN" "$MODE_RUN" <<'PY'
import hashlib, json, re, sys
source, golden, mode = sys.argv[1:]
text = open(source).read()
block = re.search(r"const sources\s*=\s*\{(.*?)\};", text, re.S)
pins = {}
for key in ("scripts", "database", "strings"):
    match = re.search(r'\b' + key + r':\s*"([0-9a-f]{40})"', block.group(1) if block else "")
    if not match:
        sys.exit(f"cannot read current {key} data pin from {source}")
    pins[key] = match.group(1)
# Canonical JSON uses this key order, no spaces or trailing newline. Only the digest is historical metadata:
# embedding raw SHAs here would make the data updater mistake them for another live pin to synchronize.
fingerprint = hashlib.sha256(json.dumps(pins, separators=(",", ":")).encode()).hexdigest()
if mode == "check":
    recorded = re.findall(r"^# data-pins-sha256=([0-9a-f]{64})$", open(golden).read(), re.M)
    if recorded != [fingerprint]:
        sys.exit("data pins changed: re-record with run-nduel.sh --record")
print(fingerprint)
PY
  )" || exit 1
  FOLDER_HASHES="$(python3 - "$MULTI_DIR" "$PKG/domain-core/patches" "$GOLDEN" "$MODE_RUN" <<'PY'
import hashlib, pathlib, re, sys
overlay, patches, golden, mode = sys.argv[1:]
def folder_hash(directory, pattern="*"):
    root = pathlib.Path(directory)
    if not root.is_dir():
        sys.exit(f"missing golden input folder: {directory}")
    # Same algorithm as src/multi-scripts.ts multiScriptsFolderHash: bytewise sorted
    # relative paths, each followed by NUL, the file's SHA-256 and a newline.
    # Only *.patch files affect the patch series, as in the core cache keys.
    files = [p for p in root.rglob(pattern) if p.is_file() and not p.is_symlink()]
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda p: p.relative_to(root).as_posix().encode()):
        name = path.relative_to(root).as_posix()
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        digest.update(f"{name}\0{sha}\n".encode())
    return digest.hexdigest()
hashes = {"multi-scripts": folder_hash(overlay), "patches": folder_hash(patches, "*.patch")}
if mode == "check":
    metadata = open(golden).read()
    for field, digest in hashes.items():
        if re.findall(r"^# " + field + r"-sha256=([0-9a-f]{64})$", metadata, re.M) != [digest]:
            sys.exit("overlay/patches changed: re-record with run-nduel.sh --record")
print(*hashes.values())
PY
  )" || exit 1
  read -r MULTI_SCRIPTS_SHA256 PATCHES_SHA256 <<< "$FOLDER_HASHES"
fi
P1="$PKG/domain-core/.build/phase1"
DATA_DIR="${DUEL_DATA_DIR:-$REPO/data/duel-engine-next}"
# Build slots: only where the local lock script exists (it is gitignored, so CI has none).
LOCKER=()
if [[ "${NDUEL_NO_LOCK:-0}" != 1 && -f "$P1/run-locked.sh" ]]; then LOCKER=(bash "$P1/run-locked.sh" build 2); fi
CENSUS="${NDUEL_CENSUS:-0}"
if [[ "$CENSUS" == 1 ]]; then DIR="${NDUEL_DIR:-$PKG/domain-core/.build/nduel/census}"; DEFS="-DYGO_N_TRAP_LOG -D_GLIBCXX_ASSERTIONS"
else DIR="${NDUEL_DIR:-$PKG/domain-core/.build/nduel}"; DEFS="-DYGO_N_TRAP -D_GLIBCXX_ASSERTIONS"; fi
SEEDS="${NDUEL_SEEDS:-20}"
TURNS="${NDUEL_TURNS:-60}"
LP="${NDUEL_LP:-3000}"
JOBS="${NDUEL_JOBS:-3}"
(( JOBS > 3 )) && JOBS=3
CASES="${NDUEL_CASES:-n2 n2b n2s n3 n4 tag}"
DOMAIN="${NDUEL_DOMAIN:-0}"
if [[ "$DOMAIN" == 1 && -z "${NDUEL_CASES:-}" ]]; then CASES="$CASES d3 d4 dtag"; fi
if [[ "$DOMAIN" != 1 ]]; then
  KEEP=""; for c in $CASES; do case "$c" in d3|d4|dtag) echo "note: case $c skipped: it needs NDUEL_DOMAIN=1" >&2 ;; *) KEEP="$KEEP $c" ;; esac; done
  CASES="${KEEP# }"
fi
PATCHES="${NDUEL_PATCHES:-}"
LIMIT="${NDUEL_PATCH_LIMIT:-0}"
TREE="${NDUEL_TREE:-$DIR/tree}"
NATIVE="$DIR/native"
BIN="$DIR/nduel"
BIN_DOMAIN="$DIR/nduel-domain"
DTREE="$DIR/domain-tree"; DNATIVE="$DIR/domain-native"
# LeakSanitizer: one known leak of the stock core (field::check_chain_counter, a duel destroyed while a chain is open) is suppressed,
# see scripts/native/lsan.supp. Any other leak still fails the run.
export LSAN_OPTIONS="suppressions=$PKG/scripts/native/lsan.supp${LSAN_OPTIONS:+:$LSAN_OPTIONS}"
RUNS="$DIR/runs"
STATUS_DIR="${NDUEL_STATUS_DIR:-$REPO/.status}"
mkdir -p "$DIR" "$STATUS_DIR"
if [[ "$MODE_RUN" == check ]]; then
  TURNS="$(sed -n 's/^#.*turns=\([0-9]*\).*/\1/p' "$GOLDEN" | head -1)"; TURNS="${TURNS:-60}"
  LP="$(sed -n 's/^#.*lp=\([0-9]*\).*/\1/p' "$GOLDEN" | head -1)"; LP="${LP:-3000}"
fi
[[ "$MODE_RUN" == record ]] && CASES="${NDUEL_CASES:-n2 n3 n4 tag}"

if [[ "${NDUEL_SKIP_BUILD:-0}" != 1 ]]; then
  echo "== build core (repo series, PATCH_LIMIT=$LIMIT, extra patches: ${PATCHES:-none})"
  if [[ "$CENSUS" == 1 ]]; then
    MULTI_TREE="$TREE" EXTRA_PATCHES="$PATCHES" PATCH_LIMIT="$LIMIT" bash "$PKG/scripts/prepare-multi-core-tree.sh" > "$DIR/prepare.log" 2>&1 \
      || { tail -20 "$DIR/prepare.log"; echo "tree prepare failed"; exit 2; }
    if ! git -C "$TREE" log -1 --format=%s | grep -q '^census:'; then
      patch -p1 -d "$TREE" < "$PKG/scripts/native/census.patch" > "$DIR/census-apply.log" 2>&1 \
        || { cat "$DIR/census-apply.log"; echo "census.patch does not apply"; exit 2; }
      git -C "$TREE" add -A && git -C "$TREE" -c user.name=census -c user.email=census@local commit -q -m "census: log missed opponent_of sites" \
        || { echo "census commit failed"; exit 2; }
    fi
  fi
  if ! ${LOCKER[@]+"${LOCKER[@]}"} env JOBS="${NDUEL_BUILD_JOBS:-3}" SKIP_SMOKE=1 NATIVE_OUT="$NATIVE" MULTI_TREE="$TREE" \
      EXTRA_PATCHES="$PATCHES" PATCH_LIMIT="$LIMIT" EXTRA_CXXFLAGS="$DEFS" \
      bash "$PKG/scripts/build-native-core.sh" > "$DIR/build.log" 2>&1; then
    tail -30 "$DIR/build.log"; echo "core build failed (see $DIR/build.log)"; exit 2
  fi
  echo "== compile nduel"
  if ! ${LOCKER[@]+"${LOCKER[@]}"} \
      "${CXX:-g++}" -std=c++17 -Wall -Wextra -Wno-unused-parameter -O1 -g1 -fsanitize=address,undefined \
      -fno-omit-frame-pointer -fno-sanitize-recover=undefined -fno-rtti -I"$NATIVE/lua-src" -I"$TREE" \
      $DEFS "$PKG/scripts/native/nduel.cpp" "$NATIVE/libocgcore-multi.a" -o "$BIN" \
      > "$DIR/nduel-build.log" 2>&1; then
    tail -30 "$DIR/nduel-build.log"; echo "nduel compile failed"; exit 2
  fi
  if [[ "$DOMAIN" == 1 && "$CENSUS" != 1 ]]; then
    echo "== build Domain core (APPLY_DOMAIN=1 DOMAIN_MULTI=1)"
    if ! ${LOCKER[@]+"${LOCKER[@]}"} env JOBS="${NDUEL_BUILD_JOBS:-3}" SKIP_SMOKE=1 NATIVE_OUT="$DNATIVE" MULTI_TREE="$DTREE" \
        EXTRA_PATCHES="$PATCHES" PATCH_LIMIT="$LIMIT" EXTRA_CXXFLAGS="$DEFS" APPLY_DOMAIN=1 DOMAIN_MULTI="${NDUEL_DOMAIN_MULTI:-1}" \
        bash "$PKG/scripts/build-native-core.sh" > "$DIR/domain-build.log" 2>&1; then
      tail -30 "$DIR/domain-build.log"; echo "Domain core build failed (see $DIR/domain-build.log). Needs the D1 layer in build-native-core.sh."; exit 2
    fi
    if ! ${LOCKER[@]+"${LOCKER[@]}"} \
        "${CXX:-g++}" -std=c++17 -Wall -Wextra -Wno-unused-parameter -O1 -g1 -fsanitize=address,undefined \
        -fno-omit-frame-pointer -fno-sanitize-recover=undefined -fno-rtti -I"$DNATIVE/lua-src" -I"$DNATIVE/domain-tree" \
        $DEFS "$PKG/scripts/native/nduel.cpp" "$DNATIVE/libocgcore-multi.a" -o "$BIN_DOMAIN" \
        > "$DIR/nduel-domain-build.log" 2>&1; then
      tail -30 "$DIR/nduel-domain-build.log"; echo "nduel (Domain) compile failed"; exit 2
    fi
  fi
fi
[[ -x "$BIN" ]] || { echo "missing $BIN"; exit 2; }
if [[ "$DOMAIN" == 1 ]]; then [[ -x "$BIN_DOMAIN" ]] || { echo "missing $BIN_DOMAIN"; exit 2; }; fi

if [[ ! -f "$DIR/data/cards.tsv" || ! -f "$DIR/data/pool.txt" ]]; then
  echo "== dump card data"
  (cd "$REPO" && node "$PKG/scripts/native/dump-card-data.mjs" --data "$DATA_DIR" --out "$DIR/data") || exit 2
fi

# Job list: case|n|mode|extra|seed
rm -rf "$RUNS"; mkdir -p "$RUNS"
JOBFILE="$DIR/jobs.txt"; : > "$JOBFILE"
if [[ "$MODE_RUN" == one ]]; then
  case "$ONE_CASE" in
    n2|n2b) echo "$ONE_CASE 2 ffa - $ONE_SEED" ;;
    n2s) echo "$ONE_CASE 2 ffa --setup-always $ONE_SEED" ;;
    n3) echo "$ONE_CASE 3 ffa - $ONE_SEED" ;;
    n4) echo "$ONE_CASE 4 ffa - $ONE_SEED" ;;
    tag) echo "$ONE_CASE 4 tag - $ONE_SEED" ;;
    d3) echo "$ONE_CASE 3 ffa --domain $ONE_SEED" ;;
    d4) echo "$ONE_CASE 4 ffa --domain $ONE_SEED" ;;
    dtag) echo "$ONE_CASE 4 tag --domain $ONE_SEED" ;;
    *) echo "unknown case $ONE_CASE" >&2; exit 2 ;;
  esac > "$JOBFILE"
  CASES=""
  read -r c n mode extra seed < "$JOBFILE"
  args=(--n "$n" --mode "$mode" --seed "$seed" --turns "$TURNS" --lp "$LP" --data "$DIR/data" --scripts "$DATA_DIR/card-scripts" --multi-scripts "$MULTI_DIR")
  [[ "$extra" != "-" ]] && args+=("$extra")
  [[ "${NDUEL_FUTURE:-0}" == 1 ]] && args+=(--check-future)
  [[ "${NDUEL_TRACE:-1}" != 0 ]] && args+=(--trace)
  ONE_BIN="$BIN"; [[ "$extra" == "--domain" ]] && ONE_BIN="$BIN_DOMAIN"
  echo "cmd: cd $REPO && $ONE_BIN ${args[*]}"
  cd "$REPO"
  ASAN_OPTIONS="detect_leaks=1:disable_coredump=0" UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1" "$ONE_BIN" "${args[@]}"
  exit $?
fi
if [[ "$MODE_RUN" == check ]]; then
  awk -F'\t' 'NR>1 && $1 !~ /^#/ && NF>=5 { c = ($1==2) ? "n2" : ($2=="tag" ? "tag" : "n" $1); print c, $1, $2, "-", $3 }' "$GOLDEN" > "$JOBFILE"
  CASES="n2 n3 n4 tag"
fi
for c in $([[ "$MODE_RUN" == check ]] && echo "" || echo "$CASES"); do
  for ((s = 1; s <= SEEDS; s++)); do
    case "$c" in
      n2)  echo "$c 2 ffa - $s" ;;
      n2b) echo "$c 2 ffa - $s" ;;
      n2s) echo "$c 2 ffa --setup-always $s" ;;
      n3)  echo "$c 3 ffa - $s" ;;
      n4)  echo "$c 4 ffa - $s" ;;
      tag) echo "$c 4 tag - $s" ;;
      d3)  echo "$c 3 ffa --domain $s" ;;
      d4)  echo "$c 4 ffa --domain $s" ;;
      dtag) echo "$c 4 tag --domain $s" ;;
      *) echo "unknown case $c" >&2; exit 2 ;;
    esac >> "$JOBFILE"
  done
done

run_one() {
  local c=$1 n=$2 mode=$3 extra=$4 seed=$5
  local out="$RUNS/$c-$seed"
  local args=(--n "$n" --mode "$mode" --seed "$seed" --turns "$TURNS" --lp "$LP" --data "$DIR/data" --scripts "$DATA_DIR/card-scripts" --multi-scripts "$MULTI_DIR")
  [[ "$extra" != "-" ]] && args+=("$extra")
  [[ "${NDUEL_FUTURE:-0}" == 1 ]] && args+=(--check-future)
  cd "$REPO"
  ASAN_OPTIONS="detect_leaks=1:disable_coredump=0" UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1" \
    timeout 900 "$([[ "$extra" == "--domain" ]] && echo "$BIN_DOMAIN" || echo "$BIN")" "${args[@]}" > "$out.out" 2> "$out.err"
  echo $? > "$out.rc"
}
export -f run_one
export RUNS REPO BIN BIN_DOMAIN DIR TURNS LP NDUEL_FUTURE DATA_DIR MULTI_DIR
echo "== run $(wc -l < "$JOBFILE") duels, $JOBS at a time"
xargs -P "$JOBS" -L 1 bash -c 'run_one "$@"' _ < "$JOBFILE"

if [[ "$MODE_RUN" != matrix ]]; then
  NDUEL_MULTI_SCRIPTS_SHA256="$MULTI_SCRIPTS_SHA256" NDUEL_PATCHES_SHA256="$PATCHES_SHA256" \
  NDUEL_DATA_PINS_SHA256="$DATA_PINS_SHA256" NDUEL_MULTI_DIR="$MULTI_DIR" NDUEL_DATA_DIR="$DATA_DIR" NDUEL_REPO="$REPO" NDUEL_BIN="$BIN" NDUEL_DIRV="$DIR" python3 - "$MODE_RUN" "$RUNS" "$GOLDEN" "$TURNS" "$LP" "$JOBFILE" "$STATUS_DIR/nduel-check.json" <<'PY'
import os, re, sys
mode, runs, golden, turns, lp, jobfile, checkout = sys.argv[1:8]
import json, datetime
def cmd_for(n, m, seed):
    extra = " --check-future" if os.environ.get("NDUEL_FUTURE") == "1" else ""
    return f"cd {os.environ['NDUEL_REPO']} && {os.environ['NDUEL_BIN']} --n {n} --mode {m} --seed {seed} --turns {turns} --lp {lp} --data {os.environ['NDUEL_DIRV']}/data --scripts {os.environ['NDUEL_DATA_DIR']}/card-scripts --multi-scripts {os.environ['NDUEL_MULTI_DIR']}{extra} --trace"
def read(p):
    try: return open(p, errors="replace").read()
    except OSError: return ""
jobs = [l.split() for l in open(jobfile) if l.strip()]
results = {}
notes = set()
for c, n, m, _, seed in jobs:
    base = os.path.join(runs, f"{c}-{seed}")
    out, err = read(base + ".out"), read(base + ".err")
    ok = re.search(r"^NDUEL ok .*", out, re.M)
    if ok:
        f = dict(kv.split("=", 1) for kv in ok.group(0).split()[2:] if "=" in kv)
        results[(n, m, seed)] = ("ok", f["steps"], f["hash"])
    elif "SetupDuelists" in out:
        results[(n, m, seed)] = ("nosetup", "", "")
        notes.add(f"n={n} mode={m}")
    else:
        detail = (re.search(r"^NDUEL FAIL .*", out, re.M) or re.search(r".+", err[-300:] or "no output")).group(0)[:200]
        results[(n, m, seed)] = ("error", "", detail)
for x in sorted(notes): print(f"skip {x}: core has no Debug.SetupDuelists")
if mode == "record":
    rows = [(k, v) for k, v in results.items() if v[0] == "ok"]
    errs = [(k, v) for k, v in results.items() if v[0] == "error"]
    for k, v in errs: print(f"not recorded n={k[0]} mode={k[1]} seed={k[2]}: {v[2]}")
    tmp = golden + ".tmp"
    with open(tmp, "w") as fh:
        fh.write("n\tmode\tseed\tsteps\thash\n")
        fh.write(f"# turns={turns} lp={lp}\n")
        fh.write(f"# data-pins-sha256={os.environ['NDUEL_DATA_PINS_SHA256']}\n")
        fh.write(f"# multi-scripts-sha256={os.environ['NDUEL_MULTI_SCRIPTS_SHA256']}\n")
        fh.write(f"# patches-sha256={os.environ['NDUEL_PATCHES_SHA256']}\n")
        for (n, m, seed), v in sorted(rows, key=lambda r: (int(r[0][0]), r[0][1], int(r[0][2]))):
            fh.write(f"{n}\t{m}\t{seed}\t{v[1]}\t{v[2]}\n")
    os.replace(tmp, golden)
    print(f"recorded {len(rows)} rows in {golden}")
    sys.exit(1 if errs else 0)
want = {}
for i, l in enumerate(open(golden)):
    p = l.rstrip("\n").split("\t")
    if i == 0 or l.startswith("#") or len(p) < 5: continue
    want[(p[0], p[1], p[2])] = (p[3], p[4])
bad = 0; checked = 0; skipped = 0; mism = []
for k, (steps, h) in want.items():
    r = results.get(k)
    if r is None: continue
    if r[0] == "nosetup": skipped += 1; continue
    checked += 1
    if r[0] != "ok":
        print(f"MISMATCH n={k[0]} mode={k[1]} seed={k[2]}: run failed: {r[2]}\n  cmd: {cmd_for(*k)}"); bad += 1
        mism.append({"n": k[0], "mode": k[1], "seed": int(k[2]), "kind": "run-failed", "detail": r[2], "cmd": cmd_for(*k)})
    elif r[2] != h or r[1] != steps:
        print(f"MISMATCH n={k[0]} mode={k[1]} seed={k[2]}: golden steps={steps} hash={h}, now steps={r[1]} hash={r[2]}\n  cmd: {cmd_for(*k)}"); bad += 1
        mism.append({"n": k[0], "mode": k[1], "seed": int(k[2]), "kind": "hash", "goldenSteps": steps, "goldenHash": h, "nowSteps": r[1], "nowHash": r[2], "cmd": cmd_for(*k)})
print(f"golden check: {checked} rows checked, {skipped} skipped, {bad} mismatches")
json.dump({"mode": "check", "time": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "turns": int(turns), "lp": int(lp),
           "checked": checked, "skipped": skipped, "mismatches": mism, "failed": bad}, open(checkout, "w"), indent=2)
sys.exit(1 if bad else 0)
PY
  exit $?
fi

NDUEL_MULTI_DIR="$MULTI_DIR" NDUEL_DATA_DIR="$DATA_DIR" NDUEL_REPO="$REPO" NDUEL_BIN="$BIN" NDUEL_BIN_DOMAIN="$BIN_DOMAIN" NDUEL_DIRV="$DIR" python3 - "$RUNS" "$STATUS_DIR/nduel-summary.json" "$SEEDS" "$TURNS" "$LP" "$PATCHES" "$LIMIT" "$CASES" "$CENSUS" "$TREE" <<'PY'
import json, os, re, sys, collections, datetime
runs, outp, seeds, turns, lp, patches, limit, cases, census_mode, tree = sys.argv[1:11]
census_mode = census_mode == "1"
seeds = int(seeds)
trap_re = re.compile(r"YGO_N_TRAP (\S+) (\S+?):(\d+) p=(\d+)")
def read(p):
    try: return open(p, errors="replace").read()
    except OSError: return ""
summary = {"time": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "seeds": seeds, "turns": int(turns), "lp": int(lp),
           "patches": patches, "patchLimit": int(limit), "cases": {}, "traps": [], "sanitizer": [], "notes": {}}
trap_count = collections.Counter(); trap_first = {}
census_runs = collections.Counter(); census_first = {}
REPO_ = os.environ.get("NDUEL_REPO", ""); BIN_ = os.environ.get("NDUEL_BIN", ""); DIR_ = os.environ.get("NDUEL_DIRV", "")
CASE_ARGS = {"n2": "--n 2 --mode ffa", "n2b": "--n 2 --mode ffa", "n2s": "--n 2 --mode ffa --setup-always",
             "n3": "--n 3 --mode ffa", "n4": "--n 4 --mode ffa", "tag": "--n 4 --mode tag",
             "d3": "--n 3 --mode ffa --domain", "d4": "--n 4 --mode ffa --domain", "dtag": "--n 4 --mode tag --domain"}
def cmd_for(c, s):
    fut = " --check-future" if os.environ.get("NDUEL_FUTURE") == "1" else ""
    b = os.environ.get("NDUEL_BIN_DOMAIN", BIN_) if c[0] == "d" else BIN_
    return f"cd {REPO_} && {b} {CASE_ARGS[c]} --seed {s} --turns {turns} --lp {lp} --data {DIR_}/data --scripts {os.environ.get('NDUEL_DATA_DIR', '')}/card-scripts --multi-scripts {os.environ.get('NDUEL_MULTI_DIR', '')}{fut} --trace"
def enclosing_fn(base, line):
    try: lines = open(os.path.join(tree, base), errors="replace").read().split("\n")
    except OSError: return "?"
    for i in range(min(line, len(lines)) - 1, -1, -1):
        t = lines[i]
        if not t or t[0] in " \t}#/{" or t.startswith(("template", "case ", "namespace", "static const", "using", "typedef")): continue
        m = re.search(r"([A-Za-z_~][\w:~]*(?:<[^>]*>)?)\s*\(([^)]*)", t)
        if not m or t.rstrip().endswith(";"): continue
        arg = m.group(2).split(",")[0].strip()
        if m.group(1).startswith("LUA_") and arg: return "lua:" + arg
        pm = re.search(r"Processors::(\w+)", arg)
        return m.group(1) + (f"({pm.group(1)})" if pm else "")
    return "?"
hashes = {}
for c in cases.split():
    row = {"runs": 0, "ok": 0, "fail": 0, "trap": 0, "sanitizer": 0, "crash": 0, "unsupported": 0,
           "firstFailure": {}, "checks": {}, "winners": 0, "stopTurns": 0, "future": 0, "failures": []}
    for s in range(1, seeds + 1):
        base = os.path.join(runs, f"{c}-{s}")
        out, err = read(base + ".out"), read(base + ".err")
        rc = int((read(base + ".rc") or "-1").strip() or -1)
        row["runs"] += 1
        m = re.search(r"^NDUEL ok .*", out, re.M)
        traps = trap_re.findall(err)
        kind = None
        if traps and census_mode:
            for key in {(os.path.basename(f), int(l)) for _, f, l, _ in traps}:
                census_runs[key] += 1
                census_first.setdefault(key, {"case": c, "seed": s, "cmd": cmd_for(c, s)})
            traps = []
        if traps:
            kind = "trap"
            fn, f, l, p = traps[0]
            key = (os.path.basename(f), int(l))
            trap_count[key] += 1
            trap_first.setdefault(key, {"case": c, "seed": s, "fn": fn, "cmd": cmd_for(c, s)})
        elif "Sanitizer" in err or "runtime error:" in err:
            kind = "sanitizer"
            first = next((x for x in err.splitlines() if "ERROR:" in x or "runtime error:" in x), "")
            summary["sanitizer"].append({"case": c, "seed": s, "line": first[:300], "cmd": cmd_for(c, s)})
        elif m:
            kind = "ok"
            f = dict(kv.split("=", 1) for kv in m.group(0).split()[2:] if "=" in kv)
            hashes[(c, s)] = f.get("hash")
            if f.get("winner", "-1") != "-1": row["winners"] += 1
            if f.get("stop") == "turns": row["stopTurns"] += 1
            row["future"] += int(f.get("future", "0"))
        else:
            fm = re.search(r"^NDUEL FAIL (\S+) .*", out, re.M)
            if fm:
                chk = fm.group(1)
                if chk == "setup" and "SetupDuelists" in out:
                    kind = "unsupported"
                else:
                    kind = "fail"
                    row["checks"][chk] = row["checks"].get(chk, 0) + 1
                    row["firstFailure"].setdefault(chk, {"seed": s, "line": fm.group(0)[:300], "cmd": cmd_for(c, s)})
            else:
                kind = "crash"
                row["failures"].append({"seed": s, "rc": rc, "stderr": err[-300:], "cmd": cmd_for(c, s)})
        if kind == "ok": row["ok"] += 1
        elif kind == "unsupported": row["unsupported"] += 1
        else: row[kind] += 1
        for fn in re.findall(r"^NDUEL NOTE (\S+)", err, re.M):
            summary["notes"][fn] = summary["notes"].get(fn, 0) + 1
    summary["cases"][c] = row
# hash comparisons for n=2
cmp = {}
def compare(a, b, name):
    if not any(k[0] == a for k in hashes) or not any(k[0] == b for k in hashes): return
    diff = [s for s in range(1, seeds + 1) if (a, s) in hashes and (b, s) in hashes and hashes[(a, s)] != hashes[(b, s)]]
    both = sum(1 for s in range(1, seeds + 1) if (a, s) in hashes and (b, s) in hashes)
    cmp[name] = {"compared": both, "different": diff}
compare("n2", "n2b", "n2_repeat")
compare("n2", "n2s", "n2_setup_always")
summary["hashChecks"] = cmp
summary["mode"] = "census" if census_mode else "trap"
summary["census"] = [{"file": k[0], "line": k[1], "fn": enclosing_fn(k[0], k[1]), "runs": n, "firstCase": census_first[k]["case"], "firstSeed": census_first[k]["seed"], "cmd": census_first[k]["cmd"]}
                     for k, n in sorted(census_runs.items(), key=lambda kv: (-kv[1], kv[0]))]
summary["traps"] = [{"file": k[0], "line": k[1], "count": n, **trap_first[k]} for k, n in trap_count.most_common()]
bad = 0
for c, row in summary["cases"].items():
    bad += row["fail"] + row["trap"] + row["sanitizer"] + row["crash"]
bad += sum(len(v["different"]) for v in cmp.values())
summary["failed"] = bad
os.makedirs(os.path.dirname(outp), exist_ok=True)
json.dump(summary, open(outp, "w"), indent=2)
print(f"{'case':6} {'runs':>4} {'ok':>4} {'fail':>4} {'trap':>4} {'san':>4} {'crash':>5} {'unsup':>5} {'wins':>4} {'turnlim':>7}")
for c, r in summary["cases"].items():
    print(f"{c:6} {r['runs']:>4} {r['ok']:>4} {r['fail']:>4} {r['trap']:>4} {r['sanitizer']:>4} {r['crash']:>5} {r['unsupported']:>5} {r['winners']:>4} {r['stopTurns']:>7}")
for k, v in cmp.items(): print(f"hash {k}: compared {v['compared']}, different {v['different']}")
for t in summary["census"][:40]: print(f"census {t['file']}:{t['line']} {t['fn']} runs={t['runs']} first={t['firstCase']}/{t['firstSeed']}")
for t in summary["traps"][:15]: print(f"trap {t['file']}:{t['line']} x{t['count']} (first {t['case']} seed {t['seed']})")
for c, r in summary["cases"].items():
    for chk, f in r["firstFailure"].items(): print(f"fail {c} {chk} x{r['checks'][chk]}: {f['line']}")
    for chk, f in r["firstFailure"].items(): print(f"  cmd: {f['cmd']}")
    for f in r["failures"][:3]: print(f"crash {c} seed {f['seed']} rc {f['rc']}: {f['stderr'][-150:]!r}")
for s in summary["sanitizer"][:5]: print("sanitizer", s["case"], s["seed"], s["line"][-120:], "\n  cmd:", s["cmd"])
for t in summary["traps"][:5]: print(f"  trap cmd {t['file']}:{t['line']}: {t['cmd']}")
for k, v in summary["notes"].items(): print(f"note {k}: {v} runs (needs later core work)")
print("summary:", outp)
sys.exit(1 if bad else 0)
PY
