#!/bin/sh
# Waits until the staging stack answers, and fails with a clear message if it does not.
#
#   sh scripts/staging/health-check.sh [<seconds>]      (default 120)
#
# Checks: the ws, duel and web containers run with no restarts; the web answers through the staging
# Caddy; Socket.IO answers through the staging Caddy. Reads STAGING_SITE_ADDRESS, STAGING_HTTP_PORT and
# STAGING_HTTPS_PORT from .env.staging (names and plain values only, nothing is printed).
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)
cd "$root"
limit=${1:-120}

env_value() {
  grep -E "^$1=" .env.staging | tail -n 1 | cut -d= -f2- || true
}
site=$(env_value STAGING_SITE_ADDRESS)
http_port=$(env_value STAGING_HTTP_PORT)
https_port=$(env_value STAGING_HTTPS_PORT)
site=${site:-:80}
http_port=${http_port:-8080}
https_port=${https_port:-8443}

if [ "$site" = ":80" ]; then
  base="http://127.0.0.1:$http_port"
  curl_extra=""
else
  base="https://$site:$https_port"
  curl_extra="--resolve $site:$https_port:127.0.0.1"
fi

compose="sh $script_dir/compose.sh"

container_ok() {
  id=$($compose ps -q "$1" 2>/dev/null || true)
  [ -n "$id" ] || return 1
  state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id" 2>/dev/null || true)
  [ "$state" = "running 0" ]
}

http_ok() {
  # shellcheck disable=SC2086
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 $curl_extra "$1" 2>/dev/null || echo 000)
  case "$code" in
    2??|3??) return 0 ;;
    *) return 1 ;;
  esac
}

start=$(date +%s)
last=""
while :; do
  last=""
  for svc in ws duel web caddy; do
    container_ok "$svc" || last="$last $svc-not-running"
  done
  http_ok "$base/api/auth/providers" || last="$last web-not-answering"
  http_ok "$base/socket.io/?EIO=4&transport=polling" || last="$last socketio-not-answering"
  if [ -z "$last" ]; then
    echo "health-check: staging is up at $base"
    exit 0
  fi
  now=$(date +%s)
  if [ $((now - start)) -ge "$limit" ]; then
    echo "health-check: staging is not healthy after ${limit}s:$last" >&2
    $compose ps >&2 || true
    exit 1
  fi
  sleep 5
done
