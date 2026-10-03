#!/bin/sh
# Copies the production database to the staging data directory. Production is only READ.
#
#   sh scripts/staging/copy-staging-db.sh <production-bot.sqlite> <staging-data-dir>
#
# The copy uses the SQLite backup API, which gives a consistent file while the production bot is
# writing. The source is opened read-only. The result is <staging-data-dir>/bot.sqlite. In the copy,
# duels that were "active" become "interrupted".
#
# Stop the staging stack first (scripts/staging/compose.sh stop): its containers keep the file open.
# An existing staging database is moved aside to bot.sqlite.before-copy (one older copy is replaced).
#
# Methods, in this order:
#   1. python3 with the standard sqlite3 module (sqlite-backup.py)
#   2. node with better-sqlite3 inside the staging duel image (sqlite-backup.cjs).
#      Set STAGING_DB_IMAGE if the image has another name. The production folder is mounted read-only.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$#" -ne 2 ]; then
  echo "usage: copy-staging-db.sh <production-bot.sqlite> <staging-data-dir>" >&2
  exit 2
fi
src=$1
dst_dir=$2

[ -f "$src" ] || { echo "copy-staging-db: production database not found: $src" >&2; exit 1; }
created=0
if [ ! -d "$dst_dir" ]; then
  mkdir -p "$dst_dir"
  created=1
fi
src_abs=$(CDPATH= cd -- "$(dirname -- "$src")" && pwd)/$(basename -- "$src")
dst_abs=$(CDPATH= cd -- "$dst_dir" && pwd)

case "$dst_abs/" in
  "$(dirname -- "$src_abs")"/*)
    echo "copy-staging-db: the staging data directory must not be inside the production data directory" >&2
    [ "$created" -eq 1 ] && rmdir "$dst_dir" 2>/dev/null
    exit 1
    ;;
esac
if [ "$dst_abs" = "$(dirname -- "$src_abs")" ]; then
  echo "copy-staging-db: the staging data directory is the production data directory" >&2
  exit 1
fi

dst="$dst_abs/bot.sqlite"
if [ -e "$dst" ]; then
  for suffix in "" -wal -shm; do
    rm -f "$dst.before-copy$suffix"
    [ -e "$dst$suffix" ] && mv "$dst$suffix" "$dst.before-copy$suffix"
  done
  echo "copy-staging-db: the old staging database is now $dst.before-copy"
fi

if command -v python3 >/dev/null 2>&1; then
  echo "copy-staging-db: method python3"
  python3 "$script_dir/sqlite-backup.py" "$src_abs" "$dst"
elif command -v docker >/dev/null 2>&1; then
  image=${STAGING_DB_IMAGE:-yugidraft-staging-duel}
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "copy-staging-db: no python3, and the image $image does not exist yet (build the stack first)" >&2
    exit 1
  fi
  echo "copy-staging-db: method node in image $image"
  docker run --rm --pull=never --network none \
    --user "$(id -u):$(id -g)" \
    -e NODE_PATH=/app/node_modules \
    -v "$(dirname -- "$src_abs"):/prod:ro" \
    -v "$dst_abs:/staging" \
    -v "$script_dir:/scripts:ro" \
    --entrypoint node "$image" \
    /scripts/sqlite-backup.cjs "/prod/$(basename -- "$src_abs")" /staging/bot.sqlite
else
  echo "copy-staging-db: need python3 or docker to make the copy" >&2
  exit 1
fi

chmod 664 "$dst" 2>/dev/null || true
echo "copy-staging-db: done"
