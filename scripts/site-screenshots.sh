#!/usr/bin/env bash
# Local-only: takes real board and screen shots for the marketing site on an isolated e2e stack.
# It uses the existing test-auth mode (E2E_AUTH=1 plus a generated secret) and seeded test players,
# so it adds no sign-in path to production code. It never touches the :3000 services or their data.
# Usage: E2E_DUEL_DATA_DIR=<prepared engine data> scripts/site-screenshots.sh [spec name]
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
