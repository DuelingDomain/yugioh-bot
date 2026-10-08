#!/bin/sh
# Fixed read-only export from the deployed production duel image. No Compose/.env loading.
set -eu
containers=$(docker ps -q --filter status=running \
  --filter label=com.docker.compose.service=duel \
  --filter label=com.docker.compose.project.working_dir=/opt/yugioh-bot)
set -- $containers
[ "$#" -eq 1 ] || exit 1
exec docker exec "$1" node /app/packages/duel-server/dist/prod-script-errors.js
