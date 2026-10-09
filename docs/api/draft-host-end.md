# Emergency draft controls

Backend branch: `feat/draft-host-end`, based on `origin/main` at `bee943a13b41816ef4f3a998e7358cef1e68dc2e`.

## Existing behavior

- Draft status is stored as text in `packages/shared/src/db/schema.ts`; the shared type defines `pending`, `active`, `cancelled`, and `completed`. No migration is needed.
- `createDraftService` already implements transactional cancellation and a private `completeDraft` helper. Completion saves human players' drafted decks through the existing deck service; saving failures are recoverable on later deck reads. Picks and expiry use immediate write transactions and active-status checks.
- Discord `/draft cancel` is creator-only, calls the shared cancellation service, broadcasts a status event, and updates the Discord status message. No emergency end command existed.
- The draft cleanup service manages cached card images; it does not implement draft cancellation or completion.
- Current Compose runs `packages/worker/src/draft-timer.ts`; the bot timer remains available for the shelved bot. Both timer paths now recheck terminal status before expiring a stale active-list candidate.
- The existing web `DELETE /api/drafts/[slug]` cancels live drafts and deletes finished drafts. Its retry semantics are unsuitable for an emergency action. The new UI must use the dedicated endpoints below.
- On fetched main, App Router APIs are in `packages/web/app/api`, not `packages/web/src/app/api`. Main migrated to app-user authentication and removed the Discord access helpers; this branch restores the existing helpers from the original checkout for the requested guild-admin override. Hosts are compared by app `users.id`; admins must have a linked Discord identity.

## HTTP contract

| Action | Method and route | Body | Successful status |
| --- | --- | --- | --- |
| End now | `POST /api/drafts/{slug}/end` | None | `completed` |
| Cancel | `POST /api/drafts/{slug}/cancel` | None | `cancelled` |

Both routes authenticate with the current web session and look up the slug only in configured `DISCORD_GUILD_ID`. The creator is the host, including a host without a linked Discord account. A non-host must pass `checkDiscordWebAccess(discordUserId, "admin")`: guild owner, Administrator, or Manage Server. The admin override also works for a private draft in which the admin is not seated. Discord checks use `DISCORD_TOKEN`, existing 60-second permission caching, in-flight deduplication, request timeouts, and failure/rate-limit backoff.

Production and staging Compose forward optional `DISCORD_TOKEN` to web for this verification. Set it to a bot token able to read the configured guild, then recreate web to load the runtime environment. Host access works without the token; non-host admin verification returns 503 when it is absent. This does not enable Discord announcements; current Compose keeps `DISCORD_BOT_ENABLED=0`.

Success is HTTP 200:

```json
{
  "id": 123,
  "name": "Friday draft",
  "webSlug": "example-slug",
  "status": "completed",
  "changed": true,
  "pickDeadlineAt": null,
  "tournamentId": null
}
```

Cancel returns the same shape with `status: "cancelled"`. A retry of the same terminal action returns 200 and `changed: false`, retaining the draft record and original result. Requesting end for a cancelled draft or cancel for a completed draft returns 409. Notification transport failures do not undo a committed transition or make its HTTP result fail; each parallel notification has a five-second timeout.

| HTTP status | Meaning / JSON body |
| --- | --- |
| 401 | No authenticated session: `{ "error": "unauthorized" }` |
| 403 | Actor is neither host nor verified guild admin: `{ "error": "..." }` |
| 404 | Slug does not exist in the configured guild: `{ "error": "Draft not found" }` |
| 409 | Opposite terminal status: `{ "error": "Draft is already finished", "code": "DRAFT_ALREADY_FINISHED" }` |
| 409 | Live draft has a legacy/manual tournament link: `{ "error": "Draft has a linked tournament", "code": "DRAFT_HAS_TOURNAMENT" }` (cancel only) |
| 503 | Session or Discord admin verification unavailable: `{ "error": "..." }` |
| 500 | Unexpected database/server failure: `{ "error": "Failed to finish draft" }` |

## Live updates and status display

Both endpoints send the existing shared broadcasts `{ kind: "status", slug, status }` and `{ kind: "resync", slug, packRound, pickStep }` after commit. The WS service emits **`draft:status`** to the draft room with **`{ status: "completed" }`** or **`{ status: "cancelled" }`**, plus **`draft:resync`** with **`{ packRound, pickStep }`**. Resync makes existing lobby clients fetch the terminal state immediately. No new WS event type is required. Repeated successful requests resend both events so clients can recover a missed notification. Refetch `GET /api/drafts/{slug}` and stop the local picking/countdown UI.

| Stored status | UI label / behavior |
| --- | --- |
| `pending` | Lobby |
| `active` | Drafting (including theme and Extra rounds) |
| `completed` | Complete; decks and export available |
| `cancelled` | Cancelled; no decks/export or tournament creation |

End preserves each player's exact committed pick history, including uneven or zero picks. It deals no replacement cards and disarms scheduled lobby starts. The existing completed-draft deck and export flows remain in use. Cancel discards picks, passes, dealt cards, packs, undealt/deal data, and theme claims; it retains the draft and roster for room access and cancelled-state display. Both clear the live pick deadline. Timer status guards and bot/manual pick guards reject further work. Cancelled drafts do not enter completed-draft deck/tournament flows or create match/season point awards.

For a channel-backed draft, both actions request the existing Discord `draft-status` update. End also calls the existing deduplicated `draft-completed` announcement flow, honoring guild announcement settings. Discord-disabled deployments use the existing no-op announcer.

## Tournaments

Normal tournament links are created only after a draft is completed. End permits the existing tournament-creation flow from the retained picks; it neither starts nor cancels a tournament. Retrying end on a linked completed draft preserves the tournament and its registered/locked decks. Cancel refuses completed drafts and defensively refuses a live draft with a legacy/manual tournament link. It never deletes tournament participants, matches, results, or season awards.

Early-ended pools may be smaller than normal deck requirements. Existing deck-registration and duel validation still apply; no cards are invented to satisfy those requirements. Owner policy question: should tournament creation be disabled when an early-ended player pool cannot meet the usual deck minimum?

## Validation

Targeted tests cover host/non-host/admin and guild scope; lobby/mid-draft cancellation; uneven, theme and Extra-round completion; retry/conflict behavior; transaction rollback; separate-connection races with manual/bot picks and expiry; terminal/stale-snapshot timer behavior in bot and worker; WS broadcast and Discord announcement calls; existing deck, tournament, pick and cancellation regressions. TypeScript checks run for shared, web, bot, and worker with Node 22.
