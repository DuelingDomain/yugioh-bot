#!/bin/sh
# Run after stopping writers and installing the engine bundle, before starting containers.
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: prepare-runtime-data.sh <data-directory>" >&2
  exit 2
fi
data_dir=$1
while [ "$data_dir" != / ] && [ "${data_dir%/}" != "$data_dir" ]; do
  data_dir=${data_dir%/}
done

# Validate top-level entries before creating directories or changing ownership.
for path in "$data_dir" "$data_dir"/bot.sqlite* "$data_dir/card-images" "$data_dir/duel-engine" "$data_dir/duel-reports" "$data_dir/ops-reports"; do
  if [ -L "$path" ]; then
    echo "prepare-runtime-data: refusing symlink: $path" >&2
    exit 1
  fi
done

mkdir -p "$data_dir"
# SQLite sidecars and engine installation staging directories need a writable parent.
chown -h 1000:1000 "$data_dir"
mkdir -p "$data_dir/card-images" "$data_dir/duel-engine" "$data_dir/duel-reports"
mkdir -p -m 700 "$data_dir/ops-reports"
for path in "$data_dir"/bot.sqlite* "$data_dir/card-images" "$data_dir/duel-engine" "$data_dir/duel-reports" "$data_dir/ops-reports"; do
  [ -e "$path" ] || continue
  chown -h -R -P 1000:1000 "$path"
done
