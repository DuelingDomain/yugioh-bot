#!/usr/bin/env bash
# Local-only: takes real board and screen shots for the marketing site on an isolated e2e stack.
# It uses the existing test-auth mode (E2E_AUTH=1 plus a generated secret) and seeded test players,
# so it adds no sign-in path to production code. It never touches the :3000 services or their data.
# One command takes all 5 shots (4-player, Tag, Domain Format, draft, Genesys deck) and writes the
# 1920x1080 WebP files (250 KB or less each, plus a 960-wide copy) to site/public/assets. The boards come from the dev-only
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
export E2E_SCREENSHOT_DSF=2
# A fresh stack database has no Genesys points, and the worker refuses a points list it has not verified, so every
# search result shows "? pts". The checker below compares the live list with the official table and prints its revision;
# this local stack publishes that revision, so the shots show the real points. It never reaches a real database.
if [ -z "${GENESYS_LIST_REVISION:-}" ]; then
  GENESYS_LIST_REVISION="$(cd "$root" && node_modules/.bin/tsx packages/shared/src/maintenance/check-genesys-points.ts 2>/dev/null | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{console.log(JSON.parse(t).revision||"")}catch{console.log("")}})' || true)"
  export GENESYS_LIST_REVISION
  export GENESYS_LIST_EFFECTIVE_DATE="${GENESYS_LIST_EFFECTIVE_DATE:-$(date +%F)}"
fi
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

# Full run only: convert each PNG (captured at device scale factor 2) to a WebP at its CSS size, plus a half-size "-960" file for
# phones (the pages use srcset). Lower the quality until the file is at most 250 KB (full) or 100 KB (half size).
if [ "$#" -eq 0 ]; then
  command -v ffmpeg >/dev/null || { echo "ffmpeg not found; convert the PNG files by hand." >&2; exit 0; }
  encode() { # png out width height max_bytes
    local q
    for q in 90 86 82 78 74 70 64 58 50; do
      ffmpeg -v error -y -i "$1" -vf "scale=$3:$4:flags=lanczos" -c:v libwebp -quality "$q" -compression_level 6 "$2"
      [ "$(stat -c%s "$2")" -le "$5" ] && { echo "$(basename "$2") quality $q, $(stat -c%s "$2") bytes"; return; }
    done
    echo "$(basename "$2") is still over $5 bytes at quality 50" >&2
  }
  convert_shot() { # name asset_name width height
    local png="$SHOT_DIR/$1.png" out="$root/site/public/assets/$2"
    encode "$png" "$out.webp" "$3" "$4" 256000
    encode "$png" "$out-960.webp" 960 $(( $4 * 960 / $3 )) 102400
  }
  convert_shot ffa4 shot-4-player-table 1920 1080
  convert_shot tag shot-tag-table 1920 1080
  convert_shot draft shot-draft-pick 1920 1080
  convert_shot domain-board shot-domain-format 1920 1080
  convert_shot genesys-deck shot-genesys-deck 1120 900
  echo "Look at every WebP before you commit it. Then run site/src/build-pages.py if you changed an alt text."
fi
