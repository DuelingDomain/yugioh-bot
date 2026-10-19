# Report reconstruction check

Verified on 2026-10-19 from origin/main `0519c070a`, including PR #398.

## Safety

The GitHub target is `DuelingDomain/yugioh-bot`. The code reads
`BUG_REPORT_GITHUB_TOKEN` and `BUG_REPORT_GITHUB_REPO`. The API address is fixed
to GitHub. Tests used the isolated E2E stack, slot 8, with its own SQLite file.
The web process had no GitHub token. All reports returned `issue: null` and
were saved in that database. No public issue was created.

No environment file was read. Commands used Node 22.23.3, `prlimit --core=0`,
and the existing environment-file guard. Engine tests used a separate copy of
the engine files. No source engine data was changed.

## Faults and changes

The old flow saved the submitter and a public board, but it had no journal
boundary. It also lost log entries at two 400-entry limits. Reports from a
deck editor had no deck data.

New reports save these private fields in `diagnostics_json`:

- The board and complete public log.
- The duel ID, journal count, last stored sequence, revision, and prefix hash.
- The engine bundle version, engine identity, rule version, master rule, and result.
- For deck reports: deck ID, format, current deck, and test-hand draw/pile order.
  The current deck copy also preserves unsaved changes.

The report row keeps the submitter, page, duel slug, and context. Context
includes format, mode, seat, turn, phase, browser data, and capture time.

A capture keeps its board and journal boundary together. The first board and
recovered board are captured before further actions. A timeout uses that pair;
it cannot attach a new journal count to an old board or replace the full log
with a cached tail. Normal live views still return their last 400 entries.

The owner list links to the exact report moment. The detail page shows the
private data and provides a deck download. The link resolves the saved prefix
against the current replay, checks the board, and opens the existing replay
browser. Replays are available after the duel ends. The existing Jump in route
creates the private fork. A completed report selects the result frame. A replay
that exceeds the view-size limit keeps the report move selected for Jump in.

Outside a duel, the dialog offers `Attach my last duel`, selected by default,
for ten minutes after a normal duel visit. A fork cannot replace that visit.
The server checks duel access before it saves an attachment.

The public issue builder keeps its existing field list: sanitized report text,
masked page path, public context, the last 15 public log lines, and the public
report ID. Submitter data, board, deck, slug, journal data, engine identity,
and private links do not enter the issue body.

## Proof

`packages/e2e/tests/bug-report-recreate.spec.ts` passed all four report tests
and five login setup tests:

- A deck editor report saves its private deck, format, test hand, and working download.
- A Domain 1v1 report at turn 3 restores the same board in replay and Jump in.
- An FFA3 report at turn 4 restores the same board in replay and Jump in.
- A real 120-turn duel saves all 845 public log entries.

Both short duels use normal summons, Pot of Greed, a chained Ash Blossom,
and Number 39: Utopia with two materials. The tests advance and end the source
duel after the report, then compare the saved board with the selected replay
and fork. They also check owner access, the public issue preview, completed
attachments, attachment refusal/expiry, and the oversized replay response.

The three integration files passed four tests:

- `bug-report-storage.integration.test.ts`: complete log and private references in SQLite.
- `report-full-log.integration.test.ts`: more than 400 real events on pinned and legacy engines.
- `host-report-capture.integration.test.ts`: first-action overlap and older/same-revision timeout fallback.

Typecheck passed in all seven workspaces. Shared, duel-server, and the E2E web
production build passed. Only integration and E2E tests were run.

Screenshots, saved reports, public issue previews, action records, and test
logs are in:

`/tmp/claude-1000/-home-sulman633-repos-yugioh-bot--worktrees-domain-multiplayer/10ba6d31-2c71-4959-b27e-a5c664be6dac/scratchpad/report-e2e/`
