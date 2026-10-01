#!/bin/sh
# Builds the staging env file from the production env file. It never prints a value, only key names.
#
#   STAGING_HOST=203.0.113.7 sh scripts/staging/make-staging-env.sh [--force] <production-env> <staging-env>
#
# Settings (environment):
#   STAGING_HOST         public address of the VM. Needed when STAGING_DOMAIN is empty.
#   STAGING_DOMAIN       a domain name for HTTPS mode. Empty (default) means plain HTTP on STAGING_HTTP_PORT.
#   STAGING_HTTP_PORT    host port of plain HTTP mode. Default 8080.
#   STAGING_HTTPS_PORT   host port of HTTPS mode. Default 443 with a domain, 8443 without.
#
# What the staging file gets:
#   - copied from production: only the keys the web needs to sign users in and to check the guild
#     (see COPY_REQUIRED and COPY_OPTIONAL below). Nothing else is copied. NEXTAUTH_SECRET is NOT copied.
#   - set to the staging address: NEXTAUTH_URL, AUTH_URL, WEB_URL, NEXT_PUBLIC_WS_URL.
#   - NEW random secrets: NEXTAUTH_SECRET, WS_INTERNAL_SECRET and DUEL_INTERNAL_SECRET. They differ from
#     production. A session made in staging is therefore not valid in production, and the other way round.
#   - empty on purpose: BOT_ANNOUNCE_URL and BOT_ANNOUNCE_SECRET (there is no bot in staging).
#
# The script reads the production file and never writes to it. An existing staging file is kept
# unless --force is given. The new file has mode 600.
set -eu

# DISCORD_TOKEN is copied because the web uses it as a REST credential to check guild membership
# (packages/web/src/lib/discord-guild-membership.ts). Staging runs no bot process, so it cannot answer commands.
COPY_REQUIRED="DISCORD_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_GUILD_ID"
COPY_OPTIONAL="DISCORD_DEFAULT_CHANNEL_ID DISCORD_REMINDER_CHANNEL_ID"

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

domain=${STAGING_DOMAIN:-}
host=${STAGING_HOST:-}
http_port=${STAGING_HTTP_PORT:-8080}
if [ -n "$domain" ]; then
  https_port=${STAGING_HTTPS_PORT:-443}
else
  https_port=${STAGING_HTTPS_PORT:-8443}
fi

valid_name() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'
}
valid_port() {
  printf '%s' "$1" | grep -Eq '^[0-9]{1,5}$' && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}
valid_port "$http_port" || { echo "make-staging-env: STAGING_HTTP_PORT is not a port number" >&2; exit 1; }
valid_port "$https_port" || { echo "make-staging-env: STAGING_HTTPS_PORT is not a port number" >&2; exit 1; }

if [ -n "$domain" ]; then
  valid_name "$domain" || { echo "make-staging-env: STAGING_DOMAIN is not a valid name" >&2; exit 1; }
  if [ "$https_port" -eq 443 ]; then url="https://$domain"; else url="https://$domain:$https_port"; fi
  site_address=$domain
else
  [ -n "$host" ] || { echo "make-staging-env: set STAGING_HOST (or STAGING_DOMAIN)" >&2; exit 1; }
  valid_name "$host" || { echo "make-staging-env: STAGING_HOST is not a valid name or address" >&2; exit 1; }
  if [ "$http_port" -eq 80 ]; then url="http://$host"; else url="http://$host:$http_port"; fi
  site_address=":80"
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
  echo "NEXTAUTH_URL=$url"
  echo "AUTH_URL=$url"
  echo "WEB_URL=$url"
  echo "NEXT_PUBLIC_WS_URL=$url"
  echo "STAGING_SITE_ADDRESS=$site_address"
  echo "STAGING_HTTP_PORT=$http_port"
  echo "STAGING_HTTPS_PORT=$https_port"
  echo "# Internal addresses (compose sets the same values)"
  echo "WS_INTERNAL_URL=http://ws:4002"
  echo "DUEL_INTERNAL_URL=http://duel:4003"
  echo "DATABASE_PATH=/app/data/bot.sqlite"
  echo "DUEL_DATA_DIR=/app/data/duel-engine"
  echo "# No bot in staging: announcements stay off"
  echo "BOT_ANNOUNCE_URL="
  echo "BOT_ANNOUNCE_SECRET="
  echo "# New secrets, not the production ones. Staging sessions must not be valid in production."
  echo "NEXTAUTH_SECRET=$(random_secret)"
  echo "WS_INTERNAL_SECRET=$(random_secret)"
  echo "DUEL_INTERNAL_SECRET=$(random_secret)"
  echo "# Copied from the production file"
} >> "$tmp"

echo "make-staging-env: set NEXTAUTH_URL AUTH_URL WEB_URL NEXT_PUBLIC_WS_URL to the staging address"
echo "make-staging-env: set STAGING_SITE_ADDRESS STAGING_HTTP_PORT STAGING_HTTPS_PORT"
echo "make-staging-env: generated NEXTAUTH_SECRET WS_INTERNAL_SECRET DUEL_INTERNAL_SECRET (new random values)"
echo "make-staging-env: left BOT_ANNOUNCE_URL and BOT_ANNOUNCE_SECRET empty"

missing=""
for key in $COPY_REQUIRED $COPY_OPTIONAL; do
  # The last assignment wins, like in an env file. The line is copied as it is and never printed.
  line=$(grep -E "^${key}=" "$src" | tail -n 1 || true)
  if printf '%s' "$line" | grep -Eq "^${key}=[\"']?[^\"'[:space:]]"; then
    printf '%s\n' "$line" >> "$tmp"
    echo "make-staging-env: copied $key"
  else
    case " $COPY_REQUIRED " in
      *" $key "*) missing="$missing $key" ;;
      *) echo "make-staging-env: $key is empty or missing in the production file, skipped" ;;
    esac
  fi
done

if [ -n "$missing" ]; then
  echo "make-staging-env: these keys are empty or missing in the production file:$missing" >&2
  exit 1
fi

chmod 600 "$tmp"
mv -f "$tmp" "$out"
trap - EXIT INT TERM HUP
echo "make-staging-env: wrote $out (mode 600)"
