## A. Owner-only admin console

**Access and navigation.** `/admin` is a standalone, full-screen workspace. The page redirects missing sessions to sign-in and returns not-found for identified nonowners. `OWNER_USER_IDS` is a comma-separated allowlist of positive application `users.id` integers, read at authorization time. An empty list grants nobody access. The web helper re-exports this shared policy. Every console data request independently resolves the session and checks ownership before loading data, and returns private/no-store responses. The shell's `/api/admin/access` response only controls link visibility. [admin/page.tsx:13](<../../../../packages/web/app/(app)/admin/page.tsx:13>), [owner-access.ts:1](../../../../packages/web/src/lib/owner-access.ts:1), [shared/owner-access.ts:5](../../../../packages/shared/src/access/owner-access.ts:5), [section.ts:54](../../../../packages/web/src/lib/admin-console/section.ts:54), [access/route.ts:9](../../../../packages/web/app/api/admin/access/route.ts:9).

There are six views, rendered one at a time: Overview, People, Duels, Waitlist, Health, Insights.
- Navigation uses URL hashes. `#duels-today` opens Duels and scrolls to Today.
- Keys 1–6 switch views, `/` focuses People filtering, and Escape closes the mobile detail sheet.
- Desktop navigation carries live counts and status badges. Phones use a fixed six-tab bottom bar.

[model.ts:8](../../../../packages/web/src/components/admin-console/model.ts:8), [admin-console.tsx:91](../../../../packages/web/src/components/admin-console/admin-console.tsx:91), [admin-console.tsx:136](../../../../packages/web/src/components/admin-console/admin-console.tsx:136), [admin-console.tsx:224](../../../../packages/web/src/components/admin-console/admin-console.tsx:224).

**Views and layout:**

