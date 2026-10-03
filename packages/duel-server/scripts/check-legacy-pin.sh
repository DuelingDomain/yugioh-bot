#!/bin/sh
# Fails when the legacy 1v1 Domain files of an engine bundle are not the files that production ran before the n-seat work.
# The expected sha256 values are in packages/duel-server/legacy-1v1/expected-sha256.txt: the wasm equals the one that main's own
# build script makes (emsdk 4.0.9), and the Lua equals main's domain.lua (see legacy-1v1/README.md).
# Usage: check-legacy-pin.sh <engine data dir> [expected-sha256 file]
# The build script of the legacy core, the deploy workflow and the test workflow call it. install-engine-bundle.sh only
# compares the files to the manifest that travels with them, so this check is what ties them to main.
set -eu

dir="${1:?usage: check-legacy-pin.sh <engine data dir> [expected-sha256 file]}"
here=$(cd "$(dirname "$0")" && pwd)
expected="${2:-$here/../legacy-1v1/expected-sha256.txt}"

[ -f "$expected" ] || { echo "legacy pin file missing: $expected" >&2; exit 1; }
status=0
while read -r want name; do
  [ -n "$want" ] || continue
  if [ ! -f "$dir/$name" ]; then
    echo "legacy pin: $dir/$name is missing" >&2
    status=1
    continue
  fi
  got=$(sha256sum "$dir/$name" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    echo "legacy pin: $name has sha256 $got, expected $want (main's build). The legacy engine must equal main's production files." >&2
    status=1
  fi
done < "$expected"
[ "$status" -eq 0 ] && echo "legacy pin ok: $dir"
exit "$status"
