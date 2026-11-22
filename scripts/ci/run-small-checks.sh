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
