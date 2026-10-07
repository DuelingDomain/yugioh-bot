#!/bin/sh
# Copy a prepared canonical duel-engine bundle into DUEL_DATA_DIR when the
# pinned bundleVersion changed or required files are missing. Never writes
# bot.sqlite or any path that already contains a database. Identical bundles
# are left untouched so container restarts do not regenerate resources.
# A different bundle is refused while duels.status = 'active' in the sibling
# SQLite file (read-only). Staging uses a unique sibling directory; cutover
# keeps the previous bundle until the new tree validates.
#
# The Standard and Domain multi cores (ocgcore.multi.wasm and ocgcore.multi-domain.wasm, for Tag and
# 3/4-seat tables) are optional in the bundle and independent of manifest.json. Each is checked against
# its .sha256 sidecar and installed with atomic renames even when manifest.json is identical. A changed
# multi core is refused while a Tag or free-for-all duel is active. All checks precede any writes.
#
# DUEL_PREFLIGHT=1 runs only the checks (bundle complete, multi core sidecar, active duels) and installs nothing.
# The production deploy runs it before it resets the checkout and builds images, so a refusal changes nothing.
set -eu

src="${DUEL_BUNDLE_SRC:-}"
dst="${DUEL_DATA_DIR:-}"
stage=
backup=
multi_cores="ocgcore.multi ocgcore.multi-domain"

if [ -z "$dst" ]; then
  echo "DUEL_DATA_DIR is required" >&2
  exit 1
fi

if [ -e "$dst" ] && [ ! -d "$dst" ]; then
  echo "refusing to install engine bundle at $dst because it is not a directory" >&2
  exit 1
fi

