# Report reconstruction check

Verified on 2026-10-19 from origin/main `0519c070a`, including PR #398.

## Review corrections, 19 October 2026

The review of `3c03f7273` required a hard log limit. These rules supersede
references to a complete or full log below:

- The top-level report log keeps the newest entries within 2 MiB and 10,000
  entries. If storage removes entries or shortens an oversized entry, the saved
  data has `logTruncated: true` and `logTotal` with the input entry count.
- Both engines retain at most 10,000 log entries. Normal live views keep 400.
- Final public snapshots keep 400 entries. Replay verification uses board
  state and the command journal; it does not compare log history. A report
  first captured after the duel ends uses this final log tail.
- An accepted move already creates one full-log spectator view in
  `persistAcceptedCommand`. That same view updates the report capture. The
  other call at the cited line 2200 is in `startPreset`, not the move path.
  The host integration test counts calls to protect this behavior.
- The owner download says `Deck in the editor at report time (.ydk)` for an
  editor capture. It says `Saved deck (.ydk)` for a saved deck capture.

Before the change, the new checks failed for 20,000 stored entries, UTF-8 byte
limits, one oversized entry, both engine retention limits, the final snapshot,
and both deck labels. After the change, 28 integration tests passed across six
files. The tests include 845 stored entries without loss, more than 21,000 real
engine events on each engine, and real replay reconstruction and verification.
All seven workspace typechecks passed with the cache disabled. No new unit
tests were added. Commands used Node 22.23.3, `prlimit --core=0`, the existing
no-environment-file preload, and the isolated `/tmp/report-local-all-engine`
bundle. Source build output was removed after the checks.

The local port applies source commit `62147f0e882cecfca5c605c4085a825708b58ac7`
to `test/local-all`. It keeps that branch's Discord identity and engine code.
The same 28 integration tests passed there. All six local workspace typechecks
passed with the cache disabled. Existing bot and WebSocket test helpers import
shared test data outside their package directories. Their typecheck root now
includes the repository; each production build still sets its root to `src`.

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
