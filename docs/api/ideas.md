# Ideas API

All routes resolve the current session through `requireWebAccess`. The actor is an
application `users.id`; a linked Discord account is unnecessary. Reads and writes
use the configured `DISCORD_GUILD_ID`. Client-supplied actor, author, guild,
permission, state and vote-count fields never establish identity or authority.

Every response, including authentication, validation and service errors, has
`Cache-Control: private, no-store`. Handlers run in the Node.js runtime and are
dynamic. There are no websocket events; clients refetch after mutations and when
the page regains focus.

Browser-safe TypeScript contracts are exported from
[`packages/web/src/lib/ideas/types.ts`](../../packages/web/src/lib/ideas/types.ts).
Shared response types are owned by `@yugidraft/shared/services`.

## Routes and responses

Responses are direct JSON objects, without the admin console's section envelope.
Except for a successful post (201) and conflicting owner decisions (409), successful
responses use HTTP 200.

| Method and path | Input | Success body |
|---|---|---|
| `GET /api/ideas` | None | `IdeaBoardResponse` |
| `GET /api/ideas/done` | None | `IdeaDoneResponse` |
| `POST /api/ideas` | `IdeaPostInput` JSON | `IdeaPostResponse` (201) |
| `PUT /api/ideas/[id]/vote` | `{ "value": -1 \| 0 \| 1 }` JSON | `IdeaVoteResponse` |
| `POST /api/ideas/notices/read` | No body | `{ "markedRead": number }` |
| `GET /api/ideas/prompt?at=duel\|draft\|tournament` | Exactly one `at` query value | `IdeaPromptResponse` (object or JSON `null`) |
| `GET /api/admin/console/ideas` | Owner only | `IdeaQueueResponse` |
| `POST /api/admin/console/ideas/[id]` | Owner only; `IdeaDecisionInput` JSON | `IdeaDecisionResponse` |

Both `[id]` segments must be canonical positive decimal safe integers, without
signs, leading zeroes, exponent notation or suffixes. Malformed or unsafe IDs
return 400 `invalid_id`; unknown and foreign-guild IDs return 404 `not_found`.

The owner routes recheck `OWNER_USER_IDS` for every request; identified nonowners
receive 404 `not_found`. Owner POST additionally requires the exact `Origin`
header returned by `webOrigin()` (the HTTP(S) origin of `WEB_URL`). A missing or
mismatched Origin, or missing/invalid `WEB_URL`, returns 403 `invalid_origin`.

## Wire types

`Idea` contains the full field list below. `rank` is the **ordinal position** on
the Open ladder, starting at 1; `score` is **up minus down**. Open order is score
descending, then up count descending, then oldest creation time, then smallest
ID. Non-Open ideas have `rank: null`; In progress vote counts are frozen.

```ts
type IdeaArea =
  | "Ranked" | "Duels" | "Drafts" | "Tournaments"
  | "Decks & cubes" | "Replays & watching" | "Community" | "App";
type IdeaState = "waiting" | "open" | "in_progress" | "done" | "declined";
type IdeaVoteValue = -1 | 0 | 1;
type IdeaGateReason = "not_played_yet" | "daily_limit";

interface Idea {
  id: number;
  title: string;
  pitch: string | null;
  area: IdeaArea;
  authorName: string | null;
  isOwn: boolean;
  showAuthor: boolean;
  team: boolean;
  state: IdeaState;
  declineReason: string | null;
  doneNote: string | null;
  shippedBeforeBoard: boolean;
  shippedWeek: string | null; // YYYY-MM-DD, historical UTC Monday
  createdAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  decidedByUserId: number | null;
  up: number;
  down: number;
  score: number;
  rank: number | null;
  viewerVote: IdeaVoteValue;
}

interface IdeaNotice {
  id: number;
  ideaId: number;
  title: string;
  kind: "done" | "declined";
  note: string | null;
  createdAt: string;
}

interface IdeaBoardResponse {
  inProgress: Idea[];
  open: Idea[];
  yourIdeas: Idea[];
  notices: IdeaNotice[];
  canVote: boolean;
  canPost: boolean;
  voteReason: IdeaGateReason | null;
  postReason: IdeaGateReason | null;
}

interface IdeaDoneResponse {
  weeks: Array<{ week: string; ideas: Idea[] }>;
}
interface IdeaPostResponse { idea: Idea }
interface IdeaVoteResponse {
  ideaId: number;
  up: number;
  down: number;
  score: number;
  rank: number;
  viewerVote: IdeaVoteValue;
}
type IdeaPromptResponse = { idea: Idea; openTotal: number } | null;
interface IdeaNoticesReadResponse { markedRead: number }
interface IdeaQueueResponse {
  waiting: Idea[];
  open: Idea[];
  inProgress: Idea[];
  recentDone: Idea[];
  counts: { waiting: number; open: number; inProgress: number; done: number };
}
interface IdeaDecisionResponse {
  status: "ok" | "already_decided" | "conflict";
  idea: Idea;
  noticesSent: number;
}
```

Timestamp fields are UTC strings; new service writes use ISO 8601. Done groups
are UTC Monday weeks (`YYYY-MM-DD`), newest week first. Historical rows carry
`shippedBeforeBoard: true` and an explicit `shippedWeek`. Some historical titles
can exceed 80 characters; new posts always have the 80-character limit.

The board includes only the caller's Waiting and Declined ideas in `yourIdeas`
and only their unread notices. Public board/Done/post/prompt `authorName` is shown
only when the author opted in and the idea is approved; it is null for Waiting
and Declined ideas. Owner queue/decision responses can show the author's name
regardless of that choice. `isOwn` and `viewerVote` describe the requesting viewer;
the owner queue uses a neutral viewer, so those fields are false and zero.

