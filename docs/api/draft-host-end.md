# Emergency draft controls

Backend branch: `feat/draft-host-end`, based on `origin/main` at `bee943a13b41816ef4f3a998e7358cef1e68dc2e`.

## Existing behavior

- Draft status is stored as text in `packages/shared/src/db/schema.ts`; the shared type defines `pending`, `active`, `cancelled`, and `completed`. No migration is needed.
- `createDraftService` already implements transactional cancellation and a private `completeDraft` helper. Completion saves human players' drafted decks through the existing deck service; saving failures are recoverable on later deck reads. Picks and expiry use immediate write transactions and active-status checks.
- Discord `/draft cancel` is creator-only, calls the shared cancellation service, broadcasts a status event, and updates the Discord status message. No emergency end command existed.
- The draft cleanup service manages cached card images; it does not implement draft cancellation or completion.
- Current Compose runs `packages/worker/src/draft-timer.ts`; the bot timer remains available for the shelved bot. Both timer paths now recheck terminal status before expiring a stale active-list candidate.
- The existing web `DELETE /api/drafts/[slug]` cancels live drafts and permanently deletes completed or cancelled drafts. For a live draft, the first DELETE cancels and retains its record and roster; the second DELETE deletes it. Shared terminal errors, including a live draft's linked tournament, return 409 with `{ error, code }`. The new lobby UI must use `POST /cancel` for safe cancellation retries.
- DELETE still has UI callers in `packages/web/app/(app)/draft/[slug]/page.tsx`: `handleCancel` for the lobby and `handleDelete` for the summary's Delete button. After moving lobby cancellation to POST, DELETE remains needed for the summary's Delete button on completed and cancelled drafts.
- App Router APIs are in `packages/web/app/api`. Clerk sessions identify actors by app `users.id`; the accepted alpha access policy has no Discord guild check or admin role. Emergency controls use the existing `isOwnerUser` helper.

## HTTP contract

| Action | Method and route | Body | Successful status |
| --- | --- | --- | --- |
| End now (active only) | `POST /api/drafts/{slug}/end` | None | `completed` |
| Cancel (pending or active) | `POST /api/drafts/{slug}/cancel` | None | `cancelled` |

Both routes authenticate with the current Clerk web session and look up the slug only in configured `DISCORD_GUILD_ID` (the single community id). Only the **host or owner** may act: the host is `draft.created_by_user_id === actor.userId`; the owner passes `isOwnerUser(actor.userId)` using `OWNER_USER_IDS`. Neither needs a linked Discord account, and an owner can act on a private draft without being seated.

For other actors, apply the same `draftReadAccess` check as GET before denying the action: an unreadable private draft returns generic 404; a readable draft returns 403. There is no Discord permission lookup or web `DISCORD_TOKEN` requirement. Current Compose keeps `DISCORD_BOT_ENABLED=0`.

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

Cancel returns the same shape with `status: "cancelled"`. A retry of the same terminal action returns 200 and `changed: false`, retaining the draft record and original result. Requesting end for a cancelled draft or cancel for a completed draft returns 409. Ending a pending lobby returns 409 with `DRAFT_NOT_STARTED` without changing its schedule or state; the lobby UI should offer only Cancel. Notification transport failures do not undo a committed transition or make its HTTP result fail; each parallel notification has a five-second timeout.

| HTTP status | Meaning / JSON body |
| --- | --- |
| 401 | No authenticated session: `{ "error": "unauthorized" }` |
| 403 | Actor can read the draft but is neither host nor owner: `{ "error": "Only the host or owner can end or cancel a draft" }` |
| 404 | Slug is missing, belongs to another community, or actor cannot read the draft: `{ "error": "Draft not found" }` |
| 409 | End requested for a pending draft: `{ "error": "Draft has not started", "code": "DRAFT_NOT_STARTED" }` |
| 409 | Opposite terminal status: `{ "error": "Draft is already finished", "code": "DRAFT_ALREADY_FINISHED" }` |
| 409 | Live draft has a legacy/manual tournament link: `{ "error": "Draft has a linked tournament", "code": "DRAFT_HAS_TOURNAMENT" }` (cancel only) |
| 503 | Session resolution unavailable: `{ "error": "session_unavailable" }` |
| 500 | Unexpected database/server failure: `{ "error": "Failed to finish draft" }` |

## Live updates and status display

Both endpoints send the existing shared broadcasts `{ kind: "status", slug, status }` and `{ kind: "resync", slug, packRound, pickStep }` after commit only when `changed: true`. The WS service emits **`draft:status`** to the draft room with **`{ status: "completed" }`** or **`{ status: "cancelled" }`**, plus **`draft:resync`** with **`{ packRound, pickStep }`**. Resync makes existing lobby clients fetch the terminal state immediately. No new WS event type is required. Repeated successful requests return `changed: false` without sending either event or any Discord notice. Refetch `GET /api/drafts/{slug}` to recover a missed notification and stop the local picking/countdown UI.

| Stored status | UI label / behavior |
| --- | --- |
| `pending` | Lobby |
| `active` | Drafting (including theme and Extra rounds) |
| `completed` | Complete; decks and export available |
| `cancelled` | Cancelled; no decks/export or tournament creation |

End preserves each active draft player's exact committed pick history, including uneven or zero picks. It deals no replacement cards and disarms scheduled lobby starts. The existing completed-draft deck and export flows remain in use. Cancel discards picks, passes, dealt cards, packs, undealt/deal data, and theme claims; it retains the draft and roster for room access and cancelled-state display. Both clear the live pick deadline. Timer status guards and bot/manual pick guards reject further work. Cancelled drafts do not enter completed-draft deck/tournament flows or create match/season point awards.

For a channel-backed draft, both actions request the existing Discord `draft-status` update only when `changed: true`. End also calls the existing deduplicated `draft-completed` announcement flow on that transition, honoring guild announcement settings. Discord-disabled deployments use the existing no-op announcer.

## Tournaments

Normal tournament links are created only after a draft is completed. End permits the existing tournament-creation flow from the retained picks; it neither starts nor cancels a tournament. Retrying end on a linked completed draft preserves the tournament and its registered/locked decks. Cancel refuses completed drafts and defensively refuses a live draft with a legacy/manual tournament link. It never deletes tournament participants, matches, results, or season awards.

Early-ended pools may be smaller than normal deck requirements. Existing deck-registration and duel validation still apply; no cards are invented to satisfy those requirements.

## Validation

Targeted tests cover host/non-host/owner and community scope; private-draft concealment; lobby-end rejection; lobby/mid-draft cancellation; uneven, theme and Extra-round completion; retry/conflict and double-DELETE behavior; linked-tournament cancellation errors; transaction rollback; separate-connection races with manual/bot picks and expiry, including the pick route's bot loop; terminal/stale-snapshot timer behavior in bot and worker; WS broadcast and Discord announcement calls; existing deck, tournament, pick, cancellation and admin-removal regressions. TypeScript checks run for shared, web, bot, and worker with Node 22.
