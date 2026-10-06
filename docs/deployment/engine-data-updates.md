# Weekly engine data updates

The **Engine data update** workflow runs Mondays at 06:00 UTC. It moves only the Project Ignis CardScripts, BabelCDB and Distribution pins. It synchronizes every tracked copy of those commits, including the main and legacy `cardScripts.commit` pins. It never advances ygopro-core, ocgcore-wasm, Lua or Emscripten.

After downloading a candidate bundle and checking the multiplayer overlay, it force-pushes `chore/engine-data-update` and opens or updates one PR. The PR gets the `engine-data` label if that label exists. No changes means no PR. The report is also in the Actions run summary and its `engine-data-update-report` artifact.

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. No personal token is required: with `GITHUB_TOKEN`, the job explicitly dispatches `test.yml` on the update branch so CI runs. An optional `ENGINE_DATA_PR_TOKEN` personal/app token must allow repository contents and pull-request writes (including workflow-file writes if a future synchronized pin lives in a workflow); with that token, normal pull-request CI runs and the explicit dispatch is skipped. The workflow itself needs contents, pull-requests and actions write permissions.

## Run by hand

Use **Actions → Engine data update → Run workflow**, or:

```sh
gh workflow run engine-data-update.yml -f dry_run=true
```

The optional `scripts`, `database`, and `strings` inputs take full 40-character commit SHAs. Omitted inputs use the latest commit on each upstream default branch. A workflow dry run reports and validates the candidate in a disposable checkout, without pushing or opening a PR. The workflow must be on the default branch before scheduled/manual runs are available.

Locally, use Node 22 and run from the repo root:

```sh
npm ci
prlimit --core=1:1 -- node --import tsx packages/duel-server/scripts/update-engine-data.ts --dry-run
```

The default report is `.status/engine-data-update.md` (ignored by git). `--report <path>` changes it. Use `--scripts <sha> --database <sha> --strings <sha>` to reproduce a candidate exactly; omit `--dry-run` to apply it. Local dry runs write only the report and remove downloaded temporary data. `GH_TOKEN` or `GITHUB_TOKEN` can raise the API rate limit; neither is required for public upstream data. Download/API errors fail the command; reported conflicts do not.

## Review the report

- **Commits and scripts:** compare links show every upstream change; new/changed official `cNNN.lua` scripts include names from the candidate `cards.cdb` where available. A database update can add card data without adding an official script.
- **Overlay conflicts:** every manifest stock hash is compared with the candidate stock, including pre-errata scripts. A human or Codex must reconcile the affected overlay Lua with upstream, then update its `stockSha256` after review. Do not just replace the hash to silence the report. Missing stock files also need review. Run `node --import tsx packages/duel-server/scripts/generate-multi-scripts.ts --check` again after fixing the overlay. A passing generator check alone does not prove the stock hashes match.
- **New multiplayer risks:** these are new/changed official scripts flagged F or ambiguous O by the existing scanner and absent from both multiplayer lists. Decide whether to add a tested multiplayer rule/overlay or forbid the card in the affected formats. Existing flagged scripts that did not change are outside this report.
- **May need a newer core:** the best-effort check reads the exact pinned core from existing local build Git caches and compares Duel/Card/Effect names, accounting for candidate Lua helpers. It skips with a note when sources are unavailable. It does not check global constants or colon-method calls, and cannot prove compatibility. Investigate missing APIs in a separate, manually reviewed core update; this job never updates the core.
- **Validation:** bundle preparation must succeed. Overlay checker failures are attached to the report so a reviewable PR still opens. Resolve reported conflicts and review CI before merging.

The next run replaces the fixed branch from the default branch, including manual overlay edits made there. Finish the review before rerunning, or preserve those edits on a separate branch. There is no automatic merge.

**Live-duel warning:** a merged data bump changes `bundleVersion` and rebuilds the bundle on deploy. Active duels with a different bundle version are interrupted on recovery. Drain active duels and **merge at a quiet time**. The deploy preflight can refuse while duels remain active; see the [VM runbook](vm-runbook.md).
