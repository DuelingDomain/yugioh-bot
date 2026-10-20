#!/usr/bin/env bash
# Retry transient Google Fonts failures once; preserve ordinary build failures.
set -uo pipefail
build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT
npm run build --workspace=packages/web 2>&1 | tee "$build_log"
build_status=${PIPESTATUS[0]}
if [ "$build_status" -eq 0 ]; then exit 0; fi
if ! grep -Eiq '(Failed to (fetch|download).*(Google Fonts|fonts\.gstatic\.com|fonts\.googleapis\.com)|next/font:.*error)' "$build_log"; then
  exit "$build_status"
fi
echo 'Retrying the web build after a font download failure.' >&2
npm run build --workspace=packages/web
