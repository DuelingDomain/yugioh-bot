# Fast Main Deployment Implementation Plan

> **For agentic workers:** Execute this plan inline with the executing-plans skill. Review workflow safety before publishing.

**Goal:** Test ordinary web/bot changes in six minutes and make production live within ten minutes of merge, without reducing coverage or changing release guards.

**Architecture:** Run five package test/build groups and two full-coverage web shards immediately. Share exact-lockfile npm installs and content-addressed Turbo build results. Build production ARM64 images during main push Test; Deploy consumes immutable digests and the exact production bundle from that successful run. Preserve manual deploy and retained rollback behavior.

**Tech Stack:** GitHub Actions, Node 22, npm workspaces, Turbo, Next 16.4, Docker Buildx, GHCR.

## Design decisions

- Keep workflow_run Deploy rather than moving VM access into Test. Test can build and publish images, but cannot deploy them. Only a successful main push Test supplies automatic release artifacts.
- Extract existing production bundle and image build steps into composite actions, so automatic and manual releases use the same build logic. Keep release verification, ancestry checks, runtime controls, activity guard, preflight, digest promotion and rollback in Deploy.
- Download automatic artifacts with the triggering Test run ID, exact SHA and immutable artifact IDs selected only from producer attempts at or before the successful Test attempt. Attempt-specific names prevent queued releases from reading a newer rerun. Partial reruns reuse the bundle job output. Never search for the latest artifact or use a mutable image tag for automatic promotion. Missing artifacts fail closed. Manual deployments retain the current build path, and rollback retains its digest resolution path.
- Cancel stale main Test runs to release runner slots, classifying the cumulative diff from a fully successful tested ancestor so cancelled engine changes cannot escape validation; keep production deploy serialization and card-data smoke concurrency unchanged.
- Keep every unit test and typecheck. Change web sharding from four to two to offset package fan-out. Engine detection also covers the extracted actions; every engine suite remains required for affected changes.
- Cache node_modules only on an exact key including OS, architecture, Node version, lockfile, workspace manifests and patch files. Cache .turbo with per-job rolling keys; invoke shared/worker builds through Turbo. Never cache unit test execution.
- Cache .next/cache in the CI web build; keep CI dummy-key output separate from production Docker output. Retry only font download failures once. Explicitly enable Turbopack filesystem build caching.

## Tasks

- [x] Add regression checks for failed/cancelled/skipped package groups and cross-run artifact provenance before workflow edits. Run them and confirm expected failures.
- [x] Add .github/actions/setup-ci-node/action.yml; split test.yml package work into five independent jobs, retain both aggregate names and all existing checks, and use two web shards.
- [x] Extract .github/actions/prepare-production-bundle/action.yml and .github/actions/build-production-image/action.yml from deploy.yml. Add main-only production bundle/image jobs to Test. Bind automatic Deploy downloads to the successful triggering Test run; keep manual/rollback paths.
- [x] Add CI Next cache and font-only retry; verify retry behavior with fake npm commands. Enable Turbopack filesystem cache in packages/web/next.config.ts.
- [x] Run workflow/helper/deployment regression suites, actionlint on every modified workflow, and inspect the final diff for lost coverage or weakened guards.
- [ ] Obtain independent code review, resolve findings, commit with the required trailer, push and create the PR. Include before/after timings, design, risk and rollback, with the required footer.
- [ ] Wait for the PR CI, repair any failures, record actual job timings and queue time, and update the PR with the main-path estimate. Do not merge or dispatch Deploy.

## Validation and timing

Baseline supplied by owner: up to seven minutes queue, fourteen minutes sequential package job, four roughly two-minute web shards, six-minute Deploy (including parallel image builds). Org API reports Free: published standard-hosted concurrency is twenty; other workflows and engine PRs share that pool. PR modifies workflows, so its engine suites must run and its overall duration is not the non-engine estimate. Report unit critical path separately and distinguish measured PR durations from estimated main production timing. Cold engine builds, runner congestion and active-game guards can exceed the target; preserve guards.

Paid faster runners could reduce CPU build time; more concurrency could reduce pool queue time. Enable no paid features. Roll back by reverting this PR; retained production rollback stays unchanged.

Local validation: 74 Node helper/runtime tests, 17 Python safety/helper tests and 8 deployment Vitest tests passed. All seven workspace typechecks ran without cache (26.2 seconds locally); the dummy-key Next build passed. Actionlint 1.7.12 passes workflows with a narrow ignore for the pre-existing `concurrency.queue: max` key, documented by GitHub but not yet understood by actionlint. Extracted composite steps were also linted as workflow steps. The independent review found and resolved cumulative main diff selection, extracted-action path detection and rerun artifact provenance.
