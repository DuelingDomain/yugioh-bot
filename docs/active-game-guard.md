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
  tournament visibility policy. A single small SQL query selects the newest
  qualifying duel by creation time, breaking ties by duel ID; no engine request,
  board/deck loading, or per-room queries.
- Headers: `Cache-Control: private, no-store`.

## POST /api/duels/[slug]/leave

Reuses the existing route. No request body. Success: HTTP 200:

```ts
{ session: DuelSession }
```

`DuelSession` is the existing shared duel session shape returned by this route.
On host departure, `session.status === "cancelled"`; on guest departure,
`session.status === "lobby"` and `session.seats` no longer contains the guest
(including their submitted deck and ready flag). The host closes the entire
lobby, including rooms with other humans or bots. Committed changes call
`notifyDuelChange(slug, guildId)`, which sends `/internal/duel/changed` to the
WebSocket service for its existing room and lobby invalidations. Notification
failure does not roll back a successful departure.

Only pre-start lobbies qualify. Openings, active/finished games, replay forks,
and later games of an ongoing match are rejected. Existing fixed-seat and
tournament match cancellation policies remain enforced. Refresh and ordinary
GET requests never call this mutation.

## Errors

Both routes preserve the existing duel authentication/error responses:

- 401 `{ "error": "unauthorized" }` when signed out.
- 503 `{ "error": "session_unavailable" }` when session resolution is unavailable.
- 500 `{ "error": "Guild is not configured" }` for a missing guild configuration.
- Leave: 403 `{ "error": string }` for an unauthorized seat/private room;
  404 `{ "error": string, "code": "NOT_FOUND" }` for a missing/hidden duel;
  409 `{ "error": string }` if the room has started or departure violates a
  fixed-seat match policy. Unexpected failures use the existing duel error body.

## Implementation and verification plan

1. Add the shared active lookup with real SQLite tests covering lobby, opening,
   playing, terminal, spectator, replay, bot, Tag/FFA, guild isolation, surrendered
   seats, newest selection, and best-of-3 breaks/next-game waiting.
2. Add the thin authenticated GET route and route tests through the real
   application-user/guild-player boundary, including email-only users.
3. Extend lobby departure atomically, preserving existing guest seat controls;
   test host close, guest leave, rejection after start, and WS notification.
4. Build shared, run targeted shared/web/WS tests, and typecheck touched packages.
