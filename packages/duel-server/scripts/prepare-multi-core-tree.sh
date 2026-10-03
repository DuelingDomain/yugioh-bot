#!/usr/bin/env bash
# Prepare the multi-duelist core source tree: pinned upstream ygopro-core plus the
# patch series in domain-core/patches/NNNN-*.patch, applied with `git am`.
#
#   bash packages/duel-server/scripts/prepare-multi-core-tree.sh
#
# Output: $MULTI_TREE (default domain-core/.build/multi-core-tree, gitignored).
# The tree is a git repo. Branch "upstream" is the pinned commit; HEAD has the series on top.
#
# Environment:
#   MULTI_TREE    where to put the tree. Use another path for a work tree (see patches/README.md).
#   PATCH_LIMIT   apply only the first N patches (1 = only the core fixes, 2 = plus the deterministic order).
#   EXTRA_PATCHES  space separated patch files to apply after the series (experiments).
#
# Idempotent: a tree whose stamp matches the pin and the patch files is kept.
# A tree that does not match is deleted and built again, but only when it has the
# marker file this script writes. The script fails loudly if a patch does not apply.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/multi-core-common.sh"

PATCH_LIMIT="${PATCH_LIMIT:-0}"
mapfile -t ALL_PATCHES < <(find "$PATCHES" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.patch' | LC_ALL=C sort)
if [[ ${#ALL_PATCHES[@]} -eq 0 ]]; then
  echo "no patches found in $PATCHES" >&2
  exit 1
fi
SELECTED=("${ALL_PATCHES[@]}")
if [[ "$PATCH_LIMIT" -gt 0 ]]; then SELECTED=("${ALL_PATCHES[@]:0:$PATCH_LIMIT}"); fi

# EXTRA_PATCHES: space separated patch files applied after the series (experiments, not committed).
if [[ -n "${EXTRA_PATCHES:-}" ]]; then
  read -r -a EXTRA <<< "$EXTRA_PATCHES"
  SELECTED+=("${EXTRA[@]}")
fi

STAMP="$(
  {
    echo "$CORE_COMMIT"
    for patch in "${SELECTED[@]}"; do sha256sum "$patch" | cut -d' ' -f1; basename "$patch"; done
  } | sha256sum | cut -d' ' -f1
)"

if [[ -f "$MULTI_TREE/$MULTI_MARKER" && "$(cat "$MULTI_TREE/$MULTI_MARKER")" == "$STAMP" ]] \
  && [[ -z "$(git -C "$MULTI_TREE" status --porcelain 2>/dev/null)" ]]; then
  echo "multi core tree already current: $MULTI_TREE (${#SELECTED[@]} patches)"
  exit 0
fi

if [[ -e "$MULTI_TREE" ]]; then
  if [[ ! -f "$MULTI_TREE/$MULTI_MARKER" ]]; then
    echo "refusing to delete $MULTI_TREE: it has no $MULTI_MARKER marker" >&2
    exit 1
  fi
  rm -rf "$MULTI_TREE"
fi

ensure_caches
mkdir -p "$MULTI_TREE"
archive_tree "$CACHE_YGO" "$CORE_COMMIT" "$MULTI_TREE"

# A fixed date makes the base commit, and so the tree, reproducible.
export GIT_AUTHOR_DATE="2000-01-01T00:00:00Z" GIT_COMMITTER_DATE="2000-01-01T00:00:00Z"
GIT_ID=(-c user.name=yugidraft -c user.email=yugidraft@localhost -c core.autocrlf=false -c core.hooksPath=/dev/null -c commit.gpgsign=false)
(
  cd "$MULTI_TREE"
  git init -q -b upstream .
  git "${GIT_ID[@]}" add -A
  git "${GIT_ID[@]}" commit -q -m "upstream ygopro-core $CORE_COMMIT"
  git checkout -q -b multi
  for patch in "${SELECTED[@]}"; do
    if ! git "${GIT_ID[@]}" am --quiet "$patch"; then
      echo "FAILED: patch does not apply: $patch" >&2
      git am --show-current-patch=diff >&2 || true
      git am --abort || true
      exit 1
    fi
    echo "applied $(basename "$patch")"
  done
)
echo "$STAMP" > "$MULTI_TREE/$MULTI_MARKER"
# The marker is not part of the source. Keep the tree clean for the idempotency check.
echo "$MULTI_MARKER" >> "$MULTI_TREE/.git/info/exclude"
echo "multi core tree ready: $MULTI_TREE (${#SELECTED[@]} patches on $CORE_COMMIT)"
