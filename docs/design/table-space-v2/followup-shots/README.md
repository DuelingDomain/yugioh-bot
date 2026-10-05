# Table follow-up visual checks

The 16 shots in this folder were rendered from `/dev/table-preview` with `capture.mjs`
(Chromium headless, Node 22). `results.json` records page errors, overflow and chain collisions.

Chain-strip check vs main on the same matrix: main reports 10 problems (9 strip overlaps plus
classic 1v1 phone with no strip). This branch reports 2, and main has both of them too: Tag phone
(the strip touches the Tag header; Tag is outside this change) and classic 1v1 phone (classic draws
its chain inside the prompt, so there is no strip to find). All FFA3/FFA4 shots are clean.

## Original notes from the Codex run


New screenshots could not be produced in this run. The sandbox rejects both the Next dev
server's listening socket (`listen EPERM`) and Chromium's socket setup (`Operation not
permitted`, SIGTRAP). Chromium and chromium-headless-shell both failed before opening a page.
No screenshot or page-error check is claimed as passing.

`capture.mjs` uses the existing `/dev/table-preview` fixture harness and saves the requested
matrix here: FFA4/FFA3 chain-2 at 1920×1080 closed, 1440×900 open, and 1366×768 both open
and closed; plus 390×844 main and chain-2 for FFA4, FFA3, Tag and classic 1v1.
It records page/console errors, horizontal overflow and chain collisions in `results.json`.
Every generated image still needs to be inspected.

With browser execution and a local server available, from the repository root:

```sh
source ~/.nvm/nvm.sh && nvm use 22
npm run build --workspace=packages/shared
DUEL_FX_LAB=1 npm run dev --workspace=packages/web -- --port 3100
# In a second terminal with Node 22:
PREVIEW_BASE=http://localhost:3100 node docs/design/table-space-v2/followup-shots/capture.mjs
```

The cancelled `/tmp/yugioh-table-followups` worktree and branch were discarded.
The fresh worktree is `/tmp/table-followups`, backed by `/tmp/table-followups-git`.
The GitHub connector verified the base against current remote main:
`9efc9fb8cd620f70776a1fec4dbb1d53da895ddb`, including PRs #168 and #164.

Validation under Node 22.23.2:

- Shared built first; `npm run typecheck` passed all six workspaces.
- 62 focused checks passed, including both phone integration cases.
- Full web Vitest run (two workers): 7,856 passed, 11 failed, 9 skipped across 551 files.
  Nine failures are seed subprocess `EPERM` errors, one is a blocked external card-database
  fetch, and one draft API test hit its five-second timeout. The timed-out test passed when
  rerun alone with the original timeout. No unrelated test or application code was changed.
- Logs: `/tmp/table-followups-web-tests.log`, `/tmp/table-followups-final-focused.log`,
  `/tmp/table-followups-phone-integration.log`, `/tmp/table-followups-timeout-rerun.log`,
  `/tmp/table-followups-typecheck.log`.
