#!/bin/sh
# Sets the duels with status "active" in the STAGING database to "interrupted".
#
#   sh scripts/staging/interrupt-active-duels.sh <staging-data-dir>
#
# Why: the engine bundle install (install-engine-bundle.sh) refuses to replace a changed bundle while a duel
# is "active". The staging stack is stopped during a redeploy, so no such duel can end, and every redeploy
# would fail. The copy of the production database already does the same change (sqlite-backup.py).
# Run it only while the staging stack is stopped. It refuses the production data directory.
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: interrupt-active-duels.sh <staging-data-dir>" >&2
  exit 2
fi
data_dir=$1
db="$data_dir/bot.sqlite"

if [ ! -f "$db" ]; then
  echo "interrupt-active-duels: no staging database yet, nothing to do"
  exit 0
fi
data_abs=$(CDPATH= cd -- "$data_dir" && pwd -P)
case "$data_abs" in
  /opt/yugioh-bot|/opt/yugioh-bot/*)
    echo "interrupt-active-duels: refusing to write inside the production directory" >&2
    exit 1
    ;;
esac
command -v python3 >/dev/null 2>&1 || { echo "interrupt-active-duels: python3 is required" >&2; exit 1; }

python3 - "$data_abs/bot.sqlite" <<'PY'
import sqlite3
import sys

con = sqlite3.connect(sys.argv[1], timeout=30)
try:
    has_duels = con.execute(
        "select 1 from sqlite_master where type = 'table' and name = 'duels'"
    ).fetchone()
    count = 0
    if has_duels:
        count = con.execute(
            "update duels set status = 'interrupted' where status = 'active'"
        ).rowcount
        con.commit()
    print("interrupt-active-duels: %d active duel(s) set to interrupted in the staging database" % count)
finally:
    con.close()
PY
