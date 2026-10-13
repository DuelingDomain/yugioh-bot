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
  pull|promote|preserve)
    printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || {
      echo 'A full lowercase commit SHA is required.' >&2
      exit 1
    }
    ;;
  prune) ;;
  *) echo 'Usage: production-images.sh pull|promote <sha> <digest-file> | preserve <sha> <image> <prev-tag> | prune' >&2; exit 1 ;;
esac

image_reference() {
  digest=$(awk -v service="$1" '$1 == service { print $2 }' "$references")
  if [ "${#digest}" -ne 71 ] || ! printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
    echo "Missing or invalid release digest for $1." >&2
    exit 1
  fi
  printf '%s-%s@%s' "$registry" "$1" "$digest"
}

case "$operation" in
  pull|promote)
    references=${3:?Release digest file is required}
    # Validate all four legs before any Docker operation, including disk inspection.
    for service in $services; do image_reference "$service" >/dev/null; done
    ;;
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
    # Pulls share the disk with SQLite. Refuse before downloading any layers.
    docker_root=$(docker info --format '{{.DockerRootDir}}')
    [ -n "$docker_root" ] || { echo 'Cannot find the Docker disk.' >&2; exit 1; }
    free_kib=$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')
    case "$free_kib" in ''|*[!0-9]*) echo 'Cannot read free disk space.' >&2; exit 1 ;; esac
    [ "$free_kib" -ge 6291456 ] || {
      echo 'Deploy stopped before pull: at least 6 GiB of free Docker disk space is required.' >&2
      exit 1
    }
    for service in $services; do
      image=$(image_reference "$service")
      docker pull --platform=linux/arm64 "$image"
      verify_image "$image"
    done
    # Keep a SHA bookkeeping tag until this image leaves :latest and :prev.
    # Digest-only pulls have no tag, so scoped tag pruning could not find them later.
    for service in $services; do
      docker tag "$(image_reference "$service")" "$registry-$service:$commit"
    done
    ;;
  preserve)
    image=${3:?Image ID or local latest tag is required}
    previous=${4:?Previous image tag is required}
    revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
    image_id=$(docker image inspect --format '{{.Id}}' "$image")
    # A failed-health retry must not replace the good rollback image with itself.
    if [ "$revision" = "$commit" ]; then exit 0; fi
    # A different unconfirmed GHCR deploy must also retain the first-cutover image.
    if printf '%s' "$revision" | grep -Eq '^[0-9a-f]{40}$' &&
      [ "$image_id" != "${DEPLOY_CONFIRMED_IMAGE:-}" ] &&
      docker image inspect "$previous" >/dev/null 2>&1; then
      echo "Keeping $previous: the running GHCR release has not passed health checks."
      exit 0
    fi
    docker tag "$image" "$previous"
    ;;
  promote)
    # A missing image must fail before any :latest tag changes.
    for service in $services; do verify_image "$(image_reference "$service")"; done
    for service in $services; do
      docker tag "$(image_reference "$service")" "yugioh-bot-$service:latest"
    done
    ;;
  prune)
    for service in $services; do
      latest_id=$(docker image inspect --format '{{.Id}}' "yugioh-bot-$service:latest" 2>/dev/null || true)
      previous_id=$(docker image inspect --format '{{.Id}}' "yugioh-bot-$service:prev" 2>/dev/null || true)
      repository="$registry-$service"
      for reference in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$repository"); do
        case "$reference" in
          "$repository":*)
            tag=${reference##*:}
            if printf '%s' "$tag" | grep -Eq '^[0-9a-f]{40}$'; then
              image_id=$(docker image inspect --format '{{.Id}}' "$reference")
              if [ "$image_id" = "$latest_id" ] || [ "$image_id" = "$previous_id" ]; then continue; fi
              # No force. Local safety tags remain intact.
              docker image rm "$reference" || echo "Warning: could not remove $reference" >&2
            fi
            ;;
        esac
      done
    done
    # Only dangling images from this project. Every tagged image stays protected.
    docker image prune -f --filter 'label=org.opencontainers.image.source=https://github.com/DuelingDomain/yugioh-bot'
    ;;
esac
