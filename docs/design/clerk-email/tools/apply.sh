#!/usr/bin/env bash
# Apply the built templates to one Clerk instance.  Usage: apply.sh dev|prod
# Run from a directory linked to the Clerk app (packages/web in a checkout). Prod only after the owner approves.
set -euo pipefail
INSTANCE="${1:?usage: apply.sh dev|prod}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
for s in $(python3 -c "import json,sys; print(' '.join(json.load(open('$SRC/subjects.json'))))"); do
  clerk api --instance "$INSTANCE" -X PUT "/templates/email/$s" --file "$SRC/requests/$s.put.json" --yes < /dev/null > /dev/null
  echo "applied $s to $INSTANCE"
done