`recentDone` contains the latest 50 Done ideas. `counts.done` counts all Done
ideas, including historical shipped entries. The queue does not list Declined
ideas. There is no pagination or area filter parameter in v1.

## Posting and voting

```ts
interface IdeaPostInput {
  title: string;             // required, nonblank, at most 80 characters
  pitch?: string | null;    // optional, at most 140 characters
  area: IdeaArea;           // exact label from the union above
  showAuthor: boolean;      // required boolean
}
interface IdeaVoteInput { value: IdeaVoteValue }
```

Title and pitch are single lines, measured in Unicode code points before
trimming. Line breaks and NUL are rejected. Text is trimmed; an empty or omitted
pitch becomes null. Additional fields are ignored. JSON endpoints require an
object: arrays, null, malformed JSON, empty bodies and bodies over 16 KiB return
400 `invalid_body`. The vote value must be a JSON number exactly equal to −1, 0
or 1; strings, booleans and other numbers are invalid.

Voting and posting require one completed, seated human duel, completed draft
participation, or completed approved tournament match in this guild. Cancelled
and interrupted duels, replay forks, spectators, byes and unapproved match reports
do not qualify. Owners and Team users still need this activity gate. Reads remain
available before the player qualifies; the board returns the capability flags
and `not_played_yet` reasons.

Players may post at most three ideas in a rolling 24 hours. Declined ideas count
toward the limit. Owners and `ideas_team` permission holders post directly to
Open with `team: true`; everyone else's post starts Waiting. At the limit,
`canPost` is false and `postReason` is `daily_limit`; voting remains available.

A vote on the caller's own idea returns 403 `own_idea`. Voting is available only
while Open; other states return 409 `not_open`. Sending the current nonzero vote
again **clears it**. Sending the opposite vote switches it. Sending zero clears
it and is safe to repeat. Success returns the updated counts, score, ordinal
rank and caller's current vote.

## Prompts and notices

The prompt route returns the newest Open idea the player does not own and has
not voted on, plus the total number of Open ideas. A returned idea atomically
records `users.ideas_prompt_at`, sharing a rolling 24-hour limit across all three
`at` values. Repeated fetches during that window return JSON `null`. Ineligible
players and requests with no eligible idea also return null, without consuming
the prompt window. `at` identifies the display surface; it does not independently
prove completion of that particular game.

The caller's completion eligibility is checked on the server. Call the prompt
only at the appropriate completion UI: a completed player's duel result, draft
finale or closed tournament view. The row must leave existing game actions usable.

Board reads do not mark notices read. After displaying the Notices list, call
`POST /api/ideas/notices/read` without a body. It marks all of that caller's
currently unread notices in the configured guild and returns the number changed.
Repeating it returns `{ "markedRead": 0 }` when there are no new notices.

## Owner decisions

```ts
type IdeaDecisionInput =
  | { action: "approve" | "start" }
  | { action: "decline"; reason: string; line?: string }
  | { action: "done"; note?: string };
```

The allowed transitions are Waiting → Open (`approve`), Waiting → Declined
(`decline`), Open → In progress (`start`), and In progress → Done (`done`). Text
fields are trimmed single lines of at most 140 Unicode code points. Decline
requires a nonblank reason; the optional line is appended as `reason: line`.
Recommended presets are `Already on the board`, `It's a bug, reported for you`,
and `Not for now`; typed reasons are accepted too. An omitted or empty Done note
is saved as null. There is no undo endpoint.

Done atomically creates one notice for the author and every up-voter, deduplicated
per recipient; down-voters are excluded unless they are the author. Decline
notifies only the author. `noticesSent` reports the number of newly inserted
notices. The UI must confirm Done before sending the request.

A successful transition returns 200 with `status: "ok"`. If the idea already has
the action's target state, the route returns 409 `already_decided`. Any other
invalid source state returns 409 `conflict`. Both include the current idea and
`noticesSent: 0`, and perform no new transition or notice writes:

```ts
{
  error: "already_decided" | "conflict";
  status: "already_decided" | "conflict";
  idea: Idea;
  noticesSent: 0;
}
```

## Errors

Expected failures use `ExpectedError` and `errorResponseBody`, returning
`{ "error": code }` unless the owner conflict body above applies. Session errors
preserve `requireWebAccess`'s standard bodies. Unexpected errors are reported
with the application user ID and return 500 `{ "error": "Something went wrong" }`.

| HTTP | Error code | Meaning |
|---|---|---|
| 400 | `invalid_id` | Noncanonical, nonpositive or unsafe idea ID |
| 400 | `invalid_body` | Invalid JSON/object, oversized body, fields or vote value |
| 400 | `invalid_at` | Missing, repeated or unsupported prompt `at` |
| 401 | `unauthorized` | No resolved session |
| 403 | `invalid_origin` | Owner mutation Origin or `WEB_URL` refused |
| 403 | `not_played_yet` | Posting/voting completion gate not satisfied |
| 403 | `own_idea` | Voting on the caller's own idea |
| 404 | `not_found` | Unknown/foreign-guild idea or identified nonowner on an owner route |
| 409 | `not_open` | Voting has not opened or has closed |
| 409 | `already_decided` | Owner action's target state is already current |
| 409 | `conflict` | Owner action is invalid in the current state |
| 429 | `daily_limit` | Three posts already made in the rolling 24-hour window |
| 503 | `session_unavailable` | Session identity resolution is unavailable |
| 503 | `not_configured` | `DISCORD_GUILD_ID` is absent |

Focused transport verification:

```sh
npm run build --workspace=packages/shared
npx vitest run packages/web/tests/ideas-routes.test.ts -c packages/web/vitest.config.ts
npm run typecheck --workspace=packages/web
```
