#!/bin/sh
# Installs the duel-engine bundle into the staging data directory (<staging-data-dir>/duel-engine).
#
#   sh scripts/staging/install-staging-bundle.sh <bundle.tar.gz> <staging-data-dir>
#
# The bundle holds the standard and domain cores plus ocgcore.multi.wasm (the core for 3 and 4 seats) and
# its file ocgcore.multi.sha256. The script:
#   1. checks the sha256 of ocgcore.multi.wasm against ocgcore.multi.sha256
#   2. runs packages/duel-server/scripts/install-engine-bundle.sh for the standard and domain files.
#      That script refuses to replace a bundle while the sibling bot.sqlite has an active duel.
#   3. installs the multi core files on their own, one atomic rename each. Step 2 skips an identical
#      manifest.json, so a new multi core alone would otherwise never be installed.
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

multi_files="ocgcore.multi.wasm ocgcore.multi.sha256 ocgcore.multi.SOURCE ocgcore.multi-domain.wasm"
[ -f "$work/ocgcore.multi.wasm" ] || { echo "install-staging-bundle: ocgcore.multi.wasm is missing in the bundle" >&2; exit 1; }
[ -f "$work/ocgcore.multi.sha256" ] || { echo "install-staging-bundle: ocgcore.multi.sha256 is missing in the bundle" >&2; exit 1; }

want=$(awk '{ print $1; exit }' "$work/ocgcore.multi.sha256")
have=$(sha256sum "$work/ocgcore.multi.wasm" | awk '{ print $1 }')
if [ "$want" != "$have" ]; then
  echo "install-staging-bundle: sha256 of ocgcore.multi.wasm does not match ocgcore.multi.sha256" >&2
  exit 1
fi
echo "install-staging-bundle: ocgcore.multi.wasm sha256 $have"

# Step 2: the standard and domain files.
DUEL_BUNDLE_SRC="$work" DUEL_DATA_DIR="$dst" DATABASE_PATH="$data_abs/bot.sqlite" \
  sh "$root/packages/duel-server/scripts/install-engine-bundle.sh"

# Step 3: the multi core files.
for f in $multi_files; do
  [ -f "$work/$f" ] || continue
  if [ -f "$dst/$f" ] && cmp -s "$work/$f" "$dst/$f"; then
    echo "install-staging-bundle: $f is already current"
    continue
  fi
  cp "$work/$f" "$dst/.$f.new"
  chmod a+r "$dst/.$f.new"
  mv -f "$dst/.$f.new" "$dst/$f"
  echo "install-staging-bundle: installed $f"
done

installed=$(sha256sum "$dst/ocgcore.multi.wasm" | awk '{ print $1 }')
if [ "$installed" != "$want" ]; then
  echo "install-staging-bundle: installed ocgcore.multi.wasm does not match the expected sha256" >&2
  exit 1
fi
echo "install-staging-bundle: done. multi core sha256 $installed"
