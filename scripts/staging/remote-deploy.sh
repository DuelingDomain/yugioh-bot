#!/bin/sh
# Runs ON THE VM. The workflow .github/workflows/deploy-staging.yml sends it over ssh:
#
#   ssh user@vm "env STAGING_REF='...' STAGING_ACTION='deploy' ... sh -s" < scripts/staging/remote-deploy.sh
#
# Input (environment):
#   STAGING_ACTION       deploy (default) or stop
#   STAGING_REF          the git branch to run (required for deploy)
#   STAGING_REFRESH_DB   "true" copies the production database again (default false)
#   STAGING_HOST         public address of the VM, used only when .env.staging does not exist yet
#   STAGING_DOMAIN       host name for the staging address, used only when .env.staging does not exist yet (optional)
#   STAGING_HTTP_PORT    host port of staging (optional, default 8080, never below 1024)
#   STAGING_BUNDLE       the engine bundle sent by the workflow (default /tmp/yugidraft-staging-bundle.tar.gz)
#
# It works in /opt/yugioh-bot-staging. It reads from /opt/yugioh-bot exactly three things: the file .env
# (through make-staging-env.sh, only when .env.staging is missing), data/bot.sqlite (read-only, through
# copy-staging-db.sh) and the git remote URL (only for the first clone). It never runs docker compose in
# /opt/yugioh-bot and never writes there.
set -eu

action=${STAGING_ACTION:-deploy}
refresh_db=${STAGING_REFRESH_DB:-false}
staging_dir=${STAGING_DIR:-/opt/yugioh-bot-staging}
prod_dir=/opt/yugioh-bot
bundle=${STAGING_BUNDLE:-/tmp/yugidraft-staging-bundle.tar.gz}

if [ "$staging_dir" = "$prod_dir" ]; then
  echo "remote-deploy: the staging directory is the production directory. Stopping." >&2
  exit 1
fi

# First run: the clone. The owner makes the folder once (docs/deployment/staging.md).
if [ ! -d "$staging_dir/.git" ]; then
  if [ "$action" = "stop" ]; then
    echo "remote-deploy: $staging_dir does not exist. Nothing to stop."
    exit 0
  fi
  if [ ! -d "$staging_dir" ]; then
    mkdir -p "$staging_dir" 2>/dev/null || {
      echo "remote-deploy: cannot create $staging_dir. Owner step: sudo mkdir $staging_dir && sudo chown $(id -un): $staging_dir" >&2
      exit 1
    }
  fi
  origin=$(git -C "$prod_dir" config --get remote.origin.url)
  [ -n "$origin" ] || { echo "remote-deploy: cannot read the git remote of $prod_dir" >&2; exit 1; }
  echo "remote-deploy: first run, cloning into $staging_dir"
  git clone "$origin" "$staging_dir"
fi

cd "$staging_dir"

if [ "$action" = "deploy" ]; then
  [ -n "${STAGING_REF:-}" ] || { echo "remote-deploy: STAGING_REF is required" >&2; exit 1; }
  git fetch --all --prune
  git reset --hard "origin/$STAGING_REF"
  echo "remote-deploy: staging code is now $(git rev-parse --short HEAD) from $STAGING_REF"
fi

compose="sh scripts/staging/compose.sh"

if [ "$action" = "stop" ]; then
  if [ -f .env.staging ]; then
    $compose down --remove-orphans
    echo "remote-deploy: staging is stopped. Its data stays in $staging_dir/data-staging."
  else
    echo "remote-deploy: no .env.staging, nothing to stop."
  fi
  free -m || true
  exit 0
fi

[ "$action" = "deploy" ] || { echo "remote-deploy: unknown action $action" >&2; exit 1; }
[ -f "$bundle" ] || { echo "remote-deploy: engine bundle $bundle not found" >&2; exit 1; }

# 1. The env file, only when it is missing. Secrets stay on the VM.
if [ ! -f .env.staging ]; then
  [ -f "$prod_dir/.env" ] || { echo "remote-deploy: $prod_dir/.env not found" >&2; exit 1; }
  STAGING_HOST=${STAGING_HOST:-} STAGING_DOMAIN=${STAGING_DOMAIN:-} STAGING_HTTP_PORT=${STAGING_HTTP_PORT:-8080} \
    sh scripts/staging/make-staging-env.sh "$prod_dir/.env" .env.staging
fi

# 2. Free the memory of the old staging stack, then check that a build is safe.
$compose stop || true
if pgrep -f 'turbo run build|next build' >/dev/null 2>&1; then
  echo "remote-deploy: another build is running on this VM (maybe the production deploy). Try again later." >&2
  exit 1
fi
sh scripts/staging/check-resources.sh "before build" "${STAGING_MIN_BUILD_MB:-1100}" 3000 /opt

# 3. Build the three images.
$compose build

# 4. The database: first run, or when asked.
mkdir -p data-staging
if [ ! -f data-staging/bot.sqlite ] || [ "$refresh_db" = "true" ]; then
  sh scripts/staging/copy-staging-db.sh "$prod_dir/data/bot.sqlite" "$staging_dir/data-staging"
else
  echo "remote-deploy: keeping the staging database (set refresh_db to copy production again)"
fi

# 5. The engine bundle, with the multi core.
sh scripts/staging/install-staging-bundle.sh "$bundle" "$staging_dir/data-staging"
cat data-staging/duel-engine/ocgcore.multi.SOURCE 2>/dev/null || true

# 6. Start, only when the VM has the memory for the limits of the stack.
sh scripts/staging/check-resources.sh "before start" "${STAGING_MIN_START_MB:-1700}"
$compose up -d
$compose ps

# 7. Health check, logs and memory use.
if ! sh scripts/staging/health-check.sh 180; then
  $compose logs --tail=60 || true
  free -m || true
  echo "remote-deploy: staging did not become healthy." >&2
  exit 1
fi
$compose logs --tail=20
ids=$($compose ps -q)
# shellcheck disable=SC2086
docker stats --no-stream $ids || true
free -m || true
rm -f "$bundle"
echo "remote-deploy: staging is running."