contains_database() {
  root="$1"
  [ -e "$root/bot.sqlite" ] && return 0
  for f in "$root"/*.sqlite "$root"/*.sqlite-wal "$root"/*.sqlite-shm; do
    if [ -e "$f" ]; then
      return 0
    fi
  done
  return 1
}

if contains_database "$dst"; then
  echo "refusing to install engine bundle into $dst because it contains a database" >&2
  exit 1
fi

# sha256 of the multi-scripts folder: the lines "<relative path>\0<sha256 of the file>\n", sorted bytewise by path.
# Same value as multiScriptsFolderHash in src/multi-scripts.ts and integrity.multiScripts in manifest.json.
multi_scripts_hash() {
  (
    cd "$1" || exit 1
    find . -type f | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s\0%s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"
    done
  ) | sha256sum | cut -d' ' -f1
}

# The Lua overlay of duels with more than two seats ships as <bundle>/multi-scripts. Its hash must match the manifest.
multi_scripts_ok() {
  root="$1"
  if [ ! -f "$root/multi-scripts/mp-utility.lua" ] || [ ! -f "$root/multi-scripts/MANIFEST.json" ]; then
    echo "multi-scripts folder is missing or incomplete: $root/multi-scripts" >&2
    return 1
  fi
  expected=$(sed -n 's/.*"multiScripts": *"\([0-9a-f]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  if [ -z "$expected" ] || [ "$(multi_scripts_hash "$root/multi-scripts")" != "$expected" ]; then
    echo "multi-scripts hash does not match manifest integrity.multiScripts: $root/multi-scripts" >&2
    return 1
  fi
}

# The files of the legacy 1v1 engine (the Domain wasm and Domain Lua that production ran before the n-seat work) are part of the
# bundle and of manifest.json: the sha256 of each must match integrity.domainLegacyWasm and integrity.domainLegacyLua. The Standard
# core of that engine is the npm package file, so it has no entry here.
legacy_files_ok() {
  root="$1"
  [ -f "$root/ocgcore.domain.legacy.wasm" ] || return 1
  [ -f "$root/card-scripts/domain.legacy.lua" ] || return 1
  want_wasm=$(sed -n 's/.*"domainLegacyWasm": *"\([0-9a-f]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  want_lua=$(sed -n 's/.*"domainLegacyLua": *"\([0-9a-f]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  [ -n "$want_wasm" ] && [ -n "$want_lua" ] || return 1
  [ "$(sha256sum "$root/ocgcore.domain.legacy.wasm" | cut -d' ' -f1)" = "$want_wasm" ] || return 1
  [ "$(sha256sum "$root/card-scripts/domain.legacy.lua" | cut -d' ' -f1)" = "$want_lua" ]
}

# Remaps are data inputs and must survive fresh bundle installation intact.
remap_file_ok() {
  root="$1"
  format=$(sed -n 's/.*"databaseFormat": *"\([^"]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  expected=$(sed -n 's/.*"cardRemaps": *"\([0-9a-f]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  case "$format" in
    official-releases-prerelease-v*) ;;
    *) if [ -z "$expected" ]; then return 0; fi ;;
  esac
  [ -n "$expected" ] && [ -f "$root/card-remaps.json" ] || return 1
  [ "$(sha256sum "$root/card-remaps.json" | cut -d' ' -f1)" = "$expected" ]
}

required() {
  root="$1"
  [ -f "$root/cards.cdb" ] \
    && [ -f "$root/strings.conf" ] \
    && [ -f "$root/ocgcore.domain.wasm" ] \
    && [ -f "$root/ocgcore.standard.wasm" ] \
    && [ -f "$root/manifest.json" ] \
    && [ -d "$root/card-scripts" ] \
    && [ -f "$root/card-scripts/domain.lua" ] \
    && remap_file_ok "$root" \
    && legacy_files_ok "$root" \
    && multi_scripts_ok "$root"
}

cleanup() {
  if [ -n "${stage:-}" ] && [ -d "$stage" ]; then
    rm -rf "$stage"
  fi
  if [ -n "${backup:-}" ] && [ -d "$backup" ] && [ ! -e "$dst" ]; then
    mv "$backup" "$dst"
  fi
}

trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# Prints the number of active duels. With a second argument "multi-seat" it counts only the duels that are not 1v1
# (a database from before the format column has none).
active_duel_count() {
  dbfile="$1"
  scope="${2:-all}"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to refuse bundle replace while games are active" >&2
    return 2
  fi
  python3 - "$dbfile" "$scope" <<'PY'
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1]).resolve()
multi_seat_only = sys.argv[2] == "multi-seat"
con = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
present = con.execute(
    "select 1 from sqlite_master where type = 'table' and name = 'duels'"
).fetchone()
if present is None:
    print(0)
elif multi_seat_only:
    columns = [row[1] for row in con.execute("pragma table_info(duels)")]
    if "format" not in columns:
        print(0)
    else:
        n = con.execute("select count(*) from duels where status = 'active' and format != '1v1'").fetchone()[0]
        print(n)
else:
    n = con.execute("select count(*) from duels where status = 'active'").fetchone()[0]
    print(n)
PY
}

# A multi core is complete: its wasm and checksum sidecar agree.
multi_core_ok() {
  root="$1"
  core="$2"
  [ -s "$root/$core.wasm" ] || return 1
  [ -f "$root/$core.sha256" ] || return 1
  want=$(awk '{ print $1; exit }' "$root/$core.sha256")
  [ -n "$want" ] || return 1
  [ "$(sha256sum "$root/$core.wasm" | cut -d' ' -f1)" = "$want" ]
}

# Installs one file of the multi core with an atomic rename. Does nothing when the file is already identical.
install_multi_file() {
  f="$1"
  [ -f "$src/$f" ] || return 0
  if [ -f "$dst/$f" ] && cmp -s "$src/$f" "$dst/$f"; then
    return 0
  fi
  cp "$src/$f" "$dst/.$f.new"
  chmod a+r "$dst/.$f.new"
  mv -f "$dst/.$f.new" "$dst/$f"
  echo "installed $f into $dst"
}

# The SQLite file that sits next to the engine data directory (or DATABASE_PATH).
duel_database_file() {
  dbfile="${DATABASE_PATH:-}"
  if [ -z "$dbfile" ]; then
    dbfile="$(dirname "$dst")/bot.sqlite"
  fi
  printf '%s\n' "$dbfile"
}

# Exits 1 when active duels of the given scope forbid the replace. Does nothing without a database file.
# $1 scope (all or multi-seat), $2 what is replaced, $3 how the duels are named in the message, $4 the advice.
refuse_when_active() {
  dbfile=$(duel_database_file)
  [ -f "$dbfile" ] || return 0
  count=$(active_duel_count "$dbfile" "$1") || {
    echo "refusing to replace $2: cannot read active duels from $dbfile" >&2
    exit 1
  }
  if [ "$count" -gt 0 ]; then
    echo "refusing to replace $2: $count active $3 in $dbfile. $4" >&2
    exit 1
  fi
}

# True when the multi core of the source differs from the installed one (and one is installed).
multi_core_differs() {
  for core in $multi_cores; do
    if [ -n "$src" ] && [ -f "$src/$core.wasm" ] && [ -f "$dst/$core.wasm" ] \
      && ! cmp -s "$src/$core.wasm" "$dst/$core.wasm"; then
      return 0
    fi
  done
  return 1
}

if [ -n "$src" ]; then
  if contains_database "$src"; then
    echo "refusing to use bundle source $src because it contains a database" >&2
    exit 1
  fi
  if ! required "$src"; then
    echo "bundle source is incomplete: $src" >&2
    exit 1
  fi
  # Checked before anything is installed: a damaged multi core must not leave a half-installed deploy.
  for core in $multi_cores; do
    if [ -e "$src/$core.wasm" ] && ! multi_core_ok "$src" "$core"; then
      echo "bundle source has a bad multi core: $core.wasm is empty, or $core.sha256 is missing or does not match: $src" >&2
      exit 1
    fi
  done
  if multi_core_differs; then
    refuse_when_active multi-seat "the multi cores in $dst" "Tag or free-for-all duel(s)" "Drain those tables first."
  fi
  # DUEL_PREFLIGHT=1: only the checks. The deploy runs this before it changes anything on the VM, so a refusal leaves
  # the old containers, the old checkout and the old images as they were.
  if [ -n "${DUEL_PREFLIGHT:-}" ]; then
    if ! required "$dst" || ! cmp -s "$dst/manifest.json" "$src/manifest.json"; then
      refuse_when_active all "$dst" "duel(s)" "Drain tables first; identical bundles still install."
    fi
    if multi_core_differs; then
      refuse_when_active multi-seat "the multi core in $dst" "Tag or free-for-all duel(s)" "Drain those tables first."
    fi
    echo "preflight ok: the bundle in $src can be installed into $dst"
    trap - EXIT INT TERM HUP
    exit 0
  fi
  if required "$dst" && cmp -s "$dst/manifest.json" "$src/manifest.json"; then
    echo "duel-engine bundle already current under $dst"
  else
    refuse_when_active all "$dst" "duel(s)" "Drain tables first; identical bundles still install."
    parent=$(dirname "$dst")
    mkdir -p "$parent"
    stage=$(mktemp -d "$parent/.duel-engine.installing.XXXXXX")
    # Copy contents into the empty unique dir (cp -a src dest nests when dest exists).
    cp -a "$src"/. "$stage"/
    if contains_database "$stage" || ! required "$stage"; then
      echo "staged bundle is incomplete or contains a database: $stage" >&2
      exit 1
    fi
    if [ -d "$dst" ]; then
      backup=$(mktemp -d "$parent/.duel-engine.backup.XXXXXX")
      rmdir "$backup"
      mv "$dst" "$backup"
    fi
    mv "$stage" "$dst"
    stage=
    if ! required "$dst"; then
      echo "cutover produced an incomplete bundle at $dst" >&2
      rm -rf "$dst"
      exit 1
    fi
    if [ -n "$backup" ]; then
      rm -rf "$backup"
      backup=
    fi
    chmod -R a+rX "$dst"
    echo "installed duel-engine bundle to $dst"
  fi
fi

if ! required "$dst"; then
  echo "duel-engine bundle missing under $dst (need cards.cdb, strings.conf, card-scripts/domain.lua, ocgcore.domain.wasm, ocgcore.domain.legacy.wasm and card-scripts/domain.legacy.lua with their integrity.domainLegacy* hashes, manifest.json, and multi-scripts with its integrity.multiScripts hash; run npm run duel:prepare, then build-domain-core.ts legacy-domain)" >&2
  exit 1
fi

# Both multi cores, independently of the base bundle manifest.
for core in $multi_cores; do
  if [ -n "$src" ] && [ -f "$src/$core.wasm" ]; then
    install_multi_file "$core.wasm"
    install_multi_file "$core.sha256"
    install_multi_file "$core.SOURCE"
    if ! multi_core_ok "$dst" "$core"; then
      echo "the installed multi core $core in $dst does not match its checksum" >&2
      exit 1
    fi
  fi
done

trap - EXIT INT TERM HUP
