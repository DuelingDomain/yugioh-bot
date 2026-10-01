#!/bin/sh
# Copy a prepared canonical duel-engine bundle into DUEL_DATA_DIR when the
# pinned bundleVersion changed or required files are missing. Never writes
# bot.sqlite or any path that already contains a database. Identical bundles
# are left untouched so container restarts do not regenerate resources.
# A different bundle is refused while duels.status = 'active' in the sibling
# SQLite file (read-only). Staging uses a unique sibling directory; cutover
# keeps the previous bundle until the new tree validates.
#
# The multi-duelist core (ocgcore.multi.wasm, for Tag and 3 and 4 player tables) is optional in the bundle and is not
# part of manifest.json. When the source holds it, it is checked against ocgcore.multi.sha256 and installed on its own
# with one atomic rename per file, because an identical manifest.json skips the bundle install. The standard and domain
# files, and so every 1v1 duel, are not touched by it. A changed multi core is refused while a Tag or free-for-all duel
# is active. Domain at 3 and 4 seats has its own core (ocgcore.multi-domain.wasm). This script never installs it.
set -eu

src="${DUEL_BUNDLE_SRC:-}"
dst="${DUEL_DATA_DIR:-}"
stage=
backup=

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
  [ -f "$root/multi-scripts/mp-utility.lua" ] || return 1
  [ -f "$root/multi-scripts/MANIFEST.json" ] || return 1
  expected=$(sed -n 's/.*"multiScripts": *"\([0-9a-f]*\)".*/\1/p' "$root/manifest.json" | head -n 1)
  [ -n "$expected" ] || return 1
  [ "$(multi_scripts_hash "$root/multi-scripts")" = "$expected" ]
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

# The multi core of a bundle directory is complete: the wasm and its ocgcore.multi.sha256 agree.
multi_core_ok() {
  root="$1"
  [ -s "$root/ocgcore.multi.wasm" ] || return 1
  [ -f "$root/ocgcore.multi.sha256" ] || return 1
  want=$(awk '{ print $1; exit }' "$root/ocgcore.multi.sha256")
  [ -n "$want" ] || return 1
  [ "$(sha256sum "$root/ocgcore.multi.wasm" | cut -d' ' -f1)" = "$want" ]
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
  if [ -e "$src/ocgcore.multi.wasm" ] && ! multi_core_ok "$src"; then
    echo "bundle source has a bad multi core: ocgcore.multi.wasm is empty, or ocgcore.multi.sha256 is missing or does not match: $src" >&2
    exit 1
  fi
  if required "$dst" && cmp -s "$dst/manifest.json" "$src/manifest.json"; then
    echo "duel-engine bundle already current under $dst"
  else
    dbfile="${DATABASE_PATH:-}"
    if [ -z "$dbfile" ]; then
      dbfile="$(dirname "$dst")/bot.sqlite"
    fi
    if [ -f "$dbfile" ]; then
      count=$(active_duel_count "$dbfile") || {
        echo "refusing to replace $dst: cannot read active duels from $dbfile" >&2
        exit 1
      }
      if [ "$count" -gt 0 ]; then
        echo "refusing to replace $dst: $count active duel(s) in $dbfile. Drain tables first; identical bundles still install." >&2
        exit 1
      fi
    fi
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
  echo "duel-engine bundle missing under $dst (need cards.cdb, strings.conf, card-scripts/domain.lua, ocgcore.domain.wasm, manifest.json, and multi-scripts with its integrity.multiScripts hash; run npm run duel:prepare)" >&2
  exit 1
fi

# The multi core, on its own. It runs also when the bundle above was current (same manifest.json).
if [ -n "$src" ] && [ -f "$src/ocgcore.multi.wasm" ]; then
  if [ -f "$dst/ocgcore.multi.wasm" ] && ! cmp -s "$src/ocgcore.multi.wasm" "$dst/ocgcore.multi.wasm"; then
    dbfile="${DATABASE_PATH:-}"
    if [ -z "$dbfile" ]; then
      dbfile="$(dirname "$dst")/bot.sqlite"
    fi
    if [ -f "$dbfile" ]; then
      count=$(active_duel_count "$dbfile" multi-seat) || {
        echo "refusing to replace the multi core in $dst: cannot read active duels from $dbfile" >&2
        exit 1
      }
      if [ "$count" -gt 0 ]; then
        echo "refusing to replace the multi core in $dst: $count active Tag or free-for-all duel(s) in $dbfile. Drain those tables first." >&2
        exit 1
      fi
    fi
  fi
  install_multi_file ocgcore.multi.wasm
  install_multi_file ocgcore.multi.sha256
  install_multi_file ocgcore.multi.SOURCE
  if ! multi_core_ok "$dst"; then
    echo "the installed multi core in $dst does not match ocgcore.multi.sha256" >&2
    exit 1
  fi
fi

trap - EXIT INT TERM HUP
