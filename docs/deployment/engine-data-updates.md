# Weekly engine data updates

The **Engine data update** workflow runs Mondays at 06:00 UTC. It advances only Project Ignis CardScripts, BabelCDB and Distribution, with an exact pin-file allowlist of `packages/duel-server/scripts/prepare-data.ts`, `packages/duel-server/domain-core/pins.json` and `packages/duel-server/legacy-1v1/domain-core/pins.json`. If an old data SHA appears in another tracked file, the updater fails before writing anything. Both core-build `pins.json` files retain their `cardScripts` record and advance it together with the scripts pin in `prepare-data.ts`. Those records are part of `bundleVersion`: this tooling change leaves the current pins and all bundle inputs byte-identical to `origin/main`. A real CardScripts bump invalidates both core build caches; the resulting multicore rebuild during deployment is accepted. The updater never advances ygopro-core, ocgcore-wasm, Lua or Emscripten.

The `prepare` job has contents-read permission, checks out without persisted credentials, and installs without a token in its environment. Only its upstream API step receives the read-only `GITHUB_TOKEN`. It resolves candidate pins, prepares a temporary bundle, checks overlays, probes the installed production core, and uploads a pin-only patch, metadata and full report. The separate `publish` job installs no dependencies, checks out without persisted credentials, validates the artifact's exact paths and pin-only content, then uses its write token to commit, push and manage the PR. Automated bot commits have no Claude co-author or session trailers.

Before publishing, the job inspects `origin/<base>..origin/chore/engine-data-update`. While an open PR exists, any commit not authored by the exact GitHub Actions bot name and email causes a skip and a comment on that PR, preserving human overlay edits. Without an open PR, the stale branch is replaced from the current base, including after a squash merge or closure. Identical candidate pins on an open PR (or already on the base) cause no push or CI dispatch. Every skip emits a workflow warning. If the base advanced after preparation, publication waits for a fresh run. Updates use an explicit force-with-lease against the fetched tip, so a concurrent edit makes the push fail. There is no automatic merge.

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. No personal token is required. With `GITHUB_TOKEN`, publication explicitly dispatches `test.yml` with `nightly=false`, running normal CI without the four nightly fuzz legs; the native job still checks the committed golden rows. **CI on the bot PR fails at “nduel golden hashes (--check)” until a reviewer re-records and commits `golden.tsv` for the candidate inputs.** Manual test dispatch defaults `nightly` to true; scheduled nightly runs remain enabled. An optional `ENGINE_DATA_PR_TOKEN` personal/app token needs repository contents and pull-request writes; with it, normal pull-request CI runs and explicit dispatch is skipped. Write permissions exist only in `publish`.

The PR receives the `engine-data` label if it exists. Its body is capped at 60,000 UTF-8 bytes, retaining the first-line counts, deployment warning and golden-hash review instructions, with links to the run summary and artifact. The complete report is saved in the `engine-data-update-report` artifact for 14 days and included in the run summary when it fits. Summaries exceeding 1,000,000 bytes are truncated with an artifact link, below GitHub's 1 MiB limit.

## Run by hand

Use **Actions → Engine data update → Run workflow**, or:

```sh
gh workflow run engine-data-update.yml -f dry_run=true
```

Optional `scripts`, `database`, and `strings` inputs accept full 40-character commit SHAs. Omitted inputs use the latest upstream default-branch commit. A candidate must equal or descend from the current pin: behind or diverged SHAs are refused. A workflow dry run applies candidates only in the disposable preparation checkout, validates them, and uploads the report without publishing. The workflow must be on the default branch before scheduled/manual runs are available; the base falls back to `main` when event repository metadata is absent.

Locally, use Node 22 from the repo root:

```sh
npm ci
prlimit --core=1:1 -- node --import tsx packages/duel-server/scripts/update-engine-data.ts --dry-run
```

