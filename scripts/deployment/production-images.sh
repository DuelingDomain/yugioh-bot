#!/bin/sh
# The workflow revision supplies this script, including when deploying older code.
# Pull every image before changing local tags. Keep container image IDs as :prev
# in the release backup step; promotion must not overwrite those rollback tags.
set -eu

operation=${1:-}
commit=${2:-}
registry=ghcr.io/duelingdomain/yugioh-bot
services='duel web worker ws'

case "$operation" in
  pull|promote)
    printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || {
      echo 'A full lowercase commit SHA is required.' >&2
      exit 1
    }
    ;;
  prune) ;;
  *) echo 'Usage: production-images.sh pull|promote <sha> | prune' >&2; exit 1 ;;
esac

verify_image() {
  actual=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$1")
  [ "$actual" = "linux/arm64 $commit" ] || {
    echo "Image platform or revision does not match the release: $1" >&2
    exit 1
  }
}

case "$operation" in
  pull)
    for service in $services; do
      image="$registry-$service:$commit"
      docker pull --platform=linux/arm64 "$image"
      verify_image "$image"
    done
    ;;
  promote)
    # A missing image must fail before any :latest tag changes.
    for service in $services; do verify_image "$registry-$service:$commit"; done
    for service in $services; do
      docker tag "$registry-$service:$commit" "yugioh-bot-$service:latest"
    done
    ;;
  prune)
    for service in $services; do
      for repository in "yugioh-bot-$service" "$registry-$service"; do
        for reference in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository"); do
          case "$reference" in
            "yugioh-bot-$service:latest"|"yugioh-bot-$service:prev"|*:'<none>') ;;
            "$repository":*)
              # No force: Docker must retain images still used by a container.
              docker image rm "$reference" || echo "Warning: could not remove $reference" >&2
              ;;
          esac
        done
      done
    done
    docker image prune -f
    ;;
esac
