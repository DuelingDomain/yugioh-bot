#!/bin/sh
# Builds staging env from community config plus a separate staging Clerk source.
# Never prints values. The source files are read-only; output is atomic and 0600.
#
# STAGING_CLERK_ENV=/secure/staging-clerk.env STAGING_HOST=staging.example.com \
#   sh scripts/staging/make-staging-env.sh [--force] <community-env> <staging-env>
# STAGING_DOMAIN overrides STAGING_HOST; STAGING_HTTP_PORT defaults to 8080.
# The Clerk source must belong to a separate staging instance (never dev keys).
set -eu

COPY_REQUIRED="DISCORD_GUILD_ID"
COPY_OPTIONAL="MARKETING_URL DISCORD_DEFAULT_CHANNEL_ID DISCORD_REMINDER_CHANNEL_ID"

force=0
if [ "${1:-}" = "--force" ]; then
  force=1
  shift
fi
if [ "$#" -ne 2 ]; then
  echo "usage: make-staging-env.sh [--force] <production-env> <staging-env>" >&2
  exit 2
fi
src=$1
out=$2

if [ ! -f "$src" ]; then
  echo "make-staging-env: $src not found" >&2
  exit 1
fi
if [ "$src" = "$out" ]; then
  echo "make-staging-env: the staging file must not be the production file" >&2
  exit 1
fi
case "$out" in
  /opt/yugioh-bot/*)
    echo "make-staging-env: refusing to write inside the production directory" >&2
    exit 1
    ;;
esac
if [ -e "$out" ] && [ "$force" -ne 1 ]; then
  echo "make-staging-env: $out already exists, kept as it is (use --force to rebuild it)"
  exit 0
fi

clerk_src=${STAGING_CLERK_ENV:-}
[ -n "$clerk_src" ] && [ -f "$clerk_src" ] || {
  echo "make-staging-env: STAGING_CLERK_ENV must name a separate staging Clerk env file" >&2
  exit 1
}
if [ "$clerk_src" -ef "$src" ] || { [ -e "$out" ] && [ "$clerk_src" -ef "$out" ]; }; then
  echo "make-staging-env: Clerk source must be separate from community/production and output env files" >&2
  exit 1
fi

domain=${STAGING_DOMAIN:-}
host=${STAGING_HOST:-}
http_port=${STAGING_HTTP_PORT:-8080}

valid_name() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
}
valid_port() {
  printf '%s' "$1" | grep -Eq '^[0-9]{1,5}$' && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}
valid_port "$http_port" || { echo "make-staging-env: STAGING_HTTP_PORT is not a port number" >&2; exit 1; }
if [ "$http_port" -lt 1024 ]; then
  echo "make-staging-env: STAGING_HTTP_PORT $http_port is below 1024. Ports 80 and 443 belong to the production Caddy. Use 8080 or similar." >&2
  exit 1
fi

if [ -n "$domain" ]; then
  valid_name "$domain" || { echo "make-staging-env: STAGING_DOMAIN is not a valid name" >&2; exit 1; }
  url="http://$domain:$http_port"
else
  [ -n "$host" ] || { echo "make-staging-env: set STAGING_HOST (or STAGING_DOMAIN)" >&2; exit 1; }
  valid_name "$host" || { echo "make-staging-env: STAGING_HOST is not a valid name or address" >&2; exit 1; }
  url="http://$host:$http_port"
fi

random_secret() {
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

umask 077
tmp="$out.tmp.$$"
trap 'rm -f "$tmp"' EXIT INT TERM HUP
: > "$tmp"

{
  echo "# Staging env file. Made by scripts/staging/make-staging-env.sh. Do not commit."
  echo "# Staging address and ports"
  echo "WEB_URL=$url"
  echo "NEXT_PUBLIC_WS_URL=$url"
  echo "STAGING_HTTP_PORT=$http_port"
  echo "# Internal addresses (compose sets the same values)"
  echo "WS_INTERNAL_URL=http://ws:4002"
  echo "DUEL_INTERNAL_URL=http://duel:4003"
  echo "DATABASE_PATH=/app/data/bot.sqlite"
  echo "DUEL_DATA_DIR=/app/data/duel-engine"
  echo "# No bot in staging: announcements stay off"
  echo "DISCORD_BOT_ENABLED=0"
  echo "CARD_IMAGE_CACHE_DIR=/app/data/card-images"
  echo "CARD_IMAGE_CACHE_MAX_BYTES=16106127360"
  echo "SETS_SYNC_CRON=0 6 * * *"
  echo "SETS_SYNC_TIMEZONE=UTC"
  echo "IMAGE_CLEANUP_CRON=0 4 * * *"
  echo "IMAGE_CLEANUP_TIMEZONE=UTC"
  echo "# Independent internal secrets."
  echo "WS_INTERNAL_SECRET=$(random_secret)"
  echo "DUEL_INTERNAL_SECRET=$(random_secret)"
  echo "# Community config and separate staging Clerk keys"
} >> "$tmp"

echo "make-staging-env: set WEB_URL NEXT_PUBLIC_WS_URL to the staging address"
echo "make-staging-env: set STAGING_HTTP_PORT"
echo "make-staging-env: generated WS_INTERNAL_SECRET DUEL_INTERNAL_SECRET (new random values)"

missing=""
for key in $COPY_REQUIRED $COPY_OPTIONAL CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY; do
  key_src=$src
  case "$key" in CLERK_SECRET_KEY|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) key_src=$clerk_src ;; esac
  # The last assignment wins, like in an env file. The line is copied as it is and never printed.
  line=$(grep -E "^${key}=" "$key_src" | tail -n 1 || true)
  if printf '%s' "$line" | grep -Eq "^${key}=[\"']?[^\"'[:space:]]"; then
    case "$key" in
      CLERK_SECRET_KEY|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
        prefix=sk_live_
        [ "$key" != NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ] || prefix=pk_live_
        printf '%s' "$line" | grep -Eq "^${key}=[\"']?${prefix}[A-Za-z0-9_-]+[\"']?$" || {
          echo "make-staging-env: $key must belong to a separate staging instance; dev keys are refused" >&2
          exit 1
        }
        ;;
    esac
    printf '%s\n' "$line" >> "$tmp"
    echo "make-staging-env: copied $key"
  else
    case " $COPY_REQUIRED CLERK_SECRET_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY " in
      *" $key "*) missing="$missing $key" ;;
      *) echo "make-staging-env: $key is empty or missing in its source file, skipped" ;;
    esac
  fi
done

if [ -n "$missing" ]; then
  echo "make-staging-env: these keys are empty or missing in its source file:$missing" >&2
  exit 1
fi

chmod 600 "$tmp"
mv -f "$tmp" "$out"
trap - EXIT INT TERM HUP
echo "make-staging-env: wrote $out (mode 600)"