The default report is `.status/engine-data-update.md` (ignored by git); `--report <path>` changes it. Use `--scripts <sha> --database <sha> --strings <sha>` to reproduce a candidate, or omit `--dry-run` to apply pins. A local dry run probes the downloaded candidate database/scripts and checks overlays without modifying pins, then removes all downloaded temporary data. `GH_TOKEN` or `GITHUB_TOKEN` can raise the public API rate limit. API/download failures fail the command; compatibility findings remain advisory. `--defer-validation` is for the workflow's first stage; its mandatory validation stage runs the probe after `npm run duel:prepare` and verifies the prepared manifest matches the candidate pins.

## Review the report

The first line is `Needs review: N conflicts, M risks, K shared-script changes, probe errors P, overlay check exit X`. A successful overlay check does not clear stock-hash conflicts or other findings.

- **Commits and official scripts:** compare links show upstream changes; new/changed official `cNNN.lua` scripts include candidate database names. Database-only changes can add card data without a script diff.
- **Overlay conflicts:** every manifest stock hash is compared with its explicitly reviewed `stockPath`, or `official/cNNN.lua` by default. A nonofficial copy does not silently become the baseline: without a reviewed path, the report says `removed`. Reconcile affected overlays with upstream and review baseline hashes; do not replace hashes merely to silence a conflict.
- **Changed shared scripts:** every added, changed or removed `.lua` outside `official/cNNN.lua` is listed, including utility, constants, procedures, card-specific helpers and nonofficial scripts. Utility/procedure/constant changes flag `mp-utility.lua` for review. Check shared multiplayer assumptions even when no official card changed.
- **New multiplayer risks:** new/changed official scripts flagged F or ambiguous O and absent from both multiplayer lists need a rule, tested overlay or format-specific ban decision.
- **Changed listed cards:** changed scripts already in `MULTIPLAYER_CARD_RULES` or `MULTIPLAYER_FORBIDDEN` without an overlay need renewed review. This section also includes `formatGap` cards, including unchanged cards whose scan finds Tag coverage missing.
- **Core probe status:** uses the installed **npm `ocgcore-wasm@0.1.2`**, the oldest live/default Standard 1v1 core, without an optional build cache. It loads candidate `constant.lua`, `utility.lua` and every changed script, asserts availability of referenced `Duel.`, `Card.`, `Effect.`, `Group.` names and uppercase globals, and inserts each new/changed official card into a deck to exercise `initial_effect`. Findings come through the core error handler and host setup checks. A separate process limits hangs to 60 seconds. Errors and timeouts appear in the report without failing the job. The lexical scan is best effort; it does not prove dynamic symbol usage or play out effect callbacks. Investigate incompatibilities separately; the updater never changes core pins.
- **Golden hashes — required in the data-update PR:** after reconciling the candidate, run `run-nduel.sh --record` against its prepared bundle, review and commit the golden diff, then run `run-nduel.sh --check`. `golden.tsv` records a SHA-256 fingerprint of the three data pins (canonical compact JSON in scripts/database/strings order). It is historical metadata, never synchronized automatically. Changed or missing metadata makes `--check` fail before a build with `data pins changed: re-record with run-nduel.sh --record`. The header also records `multi-scripts-sha256` and `patches-sha256`: SHA-256 over bytewise-sorted `<relative path>\0<file SHA-256>\n` records for every regular overlay file, matching `multiScriptsFolderHash`, and only `*.patch` files in the patch folder, matching the core cache keys’ input selection (README edits do not invalidate golden). Changed or missing folder metadata fails before a build with `overlay/patches changed: re-record with run-nduel.sh --record`. The native CI job checks all committed golden rows only when core patches/pins, overlays, native tooling or data pins change, and on manual dispatch. It compiles the nduel driver against the ASan/UBSan library already built by `test:native`, then uses `NDUEL_SKIP_BUILD=1` to avoid a second core build. Both `--record` and `--check` require `NDUEL_PATCHES` and `NDUEL_PATCH_LIMIT` to be unset, since their headers describe the complete repository patch series. Disabling nightly for the automated dispatch does not waive this review step.
- **Validation:** bundle preparation must succeed. Review probe findings, resolve stock conflicts, rerun the overlay check, re-record golden hashes in the PR, and review CI before merging.

