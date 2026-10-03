#!/usr/bin/env bash
# Usage: scripts/smoke-test-site.sh <site-domain> [legacy-http-host]
# Requires: curl and jq.
set -uo pipefail
domain=${1:?Usage: $0 <site-domain> [legacy-http-host]}
legacy=${2:-}
base="https://$domain"
probe="/smoke?x=1"   # any path+query; redirects must preserve it
failed=0

get() { curl -sS --connect-timeout 5 --max-time 20 "$@"; }
redirect() { get -o /dev/null -w '%{http_code} %{redirect_url}' "$1$probe"; }
check() {
  local label=$1; shift
  if "$@" >/dev/null; then echo "PASS $label"; else echo "FAIL $label"; failed=1; fi
}

check 'HTTPS root (valid cert, 2xx/3xx)' get -f -o /dev/null "$base/"
check 'HTTP redirect'                    test "$(redirect "http://$domain")"      = "308 $base$probe"
check 'www redirect'                     test "$(redirect "https://www.$domain")" = "308 $base$probe"
[[ -n $legacy ]] && check 'Legacy IP redirect' test "$(redirect "http://$legacy")"      = "308 $base$probe"
check 'Socket.IO open packet'            test "$(get -f "$base/socket.io/?EIO=4&transport=polling" | head -c2)" = '0{'
check 'Discord callback URL'             test "$(get -f "$base/api/auth/providers" | jq -r .discord.callbackUrl)" = "$base/api/auth/callback/discord"
exit "$failed"
