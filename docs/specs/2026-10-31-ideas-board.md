# Ideas board: spec

**Status: draft for owner review (2026-10-31).** Direction A, The Ladder, from the workshop in `docs/design/feedback-board/` (PR #497). The owner's nine answers are in that folder's README. Where the A mock draws something, the mock is the spec; this file covers what it doesn't.

## What it is

A page called **Ideas** where players suggest features and vote up or down. The owner approves new ideas, marks the ones being built as In progress, and marks them Done. The board is a ranked list like the leaderboard.

An idea is always in one of these states:

1. **Waiting:** a player just posted it. Only the author and the owner see it. Team posts skip this.
2. **Open:** on the ladder, ranked by up minus down. Ties go to more up votes, then older first.
3. **In progress:** pinned in a short band above the ladder. One label, nothing else.
4. **Done:** on the Done tab. The author and everyone who voted up get one in-app notice.
5. **Declined:** off the board. The author sees the reason under "Your ideas".

The owner's job is three actions in `/admin`: Approve or Decline, Start, Done.

## Owner answers this builds on

- Name "Ideas".
- Team is a new permission. Holders' posts skip Waiting and carry the Team label. Owners (`OWNER_USER_IDS`) always hold it.
- Voting needs one finished duel, draft or tournament match.
- Both counts are shown ("14 up · 1 down").
- The after-game ask appears at most once a day, only when there's an idea you haven't voted on, and never blocks Exit, Rematch or Replay.
- All six rank parts start Open.
- The author chooses whether to show their name. It appears only once the idea is approved.
- Card details on phones and Theme drafts start In progress. Daily puzzle stays off.

## My defaults: change any

1. **Who may post:** the same gate as voting (one finished activity). Limits: at most 3 ideas a day each, a title of 80 characters or fewer, and an optional line of 140 characters or fewer. Areas: Ranked, Duels, Drafts, Tournaments, Decks & cubes, Replays & watching, Community, App.
2. **Votes:** tap Vote up or Vote down; tap the same one again to clear it. You can't vote on your own idea. Voting closes at Start: In progress ideas show no vote buttons, as in the A mock, and their counts freeze.
3. **The after-game row** shows the **newest** Open idea you haven't voted on. That fixes the Ladder's weak spot, where new ideas start at the bottom. It appears on the duel result (players only, not spectators, and not for cancelled or interrupted games), the draft "Draft complete" finale, and the tournament closed view. After a vote, its line says where the idea now ranks.
4. **Where notices show:** a dot on the **Ideas** nav item, and a short Notices list at the top of the Ideas page. Notices are marked read when that list is seen. No email, Discord or toasts.
5. **Declined ideas:** stay under the author's "Your ideas" with the reason, and the author also gets a notice. The presets are "Already on the board", "It's a bug, reported for you" and "Not for now", plus an optional typed line.
6. **Done needs a confirm** in the console, because it sends notices and can't be undone. Approve, Decline and Start apply in one tap. There's no undo in v1; the console shows which ideas the owner moved by mistake.
7. **The Done tab** groups ideas by week, newest first. The real shipped log seeds it as entries marked "Shipped before Ideas opened", with no votes.
8. **Live updates:** none. The page refetches when it regains focus and after each vote. No websocket work.
9. **Out of v1:** a page for granting Team, editing idea text, comments, analytics events and search. Each one is a small follow-up.

## Seed (run once, by the owner)

The seed is an owner CLI step in the worker image, not part of `migrate`. Like the other ops tools, it's a dry run by default and writes only with `--apply`. Running it again does nothing.

- **Team ideas** are authored by the first `OWNER_USER_IDS` user, with the Team label and **0 votes**:
  - Open: the six rank parts NT-102 to NT-107 from `research/product-brief.md` 5a; NT-108 to NT-115 from 5b; NT-118 Readable text everywhere; NT-119 Clear, consistent format names.
  - In progress: NT-117 Card details that fit on a phone and NT-116 Theme drafts.
  - Pitches are cut to one line, as in the A mock.
- **Done:** the real shipped lines from 5e, by week.
- **Never seeded:** invented players, handles or votes. That leaves out NT-121 Rematch, which is credited to a made-up player, and the brief notes rematch may already exist. All mock vote counts are left out too.

## Data (shared SQLite, `packages/shared/src/db/schema.ts`)

| Table | Columns |
|---|---|
| `ideas` | `id`, `guild_id`, `title`, `pitch` (null allowed), `area`, `author_user_id` (references users, set null on delete), `show_author`, `team`, `state` (`waiting`, `open`, `in_progress`, `done`, `declined`), `decline_reason`, `done_note`, `shipped_before_board` (seed flag), `shipped_week`, `created_at`, `approved_at`, `started_at`, `done_at`, `decided_by_user_id` |
| `idea_votes` | primary key (`idea_id`, `user_id`), `value` (−1 or 1), `created_at`, `updated_at`; cascades with both the idea and the user |
| `idea_notices` | `id`, `user_id` (cascade), `idea_id` (cascade), `kind` (`done` or `declined`), `note`, `created_at`, `read_at`; unique (`user_id`, `idea_id`, `kind`) |
| `user_permissions` | primary key (`user_id`, `permission`), `permission` (only `ideas_team` for now), `granted_at`, `granted_by_user_id` |
| `users` | new column `ideas_prompt_at`: when the after-game row was last shown |

**Rules:**
- Counts are computed from `idea_votes`.
- Every read is scoped to `DISCORD_GUILD_ID`, as elsewhere.
- Done writes the notices in the same transaction as the state change, then returns how many were sent.

**Accounts.** These paths must handle the new tables:
- **Account merge** (`packages/worker/src/ops/merge-users.ts`) and **identity fold** (`packages/shared/src/services/users.ts`, the Discord link fold): move votes, notices and permissions to the surviving user with insert-or-ignore, so the surviving user's own row wins. Reassign `ideas.author_user_id`, and keep the later `ideas_prompt_at`.
- **Account deletion** (`packages/shared/src/services/account-deletion.ts` and its preview): votes, notices and permissions go. The person's Waiting and Declined ideas are deleted. Their approved ideas stay on the board with no author.

## API (web, `packages/web/app/api/`)

| Route | Use |
|---|---|
| `GET /api/ideas` | Board: In progress, the ranked Open list, your ideas (Waiting and Declined), unread notices, and whether you can vote and post |
| `GET /api/ideas/done` | Done list by week |
| `POST /api/ideas` | Post an idea: `title`, `pitch`, `area`, `showAuthor` |
| `PUT /api/ideas/[id]/vote` | `value` of 1, −1 or 0 |
| `POST /api/ideas/notices/read` | Mark notices read |
| `GET /api/ideas/prompt?at=duel\|draft\|tournament` | One idea or null, and records `ideas_prompt_at` |
| `GET /api/admin/console/ideas` | Owner only: Waiting, Open, In progress and recent Done, with counts |
| `POST /api/admin/console/ideas/[id]` | Owner only: `approve`, `decline` (with `reason` and optional `line`), `start`, `done` (with optional `note`) |

Protected like every other API route (`web-access.ts`). Owner routes reuse the console's owner check and Origin check, and return no-store responses. Expected errors use `ExpectedError` (for example "not played yet", "daily limit", "already decided").

## UI (follows the A mock and the tournament D look; dark first)

- **`/ideas` page and an "Ideas" nav item with the notice dot.** Two tabs, Ideas and Done.
  - The Ideas tab shows the In progress band, the ladder (big numerals for the top three, area filter tags, rows sliding when a vote moves them), then "Your ideas".
  - "Suggest an idea" opens the post form, the only modal. It holds a title, an optional line, an area picker, a "Show my name" switch and Post.
  - If you haven't played yet, vote and post controls show one line: "Finish one duel, draft or tournament match to vote and post."
- **The admin console** gets a new Ideas section in its existing styling, with a Waiting count on the rail. It holds four lists: Waiting (Approve, and Decline with presets and a line), Open (Start), In progress (Done, with an optional note, a confirm, and then "Notice sent to N players") and recent Done.
- **The after-game row** goes on the duel result, the draft finale and the tournament closed view. It holds one ladder row with Vote up, Vote down and "Suggest an idea", placed after the existing actions.

The A mock doesn't draw some of these: the "Ideas" name, the "Show my name" switch, the not-played line, the declined view, the nav dot, the row on the draft finale and tournament views, and the console section in real console styling. A final mock pass on the workshop covers them before the UI build.

## Build order

1. The owner approves this spec.
2. Two tracks run in parallel:
   - **Codex** (`gpt-6.1-sol`, `xhigh`): schema, the shared ideas service and its tests, API routes, the merge, fold and deletion updates, and the seed command.
   - **Sonnet:** the final mock pass on the workshop. The owner reviews it.
3. **Sonnet** builds the UI on that API.
4. Opus reviews every diff and the screenshots at 1440 and 390. Focused tests are run, then a full test, typecheck and build. Commits go on `feat/ideas-board`, cut from this design branch so the mocks and spec come along. No push, PR or merge without the owner's go.
