#!/usr/bin/env bash
set -u

failures=()
check() {
  local label=$1 result=0
  shift
  echo "::group::$label"
  "$@" || result=$?
  echo "::endgroup::"
  if (( result != 0 )); then
    failures+=("$label (exit $result)")
    echo "::error::$label failed (exit $result)"
  fi
}

# Turbo includes shared as a dependency of worker's build.
filter=@yugidraft/shared
if [[ $CHECK_WORKER == true ]]; then filter=@yugidraft/worker; fi
check "Build dependencies" npx --no-install turbo run build --cache-dir=.turbo/cache "--filter=$filter"

for workspace in bot ws worker; do
  flag="CHECK_${workspace^^}"
  if [[ ${!flag} == true ]]; then
    check "Typecheck $workspace" npm run typecheck "--workspace=packages/$workspace"
    files="${workspace^^}_TEST_FILES"
    check "Test $workspace" env "CI_TEST_FILES=${!files}" node scripts/ci/run-pr-tests.mjs "$workspace"
  fi
done
if [[ $CHECK_E2E == true ]]; then
  check "Typecheck E2E" timeout 10m npm run typecheck --workspace=packages/e2e
fi
if [[ $CHECK_VISION == true ]]; then
  check "Typecheck vision" npm run typecheck --workspace=packages/vision
  check "Test vision" env "CI_TEST_FILES=$VISION_TEST_FILES" node scripts/ci/run-pr-tests.mjs vision
fi
if [[ -n $CHECK_TYPES ]]; then
  types=$(node -e 'for (const name of JSON.parse(process.env.CHECK_TYPES)) console.log(name)') || exit 1
  while IFS= read -r workspace; do
    case "$workspace" in
      web)
        [[ $CHECK_WEB_BUILD == true ]] && continue
        check "Generate Next route types" npm exec --workspace=packages/web -- next typegen
        ;;
      shared) [[ $CHECK_SHARED == true ]] && continue ;;
      duel-server) [[ $CHECK_DUEL_UNIT == true ]] && continue ;;
      bot) [[ $CHECK_BOT == true ]] && continue ;;
      ws) [[ $CHECK_WS == true ]] && continue ;;
      worker) [[ $CHECK_WORKER == true ]] && continue ;;
      vision) [[ $CHECK_VISION == true ]] && continue ;;
      e2e) [[ $CHECK_E2E == true ]] && continue ;;
    esac
    check "Typecheck $workspace" npm run typecheck "--workspace=packages/$workspace"
  done <<< "$types"
fi
if [[ $CHECK_RULE_COVERAGE == true ]]; then
  check "Rule coverage (strict)" timeout 10m node --import tsx packages/duel-server/scripts/rule-coverage.ts --check --strict
fi

if (( ${#failures[@]} )); then
  {
    echo '### Small checks that failed'
    printf -- '- %s\n' "${failures[@]}"
  } | tee -a "$GITHUB_STEP_SUMMARY"
  exit 1
fi
