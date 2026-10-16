# Active game guard backend contract

## Authentication and scope

Both routes use `requireDuelActor()`: Clerk session resolution → application
`users.id` → `players.user_id` in the configured `DISCORD_GUILD_ID`. Email-only
users work without Discord membership or a Discord ID. Neither route accepts a
client-supplied player or guild ID. Responses are private and must not be cached.

## GET /api/duels/active

No request body or query parameters. Success: HTTP 200, exactly one of:

```json
{ "active": null }
```

```json
{
  "active": {
    "slug": "room-slug",
    "state": "playing",
    "role": "host",
    "format": "1v1"
  }
}
```

- `state`: `"lobby" | "playing"`.
- `role`: `"host" | "guest"`, based on organizer identity, independent of seat
  number (opening choices can swap seats).
- `format`: `"1v1" | "tag" | "ffa3" | "ffa4"`.
- Only a human seat belonging to the authenticated guild player qualifies.
  Spectators, replay forks, and terminal duels do not qualify. A player who has
  surrendered a multiplayer seat does not qualify for that table.
- A room before its opening/game starts is `lobby`. RPS/dice openings, active
  games, and unfinished matches between games or awaiting a later game's start
  are `playing`. The latest game slug remains the destination during sideboarding.
- Includes private, bot, multiplayer, and tournament games. Uses the existing
  tournament visibility policy. Playing games/matches take precedence over
  lobbies, so a newer lobby cannot hide a running game. Within each state, select
  the newest duel by creation time, breaking ties by duel ID. A single small SQL
  query performs the lookup; no engine request,
  board/deck loading, or per-room queries.
- Headers: `Cache-Control: private, no-store`.

## POST /api/duels/[slug]/leave

Reuses the existing route. No request body. Success: HTTP 200:

```ts
{ session: DuelSession }
```

`DuelSession` is exported from `@yugidraft/shared/duels`
(`packages/shared/src/duels/index.ts`) and is the existing session shape returned
by this route. The response has exactly the top-level `session` key.
On host departure, `session.status === "cancelled"`; on guest departure,
`session.status === "lobby"` and `session.seats` no longer contains the guest
(including their submitted deck and ready flag). The host closes the entire
lobby, including rooms with other humans or bots. Committed changes call
`notifyDuelChange(slug, guildId)`, which sends `/internal/duel/changed` to the
WebSocket service for its existing guild-scoped `duel:changed` room invalidation.
Notification failure does not roll back a successful departure.

For an unstarted casual challenge, a guest departure cancels its empty series
and detaches the room from it (`seriesId` and `gameNumber` become `null`). The
room slug, host seat/deck/ready state, settings, `bestOf`, and `ranked` options
remain; a future start creates a new series for the replacement guest.

Only pre-start lobbies qualify. Openings, active/finished games, replay forks,
and later games of an ongoing match are rejected. Tournament seats and match
cancellation remain under the existing tournament organizer controls; this
navigation endpoint does not dissolve tournament matches. Refresh and ordinary
GET requests never call this mutation.

## Errors

Both routes preserve the existing duel authentication/error responses:

- 401 `{ "error": "unauthorized" }` when signed out.
- 503 `{ "error": "session_unavailable" }` when session resolution is unavailable.
- 500 `{ "error": "Guild is not configured" }` for a missing guild configuration.
- Leave: 403 `{ "error": string }` for an unauthorized seat/private room;
  404 `{ "error": "Not found", "code": "ACCESS_DENIED" }` for a missing/hidden duel;
  409 `{ "error": string }` if the room has started or departure violates a
  fixed-seat match policy. A tournament host's cancellation is 403, and a foreign
  guild player passed directly to the shared service is rejected with 400.
  Unexpected failures use the existing duel error body.

## Implementation and verification

1. Add the shared active lookup with real SQLite tests covering lobby, opening,
   playing, terminal, spectator, replay, bot, Tag/FFA, guild isolation, surrendered
   seats, newest selection, and best-of-3 breaks/next-game waiting.
2. Add the thin authenticated GET route and route tests through the real
   application-user/guild-player boundary, including email-only users.
3. Extend lobby departure atomically, preserving existing guest seat controls;
   test host close, guest leave, rejection after start, and WS notification.
4. Build shared, run targeted shared/web/WS tests, and typecheck touched packages.

Verified on Node 22: 270 targeted shared tests (active lookup, seats, duels,
series, access, and schema), 87 web tests (active route, seat/leave routes, and
actor authentication), and 35 existing WebSocket tests (internal broadcast and
duel events). Shared build and shared/web typechecks pass. The lookup test also
asserts one executed statement and indexed seat/seat-loss lookups using SQLite's
query plan. No components, pages, layouts, engine processes, or running services
were changed.
