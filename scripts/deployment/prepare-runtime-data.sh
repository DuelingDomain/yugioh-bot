#!/bin/sh
# Run after stopping writers and installing the engine bundle, before starting containers.
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: prepare-runtime-data.sh <data-directory>" >&2
  exit 2
fi
data_dir=$1

mkdir -p "$data_dir"
# SQLite sidecars and engine installation staging directories need a writable parent.
chown 1000:1000 "$data_dir"
mkdir -p "$data_dir/card-images" "$data_dir/duel-engine" "$data_dir/duel-reports"
mkdir -p -m 700 "$data_dir/ops-reports"
for path in "$data_dir"/bot.sqlite* "$data_dir/card-images" "$data_dir/duel-engine" "$data_dir/duel-reports" "$data_dir/ops-reports"; do
  [ -e "$path" ] || continue
  chown -R 1000:1000 "$path"
done
