#!/bin/sh
# Waits until the staging stack answers, and fails with a clear message if it does not.
#
#   sh scripts/staging/health-check.sh [<seconds>]      (default 120)
#
# Checks: the ws, duel, web and worker containers run with no restarts; the web answers through the staging
# Caddy; Socket.IO answers through the staging Caddy. Reads STAGING_HTTP_PORT from .env.staging
# (a plain value, nothing secret).
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)
cd "$root"
limit=${1:-120}

env_value() {
  grep -E "^$1=" .env.staging | tail -n 1 | cut -d= -f2- || true
}
http_port=${STAGING_HTTP_PORT:-$(env_value STAGING_HTTP_PORT)}
http_port=${http_port:-8080}
base="http://127.0.0.1:$http_port"

compose="sh $script_dir/compose.sh"

container_ok() {
  id=$($compose ps -q "$1" 2>/dev/null || true)
  [ -n "$id" ] || return 1
  state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id" 2>/dev/null || true)
  [ "$state" = "running 0" ]
}

http_ok() {
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo 000)
  case "$code" in
    2??|3??) return 0 ;;
    *) return 1 ;;
  esac
}

start=$(date +%s)
last=""
while :; do
  last=""
  for svc in ws duel web worker caddy; do
    container_ok "$svc" || last="$last $svc-not-running"
  done
  worker_id=$($compose ps -q worker 2>/dev/null || true)
  worker_health=$(docker inspect -f '{{.State.Health.Status}}' "$worker_id" 2>/dev/null || true)
  [ "$worker_health" = healthy ] || last="$last worker-not-healthy"
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