**Live-duel warning:** a merged data bump changes `bundleVersion`. Active duels with a different bundle version are interrupted on recovery. Drain active duels and **merge at a quiet time**; deploy preflight can refuse while duels remain active. **Replay-loss warning:** each bump also makes replays of all earlier duels with a different bundle version unavailable, because the host refuses replay on a `bundleVersion` mismatch. The owner must account for both effects when deciding cadence. Host behavior is unchanged; see the [VM runbook](vm-runbook.md).

## Merge order for PR #210

Merge the golden-metadata follow-up (`fix/engine-data-review-gaps`) first. After removing `2f1cccf0` and restoring main's overlay fingerprint, `git merge-tree --write-tree origin/chore/engine-data-update HEAD` reports exactly one content conflict: `packages/duel-server/scripts/native/golden.tsv`. `docs/deployment/engine-data-updates.md` and `packages/duel-server/tests/update-engine-data.test.ts` merge automatically; there is no manifest or manifest-test conflict. Re-run the preview if either branch advances.

Then, in PR #210's `chore/engine-data-update` checkout:

1. Fetch and merge the updated `origin/main` into the update branch. Resolve the `golden.tsv` conflict by retaining PR #210's entire file temporarily (`git checkout --ours packages/duel-server/scripts/native/golden.tsv` when merging from the update branch), then stage it and finish the merge. Do not copy main's historical fingerprints onto the candidate rows. The temporary resolution is expected to fail the golden metadata check until step 3 re-records it.
2. Finish reconciling the candidate scripts, overlay (including `MANIFEST.json`) and patch series. With Node 22, install dependencies and prepare a fresh bundle for that branch's pins:
   ```sh
   prlimit --core=1:1 -- npm ci
   DUEL_DATA_DIR="$PWD/data/duel-engine-next" prlimit --core=1:1 -- npm run prepare:data --workspace=packages/duel-server
   ```
3. Use a fresh native work directory so cached card dumps and binaries cannot come from the old pins. Re-record all four cases, then check the resulting file with the same build:
   ```sh
   unset NDUEL_PATCHES NDUEL_PATCH_LIMIT DUEL_MULTI_SCRIPTS_DIR
   export DUEL_DATA_DIR="$PWD/data/duel-engine-next"
   export NDUEL_DIR="$(mktemp -d)"
   NDUEL_CASES="n2 n3 n4 tag" NDUEL_SEEDS=20 NDUEL_TURNS=60 NDUEL_LP=3000 NDUEL_FUTURE=0 NDUEL_SKIP_BUILD=0 prlimit --core=1:1 -- bash packages/duel-server/scripts/run-nduel.sh --record
   NDUEL_SKIP_BUILD=1 NDUEL_FUTURE=0 prlimit --core=1:1 -- bash packages/duel-server/scripts/run-nduel.sh --check
   rm -rf "$NDUEL_DIR"
   unset NDUEL_DIR
   ```
4. Review the row changes and all three fingerprint headers, verify 80 rows were recorded/checked with no skips or mismatches, and commit `packages/duel-server/scripts/native/golden.tsv` in PR #210. Merge that PR only after its CI passes. Never refresh the headers alone to bypass a failed check.

The follow-up on main retains its existing 20 two-player rows. PR #210 must re-record after incorporating the follow-up, with its own final data pins and overlay; the manifest stock-path test can land independently in PR #210 before that merge. Its reviewed `stockPath` manifest entry and `ManifestCard` type remain in PR #210 only; this follow-up retains main’s overlay bytes. The required golden re-record must happen after incorporating the follow-up, not by synchronizing its headers in advance.
