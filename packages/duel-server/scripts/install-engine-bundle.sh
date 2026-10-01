#!/bin/sh
# Copy a prepared canonical duel-engine bundle into DUEL_DATA_DIR when the
# pinned bundleVersion changed or required files are missing. Never writes
# bot.sqlite or any path that already contains a database. Identical bundles
# are left untouched so container restarts do not regenerate resources.
# A different bundle is refused while duels.status = 'active' in the sibling
# SQLite file (read-only). Staging uses a unique sibling directory; cutover
# keeps the previous bundle until the new tree validates.
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

required() {
  root="$1"
  [ -f "$root/cards.cdb" ] \
    && [ -f "$root/strings.conf" ] \
    && [ -f "$root/ocgcore.domain.wasm" ] \
    && [ -f "$root/ocgcore.standard.wasm" ] \
    && [ -f "$root/manifest.json" ] \
    && [ -d "$root/card-scripts" ] \
    && [ -f "$root/card-scripts/domain.lua" ]
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

active_duel_count() {
  dbfile="$1"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to refuse bundle replace while games are active" >&2
    return 2
  fi
  python3 - "$dbfile" <<'PY'
from pathlib import Path
import sqlite3
import sys

path = Path(sys.argv[1]).resolve()
con = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
present = con.execute(
    "select 1 from sqlite_master where type = 'table' and name = 'duels'"
).fetchone()
if present is None:
    print(0)
else:
    n = con.execute("select count(*) from duels where status = 'active'").fetchone()[0]
    print(n)
PY
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
  echo "duel-engine bundle missing under $dst (need cards.cdb, strings.conf, card-scripts/domain.lua, ocgcore.domain.wasm, manifest.json)" >&2
  exit 1
fi

trap - EXIT INT TERM HUP
