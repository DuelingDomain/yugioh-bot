#!/bin/sh
# Installs the duel-engine bundle into the staging data directory (<staging-data-dir>/duel-engine).
#
#   sh scripts/staging/install-staging-bundle.sh <bundle.tar.gz> <staging-data-dir>
#
# Requires both deploy multi cores and their checksum/provenance sidecars, then delegates validation,
# active-duel checks and installation to the shared installer. The shared installer updates multi
# cores independently of manifest.json, so cached base bundles cannot hide a new Domain build.
# Stop the staging stack before you run it. It never touches /opt/yugioh-bot.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)

if [ "$#" -ne 2 ]; then
  echo "usage: install-staging-bundle.sh <bundle.tar.gz> <staging-data-dir>" >&2
  exit 2
fi
tarball=$1
data_dir=$2

[ -f "$tarball" ] || { echo "install-staging-bundle: $tarball not found" >&2; exit 1; }
mkdir -p "$data_dir"
data_abs=$(CDPATH= cd -- "$data_dir" && pwd -P)
case "$data_abs" in
  /opt/yugioh-bot|/opt/yugioh-bot/*)
    echo "install-staging-bundle: refusing to write inside the production directory" >&2
    exit 1
    ;;
esac
dst="$data_abs/duel-engine"

work=$(mktemp -d "${TMPDIR:-/tmp}/staging-bundle.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM HUP
tar -C "$work" -xzf "$tarball"

for core in ocgcore.multi ocgcore.multi-domain; do
  for suffix in wasm sha256 SOURCE; do
    [ -s "$work/$core.$suffix" ] || {
      echo "install-staging-bundle: $core.$suffix is missing or empty in the bundle" >&2
      exit 1
    }
  done
done

DUEL_BUNDLE_SRC="$work" DUEL_DATA_DIR="$dst" DATABASE_PATH="$data_abs/bot.sqlite" \
  sh "$root/packages/duel-server/scripts/install-engine-bundle.sh"
echo "install-staging-bundle: installed both multi cores"
