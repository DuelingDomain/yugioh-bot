#!/usr/bin/env bash
# List every source line in ygopro-core that may assume two players.
#
#   bash packages/duel-server/scripts/list-two-player-sites.sh [core-dir]
#
# Default core-dir: the pinned upstream commit (efc21aa) extracted from the fetch-only git cache
# into a temporary directory. Pass a directory (for example a patched tree) to scan that instead.
# Output goes to stdout. The first line holds the count per pattern. Then one section per
# pattern with "file:line: text" rows. The patterns are regular expressions on lines, so they
# also match lines that do not involve a player value (for example "& 1" on bit flags). range-for-player-array is a loop over the whole player array. range-for-player-member is a loop over one player's card list.
# Read every hit before you change it. Fewer false hits are not a goal; a missed site is.
# Scans the *.cpp, *.h and *.hpp files in the core root and in RNG/. Not lua/, scripts/ or jni/.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/multi-core-common.sh"

GREP=/usr/bin/grep
EXTENDED=0
DIR=""
for arg in "$@"; do
  case "$arg" in
    --extended) EXTENDED=1 ;;
    *) DIR="$arg" ;;
  esac
done
if [[ -z "$DIR" ]]; then
  ensure_caches >/dev/null
  DIR="$(mktemp -d "${TMPDIR:-/tmp}/two-player-sites.XXXXXX")"
  trap 'rm -rf "$DIR"' EXIT
  archive_tree "$CACHE_YGO" "$CORE_COMMIT" "$DIR"
fi

NAMES=(
  "array-size-2"
  "one-minus"
  "less-than-2"
  "xor-1"
  "and-1"
  "player-none-all"
  "range-for-player-array"
  "range-for-player-member"
  "player-size-begin-for_each"
)
REGEX=(
  '\[2\]'
  '(^|[^0-9A-Za-z_.])1 ?- ?[A-Za-z_(]'
  '< ?2([^0-9A-Za-z_]|$)'
  '\^ ?=? ?1([^0-9A-Za-z_]|$)'
  '& ?=? ?1([^0-9A-Za-z_]|$)'
  'PLAYER_NONE|PLAYER_ALL'
  'for ?\([^;)]*: *([A-Za-z_>.-]*[>.])?player ?\)'
  'for ?\([^;)]*: *[^)]*\bplayer\b[^)]'
  '\bplayer\.(size|begin|end)\(|for_each[^;]*\bplayer\b'
)

# --extended adds looser patterns for sites the default patterns miss: side checks against 0 or 1,
# ternaries and "!p" on a player value, zone mask halves (<< 16, >> 16), "% 2", {0, 1} initialisers,
# compares with the number 2 or "> 1" / ">= 2" / "<= 1" on a player value, and a literal 0 or 1 index on a per-duelist array, and a literal 0 or 1 as the first argument of a function with player in its name. They are lines to read, not a verdict.
# The default output (no flag) does not change.
if [[ "$EXTENDED" == 1 ]]; then
  PL='(\w*player\w*|\w*controler\w*|\bwinp\b|\bpriority\b|\b(p|tp|pl|con|who|side|seat|owner|sp|ep|p[0-9]|pl[0-9]|[a-z]+_p)\b)'
  # A player word anywhere on the line together with the compare, in either order.
  EQ01='[!=]= ?[01]([^0-9A-Za-z_.]|$)'
  NAMES+=(
    "side-eq-01"
    "side-eq-01-rev"
    "ternary-on-player"
    "ternary-01"
    "not-player"
    "zone-shift-16"
    "mod-2"
    "init-01-pair"
    "eq-2"
    "gt-1-ge-2-le-1"
    "literal-player-index"
    "literal-player-arg"
  )
  REGEX+=(
    "$PL.*$EQ01|$EQ01.*$PL"
    "(^|[^0-9A-Za-z_.])[01] ?[!=]= ?\(?$PL"
    "$PL[^;]*\?[^;:]*:"
    "$EQ01 ?\?|\? ?[01] ?: ?[01]([^0-9A-Za-z_.]|\$)"
    "!\(?([A-Za-z_>.-]*[>.])?$PL"
    "<<=? ?16|>>=? ?16"
    "% ?2([^0-9A-Za-z_]|\$)"
    "\{ ?[01], ?[01] ?\}|\{ ?0, ?0 ?\}|\{ ?false, ?false ?\}"
    "[!=]= ?2([^0-9A-Za-z_.]|\$)|(^|[^0-9A-Za-z_.])2 ?[!=]= "
    "$PL ?(> ?1|>= ?2|<= ?1)([^0-9A-Za-z_]|\$)"
    "\\b(player|control_adjust_set|trap_monster_adjust_set|overdraw|priorities|spsummon_counter(_rst)?|turn_id_by_player|unique_cards|spsummon_once_map(_rst)?|battle_damage|summon_count|extra_summon|spe_effect|shuffle_[a-z]+_check|[a-z_]+_state_count(_rst|_tmp)?|attack_state_count|battle_phase_count|battled_count|check_decktop_visibility|player_amount|hint_timing|lpcost|cost)\\[[01]\\]"
    "\\b[a-z_]*(player|relay|duelist|con)[a-z_]*\\((0|1)[,)]"
  )
fi

cd "$DIR"
mapfile -t FILES < <(find . -maxdepth 2 -type f \( -name '*.cpp' -o -name '*.h' -o -name '*.hpp' \) -not -path './lua/*' -not -path './jni/*' -not -path './scripts/*' -not -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort)

declare -a COUNTS
declare -a BODY
for i in "${!NAMES[@]}"; do
  BODY[i]="$("$GREP" -nE "${REGEX[i]}" "${FILES[@]}" | sed -E 's/^([^:]+):([0-9]+):[[:space:]]*/\1:\2: /' | LC_ALL=C sort -t: -k1,1 -k2,2n || true)"
  if [[ -z "${BODY[i]}" ]]; then COUNTS[i]=0; else COUNTS[i]="$(printf '%s\n' "${BODY[i]}" | wc -l)"; fi
done

header="two-player sites in ygopro-core ${CORE_COMMIT:0:7} (${#FILES[@]} files), lines per pattern:"
for i in "${!NAMES[@]}"; do header+=" ${NAMES[i]}=${COUNTS[i]}"; done
echo "$header"
for i in "${!NAMES[@]}"; do
  echo
  echo "## ${NAMES[i]} (${COUNTS[i]}) regex: ${REGEX[i]}"
  [[ -n "${BODY[i]}" ]] && printf '%s\n' "${BODY[i]}"
done
exit 0
