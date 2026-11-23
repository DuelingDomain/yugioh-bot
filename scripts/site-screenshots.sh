#!/usr/bin/env bash
# Local-only: takes real board and screen shots for the marketing site on an isolated e2e stack.
# It uses the existing test-auth mode (E2E_AUTH=1 plus a generated secret) and seeded test players,
# so it adds no sign-in path to production code. It never touches the :3000 services or their data.
# One command takes all 5 shots (4-player, Tag, Domain Format, draft, Genesys deck) and writes the
# 1600x900 WebP files (80 KB or less each) to site/public/assets. The boards come from the dev-only
# marketing-* scenario presets in packages/duel-server/src/presets/marketing-boards.ts (DUEL_SCENARIOS=1
# is set by the e2e stack), so every run gives the same mid-game boards.
# Usage: E2E_DUEL_DATA_DIR=<prepared engine data> scripts/site-screenshots.sh [spec name]
# With a spec name only that spec runs and no WebP files are written.
set -euo pipefail

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "Refusing to run with NODE_ENV=production. This script is for local use only." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
slot="${E2E_SLOT:-7}"
case "$slot" in [0-9]) ;; *) echo "E2E_SLOT must be one digit, 0 to 9." >&2; exit 1 ;; esac

if [ -z "${E2E_DUEL_DATA_DIR:-}" ] || [ ! -f "${E2E_DUEL_DATA_DIR}/cards.cdb" ]; then
  cat >&2 <<MSG
Set E2E_DUEL_DATA_DIR to a prepared engine data folder (it must hold cards.cdb and a manifest that
matches this checkout's ocgcore-wasm). Make one in a scratch folder, never in the live data folder:
  cp -r <some prepared data dir> /tmp/shot-engine && DUEL_DATA_DIR=/tmp/shot-engine npm run duel:prepare
MSG
  exit 1
fi

# Linux Node 22 is required (better-sqlite3). A Windows npm on PATH fails with a lockfile error.
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 22 ? 0 : 1)'; then
  echo "Use Node 22 (for example: export PATH=\$HOME/.nvm/versions/node/v22.*/bin:\$PATH)." >&2
  exit 1
fi

export E2E_SLOT="$slot"
# Real card art from images.ygoprodeck.com (the normal image route and its rate limits), cached in .stack-N/card-images.
export E2E_REAL_CARD_ART=1
export SHOT_DIR="${SHOT_DIR:-$root/packages/e2e/.stack-$slot/screenshots}"

cd "$root"
npm run build --workspace=packages/shared >/dev/null
for pkg in ws duel-server worker; do npm run build --workspace="packages/$pkg" >/dev/null; done
cd packages/e2e
npm run stack:build
# A fresh database keeps the shots repeatable.
rm -f ".stack-$slot"/e2e.sqlite*
npx playwright test -c playwright.screenshots.config.ts "$@"
echo "Screenshots are in $SHOT_DIR"

# Full run only: convert each PNG to a small WebP. Lower the quality until the file is 80 KB or less.
if [ "$#" -eq 0 ]; then
  command -v ffmpeg >/dev/null || { echo "ffmpeg not found; convert the PNG files by hand." >&2; exit 0; }
  convert_shot() {
    local png="$SHOT_DIR/$1.png" out="$root/site/public/assets/$2.webp" q
    for q in 80 72 65 58 50 42 35 28 22; do
      ffmpeg -v error -y -i "$png" -vf scale=1600:900:flags=lanczos -c:v libwebp -quality "$q" -compression_level 6 "$out"
      [ "$(stat -c%s "$out")" -le 81920 ] && { echo "$2.webp quality $q, $(stat -c%s "$out") bytes"; return; }
    done
    echo "$2.webp is still over 80 KB at quality 22" >&2
  }
  convert_shot ffa4 shot-4-player-table
  convert_shot tag shot-tag-table
  convert_shot draft shot-draft-pick
  convert_shot domain-board shot-domain-format
  convert_shot genesys-deck shot-genesys-deck
  echo "Look at every WebP before you commit it. Then run site/src/build-pages.py if you changed an alt text."
fi
