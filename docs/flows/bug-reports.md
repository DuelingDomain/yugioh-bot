# Bug reports

A player sends a report from the "Report bug" button. The app saves the full report in SQLite and opens a public GitHub issue with only public facts. A person decides whether the bug is real. Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Where the button is

| Place | Source (`packages/web/src/components/`) |
| --- | --- |
| App header | `bug-report/bug-report-header-button.tsx` (in `layout/app-shell.tsx`) |
| Phone menu | `bug-report/bug-report-menu-button.tsx` (in `layout/mobile-drawer.tsx`) |
| Duel table settings | `duel/table/table-settings.tsx` |
| Draft pages | `draft/draft-frame.tsx` |

The dialog is `bug-report/bug-report-dialog.tsx`.

## Steps

1. The player opens the dialog and writes:
   - "What went wrong?" (at least 20 characters and 4 words)
   - "What did you expect?" (at least 10 characters)
   - On a page that is not a duel, "Attach my last duel" appears if the player was in a duel in the last 10 minutes.
2. Send. The dialog first calls `POST /api/bug-reports/precheck`. It saves nothing and sends nothing to GitHub.
3. If the text matches a known problem (`src/lib/bug-reports/known-limits.ts`) or up to 3 open `from-app` issues, the review step shows them.
   - "Same bug" sends the report with `duplicateOf`. The app adds a "+1 from Report #N" comment to that issue. No new issue.
   - Otherwise the player sends it as a new report.
4. `POST /api/bug-reports` saves the report and opens the issue.
5. The done step shows the issue link. If GitHub failed, the report is still saved and the answer has `issue: null`.

## What is saved

The full report stays in the `bug_reports` table (`packages/shared/src/services/bug-reports.ts`). The browser sends only the text, the page path and browser data (viewport, animation speed, browser, time). The server reads everything else itself (`src/lib/bug-reports/server-context.ts`).

| Saved | Notes |
| --- | --- |
| Submitter | `userId`, `username`, email (may be null), read inside the save transaction |
| Page path and duel slug | The slug is kept only if the player may see that duel |
| Duel facts | Format, rules, turn, phase, seat, living players: from the duel server, not the browser |
| Board and log | The spectator board and the public log, from the duel host `bug-context` call. Last 400 log entries, board up to 128 KiB, all diagnostics up to 256 KiB |
| Deck | On a deck page, a copy of the player's own deck (or the unsaved editor deck) |
| Moment | The replay step, so the owner can open the replay at that moment |

Capture retries once on a 5xx, a timeout or bad data. If capture fails, the report and issue still go out, with a fixed "Log missing because ..." reason.

Reports from a replay fork are refused (409).

## What the public issue holds

The repo is public, so the issue holds only these (`src/lib/bug-report.ts`):

- Title and "Description" and "Expected": the player's text, with account names, emails and Discord IDs removed.
- "Context" table: masked page path (duel slug shown as `[duel]`), format, rules, turn, phase, turn seat, players alive, animation speed, viewport, browser, time.
- "Recent log": the last 15 public log lines.
- A footer: `Report #<public_id>`, a random reference, not the database ID.

There is no reporter seat and no replay link in the issue.

## GitHub

- Repo: `BUG_REPORT_GITHUB_REPO` (default `DuelingDomain/yugioh-bot`). Token: `BUG_REPORT_GITHUB_TOKEN`.
- Labels: `bug`, `needs-triage`, `from-app`. If GitHub refuses the labels, the issue is made without them and the report records a warning.
- With no token, the report is saved with `issue: null`.

## Limits

| Limit | Value |
| --- | --- |
| Reports per player | 5 in 10 minutes (`BUG_REPORT_LIMIT`). More answers 429 with `Retry-After` |
| Same text again | The same submission within 10 minutes returns the first saved report |
| Precheck and duplicate checks | Own per-player limits |

## Triage

Humans triage `needs-triage` + `from-app` issues. Steps and labels: [agents/triage-labels.md](../agents/triage-labels.md). The owner reads the full report at `/settings/bug-reports/[id]` (see [owner-admin.md](owner-admin.md#bug-report-pages)).

Related records: [audits/2026-10-19-report-reconstruction.md](../audits/2026-10-19-report-reconstruction.md) (log limits), [audits/2026-10-23-bug-report-auth.md](../audits/2026-10-23-bug-report-auth.md).

## Dev-only engine report

With `DUEL_SCENARIOS=1`, the duel room also has a dev "Report" button. `POST /api/duels/[slug]/report` makes the duel server write a debug folder on disk. It is not the player bug report.
