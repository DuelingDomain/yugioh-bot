#!/bin/sh
# The only way to run docker compose for the staging stack. It always names the staging project,
# the staging compose file and the staging env file, so a typo cannot reach the production stack.
#
#   sh scripts/staging/compose.sh <docker compose arguments>
#   sh scripts/staging/compose.sh up -d
#   sh scripts/staging/compose.sh ps
#
# Settings (environment): STAGING_ENV_FILE (default .env.staging), STAGING_PROJECT (default
# yugidraft-staging), STAGING_DATA_DIR (default ./data-staging). The script refuses to run in the production
# directory, with a project name that is not a staging one, with a host port below 1024, and with a data
# directory inside /opt/yugioh-bot.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)
cd "$root"

if [ "$root" = "/opt/yugioh-bot" ]; then
  echo "compose.sh: this is the production directory. Run staging from /opt/yugioh-bot-staging." >&2
  exit 1
fi

project=${STAGING_PROJECT:-yugidraft-staging}
case "$project" in
  yugidraft-staging*) ;;
  *)
    echo "compose.sh: the project name must start with yugidraft-staging" >&2
    exit 1
    ;;
esac

env_file=${STAGING_ENV_FILE:-.env.staging}
if [ ! -f "$env_file" ]; then
  echo "compose.sh: $env_file not found. Run scripts/staging/make-staging-env.sh first." >&2
  exit 1
fi
# The web service reads this exact file name (env_file in docker-compose.staging.yml).
if [ "$env_file" != ".env.staging" ] && [ ! -f .env.staging ]; then
  echo "compose.sh: docker-compose.staging.yml needs the file .env.staging" >&2
  exit 1
fi

# The host port of staging must never be 80 or 443 (the production Caddy owns them), or any other
# port below 1024. The value is read from the shell first, then from the env file.
http_port=${STAGING_HTTP_PORT:-}
if [ -z "$http_port" ]; then
  http_port=$(grep -E '^STAGING_HTTP_PORT=' "$env_file" | tail -n 1 | cut -d= -f2- | tr -d "\"' " || true)
fi
http_port=${http_port:-8080}
case "$http_port" in
  ''|*[!0-9]*)
    echo "compose.sh: STAGING_HTTP_PORT is not a port number" >&2
    exit 1
    ;;
esac
if [ "$http_port" -lt 1024 ]; then
  echo "compose.sh: STAGING_HTTP_PORT $http_port is below 1024. Ports 80 and 443 belong to the production Caddy." >&2
  exit 1
fi

# The data directory must never be the production one. STAGING_DATA_DIR (shell first, then env file) is
# mounted into ws, duel and web, so a wrong value would give staging the production database.
data_dir=${STAGING_DATA_DIR:-}
if [ -z "$data_dir" ]; then
  data_dir=$(grep -E '^STAGING_DATA_DIR=' "$env_file" | tail -n 1 | cut -d= -f2- | tr -d "\"' " || true)
fi
data_dir=${data_dir:-./data-staging}
case "$data_dir" in
  /*) ;;
  *) data_dir="$root/$data_dir" ;;
esac
if [ -d "$data_dir" ]; then
  data_dir=$(CDPATH= cd -- "$data_dir" && pwd -P)
fi
case "$data_dir" in
  /opt/yugioh-bot|/opt/yugioh-bot/*)
    echo "compose.sh: STAGING_DATA_DIR points into the production directory (/opt/yugioh-bot). Refusing." >&2
    exit 1
    ;;
esac

# Containers write the staging data directory as the current user.
STAGING_UID=${STAGING_UID:-$(id -u)}
STAGING_GID=${STAGING_GID:-$(id -g)}
export STAGING_UID STAGING_GID

exec docker compose --env-file "$env_file" -p "$project" -f docker-compose.staging.yml "$@"
