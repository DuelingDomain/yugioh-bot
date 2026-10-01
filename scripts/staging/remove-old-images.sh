#!/bin/sh
# Removes staging images that a redeploy left behind. It removes ONLY the image IDs it is told about.
#
#   sh scripts/staging/remove-old-images.sh "<old image ids>" "<image ids now in use>"
#
# An id that is in both lists is kept. The command is `docker rmi <id>` without --force, so Docker refuses
# an image that a container still uses, and an image that has a second name (for example the same image
# tagged by the production project). It never runs `docker image prune` or `docker system prune`,
# because those would also remove things that belong to production.
set -eu

old=${1:-}
keep=${2:-}

removed=0
kept=0
for id in $old; do
  case " $keep " in
    *" $id "*) continue ;;
  esac
  if docker rmi "$id" >/dev/null 2>&1; then
    removed=$((removed + 1))
  else
    kept=$((kept + 1))
  fi
done
echo "remove-old-images: removed $removed old staging image(s), kept $kept that are still in use or shared"