- **Overview:** four large statistics (online, live duels, today's duels, seven-day sign-ups), then "Needs attention" rows. Below that, online-person chips and live-table summaries sit side by side, with Watch actions. [views/overview.tsx:33](../../../../packages/web/src/components/admin-console/views/overview.tsx:33).
- **People:** search plus All/In a duel/Drafting/Other segments. Selectable rows show person, section, online duration and current table. A right-hand detail pane shows identity, current location, Watch, joined date, activity counts, win rate and timeline. It becomes a bottom sheet on phones. [views/people.tsx:123](../../../../packages/web/src/components/admin-console/views/people.tsx:123), [views/people.tsx:47](../../../../packages/web/src/components/admin-console/views/people.tsx:47).
- **Duels:** All/Duels/Drafts segments. Duel rows show format/ranked tags, players, turn, age and Watch. Draft rows substitute progress/pick bars. Today adds local-day results, per-player outcomes, start times and Watch/Replay, filterable by All/1v1/Multi/Ranked. [views/duels.tsx:127](../../../../packages/web/src/components/admin-console/views/duels.tsx:127), [views/duels.tsx:70](../../../../packages/web/src/components/admin-console/views/duels.tsx:70).
- **Waitlist:** up to 50 pending Clerk requests. Emails are masked, with a reveal toggle. Rows have large initials avatars, request age/date and approval controls. Recent decisions appear underneath. [views/waitlist.tsx:60](../../../../packages/web/src/components/admin-console/views/waitlist.tsx:60).
- **Health:** service/state/metric rows, VPS host/container capacity and 24-hour charts, plus disk breakdown and Versions columns. [views/health.tsx:63](../../../../packages/web/src/components/admin-console/views/health.tsx:63), [views/vps-health.tsx:42](../../../../packages/web/src/components/admin-console/views/vps-health.tsx:42).
- **Insights:** four seven-day trend columns (sign-ups, active users, duels, drafts) above Sentry error rows and PostHog visitor/page-view/top-page summaries. [views/insights.tsx:30](../../../../packages/web/src/components/admin-console/views/insights.tsx:30).

**Visual specification.** Palette tokens:

```css
--bg: #08090b; --bg2: #0c0d10; --hover: #121418; --sel: #16191e;
--line: #1a1c21; --line2: #262930;
--t1: #f3f3f1; --t2: #a8abb2; --t3: #6d717a; --t4: #43474f;
--good: #3fd28a; --warn: #f2b443; --crit: #ff6868; --info: #8fb3ff;
--gold: #e3c27a; --goldDim: rgba(227, 194, 122, .32);
--s1: #3987e5; --s2: #d95926; --s3: #199e70;
--s4: #c98500; --s5: #d55181; --other: #5b5f68;
```

Schibsted Grotesk supplies body and headings at weights 400–700. Martian Mono supplies labels, counts and metadata at weights 400/500. They are exposed as `--adm-sans` and `--adm-mono`. [admin-console.module.css:3](../../../../packages/web/src/components/admin-console/admin-console.module.css:3), [admin/page.tsx:10](<../../../../packages/web/app/(app)/admin/page.tsx:10>).

The composition uses thin rules and open sections.
- The base rail is 252px wide. Content max-width is 1560px with `44px 64px 96px` padding.
- Headers combine an 11px uppercase, tracked mono eyebrow, a 46px semibold title and a 16.5px secondary description.
- Section headings are 21px with 60px separation.
- Tables use CSS-grid rows with 20px gaps, 16px horizontal and 14px vertical padding, hairline separators and 10px uppercase mono headers.
- Hover uses `--hover`. Selection uses `--sel` plus a 3px gold edge.
- Statistics use oversized tabular numerals and vertical dividers.

[admin-console.module.css:10](../../../../packages/web/src/components/admin-console/admin-console.module.css:10), [admin-console.module.css:58](../../../../packages/web/src/components/admin-console/admin-console.module.css:58), [admin-console.module.css:135](../../../../packages/web/src/components/admin-console/admin-console.module.css:135), [admin-console.module.css:172](../../../../packages/web/src/components/admin-console/admin-console.module.css:172).

Reusable parts include avatars, outlined tags, section headings, shape-and-color status icons and notices. Buttons are 38px high with a 9px radius. Primary is off-white with dark text, and danger is red. Charts use SVG lines/areas and value tooltips. Below 1240px the rail becomes icon-only. At 760px it disappears, table headers hide and rows reflow vertically. [parts.tsx:32](../../../../packages/web/src/components/admin-console/parts.tsx:32), [admin-console.module.css:86](../../../../packages/web/src/components/admin-console/admin-console.module.css:86), [charts.tsx:43](../../../../packages/web/src/components/admin-console/charts.tsx:43), [admin-console.module.css:418](../../../../packages/web/src/components/admin-console/admin-console.module.css:418).

**Approval pattern.**
- The UI offers Approve and Reject, with inline confirmation and Cancel. It shows pending disabled controls, row errors and results, a toast, and a refresh. [views/waitlist.tsx:41](../../../../packages/web/src/components/admin-console/views/waitlist.tsx:41), [views/waitlist.tsx:89](../../../../packages/web/src/components/admin-console/views/waitlist.tsx:89).
- The POST rechecks ownership and Origin, then resolves identity server-side. It delegates to a transactional decision service with already-decided, conflict and in-progress outcomes. Approval invokes a Clerk invitation. [waitlist/[id]/route.ts:15](../../../../packages/web/app/api/admin/console/waitlist/[id]/route.ts:15), [waitlist-decisions.ts:96](../../../../packages/shared/src/services/waitlist-decisions.ts:96).

**Data polling.** Data sections share deduplicated polls, keep previous results on transport failure and pause polling while hidden. Intervals are 10s for online/live, 15s for today, 30s for waitlist/system and 60s for stats/errors/usage. [use-admin-section.ts:49](../../../../packages/web/src/components/admin-console/use-admin-section.ts:49), [use-admin-section.ts:72](../../../../packages/web/src/components/admin-console/use-admin-section.ts:72), [sections.ts:4](../../../../packages/web/src/lib/admin-console/sections.ts:4).

## B. Bug-report flow

**Entry and form.**
- A bottom-right "Report bug" FAB lifts above sticky action bars.
- Live duel headers host their own button and suppress the FAB. Duel settings also expose a Feedback menu button.
- All three open the same dialog.

[bug-report-fab.tsx:15](../../../../packages/web/src/components/bug-report/bug-report-fab.tsx:15), [bug-report-header-button.tsx:18](../../../../packages/web/src/components/bug-report/bug-report-header-button.tsx:18), [bug-report-menu-button.tsx:14](../../../../packages/web/src/components/bug-report/bug-report-menu-button.tsx:14).

Required fields are "What went wrong?" and "What did you expect?"
- The description needs 20 characters and four words. Expected needs ten characters. Each caps at 4000.
- The form optionally attaches a recent duel.
- The copy says screenshots are optional, but the form has no upload control.

[bug-report-dialog.tsx:266](../../../../packages/web/src/components/bug-report/bug-report-dialog.tsx:266), [bug-report.ts:68](../../../../packages/web/src/lib/bug-report.ts:68).

**Precheck and authentication.**
- Dialog steps are write, checking, review and done.
- A five-second precheck returns known limitations and up to three similar issues, prioritizing same-duel reports.
- Review offers "Yes, same bug", a different-bug submission and Back. If the precheck is unavailable, it falls through to submission.
- An authentication refusal triggers one token-refresh retry.
- Text survives reauthentication in sessionStorage, scoped to user and path for 30 minutes. Board data and tokens are excluded.

[bug-report-dialog.tsx:18](../../../../packages/web/src/components/bug-report/bug-report-dialog.tsx:18), [bug-report-dialog.tsx:157](../../../../packages/web/src/components/bug-report/bug-report-dialog.tsx:157), [similarity.ts:68](../../../../packages/web/src/lib/bug-reports/similarity.ts:68), [client-request.ts:28](../../../../packages/web/src/lib/bug-reports/client-request.ts:28), [auth-draft.ts:3](../../../../packages/web/src/components/bug-report/auth-draft.ts:3).

**Submission, storage and status.**
- The authenticated POST validates input, limits players to five reports per ten minutes and reuses identical recent submissions.
- SQLite saves first. GitHub then creates an issue or adds a duplicate "+1". A GitHub failure preserves the report.
- Labels are `bug`, `needs-triage` and `from-app`. There is no local approval or resolution status field.
- `bug_reports` stores identity, guild and player, time, path and duel, text and context, GitHub linkage and error, duplicate target, submitter snapshot, diagnostics, an opaque public ID and a submission fingerprint.

[api/bug-reports/route.ts:45](../../../../packages/web/app/api/bug-reports/route.ts:45), [api/bug-reports/route.ts:130](../../../../packages/web/app/api/bug-reports/route.ts:130), [bug-report-github.ts:3](../../../../packages/web/src/lib/bug-report-github.ts:3), [schema.ts:1239](../../../../packages/shared/src/db/schema.ts:1239).

**Automatic evidence.**
- Browser context includes pathname, viewport, user agent, animation speed and room/deck context.
- The server checks duel access and stamps the time. It captures format, rules, seat, turn, phase and living players, plus the spectator board, public log and replay-moment metadata. Replay forks are refused.
- Owned/editor decks and test hands can be saved privately.
- Public issues use redacted text, masked route identifiers, browser family and version, public facts and at most 15 log lines. Identity, board, reporter seat and replay links are excluded.

[context.ts:15](../../../../packages/web/src/components/bug-report/context.ts:15), [server-context.ts:44](../../../../packages/web/src/lib/bug-reports/server-context.ts:44), [api/bug-reports/route.ts:80](../../../../packages/web/app/api/bug-reports/route.ts:80), [bug-report.ts:452](../../../../packages/web/src/lib/bug-report.ts:452).

**Owner triage.**
- `/settings/bug-reports` uses the ordinary SheetRoot layout. It lists newest first with 50-row pagination. Each row shows the report reference, submitter, UTC time, duel/replay, GitHub/error and JSON links.
- The detail page adds text, context and versions, expandable diagnostics and a deck download.
- The private list, detail and deck APIs recheck ownership and guild scope. Replay access is checked again after reconstruction.
- These are inspection surfaces with no approval controls.

[bug-reports/page.tsx:18](<../../../../packages/web/app/(app)/settings/bug-reports/page.tsx:18>), [bug-reports/[id]/page.tsx:22](<../../../../packages/web/app/(app)/settings/bug-reports/[id]/page.tsx:22>), [owner-access.ts:8](../../../../packages/web/src/lib/bug-reports/owner-access.ts:8), [replay/route.ts:20](../../../../packages/web/app/api/admin/bug-reports/[id]/replay/route.ts:20).

**Plan drift and reporter notification.**
- The October 19 plan specifies 400 diagnostic log entries and 256 KiB total. Current serialization allows a 10,000-entry/2 MiB public-log tail and a 128 KiB board.
- Reporters get an immediate acknowledgment: the issue link, or "Saved — the team will see it."
- No later reporter notification or reply mechanism was found in the inspected flow.

[plan.md:37](../../../../docs/superpowers/plans/2026-10-19-bug-report-flow.md:37), [bug-report-diagnostics.ts:30](../../../../packages/shared/src/services/bug-report-diagnostics.ts:30), [bug-report-dialog.tsx:195](../../../../packages/web/src/components/bug-report/bug-report-dialog.tsx:195), [bug-reports.ts:149](../../../../packages/shared/src/services/bug-reports.ts:149).