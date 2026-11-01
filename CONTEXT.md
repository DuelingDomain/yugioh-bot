# Dueling Domain

A Yu-Gi-Oh draft, tournament and duel web app. People sign in with Clerk (email/password or Discord). The web app is the lobby, the draft room, the tournament view and the duel table. An optional admin Discord bot helps run the community server. Internal package and code names still use `yugidraft`.

## Language

### People and access

**User**:
One application account, stored in `users`. `users.id` is the application identity. A **User** signs in through Clerk. A linked Discord account (`users.discord_user_id`) is optional.
_Avoid_: Discord user, member (for the account)

**Player**:
The gameplay identity of a **User** in the **Community**, stored in `players` and linked by `players.user_id`. Match history, ratings and seats use the player ID.

**Community**:
The one configured server scope, `DISCORD_GUILD_ID`. Every server-data read is scoped to it (`guild_id` columns). It is a scope ID, not a Discord membership check: Discord membership does not grant access.
_Avoid_: guild (in user-facing text)

**Owner**:
A **User** whose `users.id` is in `OWNER_USER_IDS`. Only owners can open `/admin`, decide **Waitlist** entries and use owner-only tools such as replay **Fork**. There is no other admin role on the site.
_Avoid_: admin (for site roles)

**Waitlist**:
The Clerk waitlist for alpha access. Anyone can join it through `POST /api/waitlist`. An **Owner** approves or rejects an entry in `/admin` or with the bot; approval sends a Clerk invitation.

**Creator**:
A content creator we give instant alpha access to, stored in `creators`. Only an **Owner** makes one, in `/admin` > Creators. Not to be confused with the person who made a draft, tournament or **Cube**.
_Avoid_: influencer, partner

**Creator link**:
A `/join/<code>` URL of a **Creator** (`creator_links`) with a fixed number of uses and an expiry. Personal = 1 use locked to the creator's email; Friends = 3 uses; Community = many uses; Custom = an owner-chosen number of uses with an optional email lock. An **Email lock** limits claims to one inbox and requires a single-use link. The owner can revoke it. Distinct from a tournament **Invite link**.

**Grant**:
One email that may join now because of a **Creator** (`creator_grants`), made by a **Creator link** or by an owner allowlist email. It sends one Clerk invitation and, after sign-up, records which **Creator** brought the **User** (`users.creator_id`).

**Heard from**:
The optional "How did you hear about us?" answer (`waitlist_signups.heard_from`, `users.heard_from`). Survey data only; it never grants access.

**Bug report**:
A report a signed-in **User** sends with the Report bug button. It is stored in `bug_reports` with diagnostics and opens a public GitHub issue when `BUG_REPORT_GITHUB_TOKEN` is set. Humans triage it with the labels in `docs/agents/triage-labels.md`.

### Drafts

**Host stop / Cancelled draft**:
Under the owner rule of 2026-10-09, a host stop cancels the whole draft: null and void. Players must do a new draft. Cancel discards every pick and gives no decks, exports or tournament. There is no End now action to keep picks. See `docs/api/draft-host-end.md` for the API and the unchanged automatic pool-exhaustion paths.

**Cube**:
A reusable draft configuration and card pool. It is private to the **User** who made it, in the **Community**. Stored in `cubes` with optional explicit `cube_cards` entries split into `main` / `extra` pools and per-card `max_copies`. Supplies shared booster-style drafts or a player's private pool in a **Theme draft**.
_Avoid_: Theme (for the saved resource)

**Theme draft**:
A draft with `DraftConfig.mode === "theme"` where each player picks privately from an assigned **Cube**. `allowedCubeIds` lists available cubes; `draft_player_cube` stores player assignments. The mode and UI still use "theme"; the saved resource is a **Cube**.

### Tournaments

**Tournament**:
A bracketed competition between players, with one of a fixed set of **Formats** (currently Round Robin or Single Elimination). Belongs to the **Community**.
_Avoid_: Event, competition

**Organizer**:
The **User** who created a **Tournament**. Stored as `created_by_user_id`. Has rights to start, cancel, and manage it. May also be a **Participant** (default), but can leave the participant list if hosting only.
_Avoid_: Creator, host, admin

**Participant**:
A player registered to play in a **Tournament**. Stored in `tournament_participants`. Distinct from **Organizer** — an organizer is a participant by default but can opt out.
_Avoid_: Player (reserved for the broader `players` table identity), entrant, competitor

**Format**:
The bracket structure of a **Tournament**. Currently `round_robin` or `single_elim`. Determines how matches are generated when the tournament starts.

**Pending / Active / Completed / Cancelled**:
A **Tournament**'s lifecycle status. `pending` = accepting participants; `active` = bracket generated, matches in progress; `completed` = final match resolved; `cancelled` = aborted by organizer.

**Invite link**:
A shareable URL based on the tournament's `web_slug` (e.g., `/tournament/abcd1234`). Under the web access policy documented in `CLAUDE.md`, any signed-in **User** can join while the tournament is **pending**. Not rotatable — if leaked, cancel and recreate.

**Kick**:
The **Organizer**'s removal of a **Participant** from a **pending** Tournament. Distinct from **Leave**, which is participant-initiated.

**Leave**:
A **Participant**'s self-removal from a **pending** Tournament. Available to all participants, including the **Organizer**.

### Duels

**Table**:
One automated duel room, from lobby to result, with a web slug. Hosted by the private duel host and stored in the duel tables of SQLite. Players or bots take its **Seats**; other signed-in **Users** may spectate public tables.
_Avoid_: Game, room (in code and docs)

**Seat**:
One duelist position at a **Table**, numbered from 0 in turn order. A seat holds a human or a practice bot. In Tag, seat % 2 is the team (seats 0 and 2 against 1 and 3).

**Table format**:
The seat layout of a **Table**: `1v1` (default), `tag` (2v2, shared team LP), `ffa3` or `ffa4` (free-for-all, one LP each). Chosen at creation and fixed. Distinct from a tournament **Format**. The rules are in `docs/adr/0002-multiplayer-duel-rules.md`.

**Standard / Domain**:
The two duel modes. **Standard** uses stock rules with a Master Rule preset. **Domain** adds the Domain Format mechanics, a **Deck Master** and its own deck rules. Both work at every **Table format**.

**Genesys**:
A points format that sits on top of a mode. Each card has points; a deck must stay at or below the point cap (default 100). Genesys + Standard shows as **Genesys**, Genesys + Domain as **Genesys Domain**. Genesys forces the banlist off. The worker syncs the points list. Contract: `docs/api/genesys-contract.md`.

**Deck Master**:
A Domain-only monster in its own zone, set apart from the Main Deck. It can be recalled and summoned again, with a surcharge. Standard tables have none.

**Preset**:
A scripted starting board for hand scenarios and e2e runs (`packages/duel-server/src/presets/`). The `list-presets` and `start-preset` host operations exist only when `DUEL_SCENARIOS=1`. Not a Master Rule preset.

**Engine**:
The wasm core that runs a **Table**. Compose defaults Standard 1v1 to the **pinned** merged engine (`DUEL_STANDARD_1V1_ENGINE=pinned`) and Domain 1v1 to **legacy** (`DUEL_1V1_ENGINE=legacy`). Native runs with no Standard override use the global choice, which defaults to legacy. Each game of a series reads the switch at its start. A 1v1 game saves its engine, so recover and replay use it after either switch changes. Tag and FFA tables always use a **multi core** (`ocgcore.multi.wasm`, or `ocgcore.multi-domain.wasm` for Domain). See `docs/deployment/duel-engine-switch.md`.

**Replay**:
A move-by-move rebuild of a finished duel from its seed and accepted-input journal. It never changes the duel. If the engine resources changed since the game, the replay is checked against the saved final boards first; a failed check returns `REPLAY_UNVERIFIED`. Spec: `docs/specs/2026-10-10-replay-fork.md`.

**Fork**:
A new private duel (`kind: "replay-fork"`) that copies a **Replay**'s journal up to a chosen point ("Jump in here"), so an **Owner** can play on from there as all seats. The source duel stays unchanged. A fork never counts for stats, series or tournaments.

### Notifications

**Announcement**:
A Discord message about a **Draft** or **Tournament** event. Removed: the bot's announce server is gone (ADR 0006) and web and worker run with `DISCORD_BOT_ENABLED=0`, so no announcement is sent and the announce API returns 404 `discord_disabled`. Keep the term for old code and records.
_Avoid_: notification (reserved — see **Broadcast**)

**Discord outbox**:
Durable Discord posts and edits (waitlist alerts, decision edits, moderation logs) stored in `discord_outbox`. Web and the bot write rows; only the bot's poller sends them.

**Broadcast**:
A real-time state push to the WebSocket server (relayed to browser clients in a **Draft**, **Tournament**, or **Duel** room) about a state change — a pick, resync, seat update, status, completion, or duel invalidation. HTTP/network failures are swallowed (some callers await delivery); no user-visible Discord message. Distinct from an **Announcement**.
_Avoid_: announcement, event

## Relationships

- A **Tournament** has exactly one **Organizer**.
- A **Tournament** has zero or more **Participants**. By default, the **Organizer** is auto-joined as a **Participant** at create time.
- An **Organizer** may **Leave** the participant list (becoming a non-playing host) while the **Tournament** is **pending**.
- Any **Participant** may **Leave** a **pending** **Tournament**; the **Organizer** may **Kick** any other **Participant**.
- A **Tournament** can only start when it has at least 2 **Participants**; the Start affordance is disabled below that threshold.

## Flagged ambiguities

- "Player" was used informally to mean both the broader `players` table row (the gameplay identity of a **User**) and a **Participant** in a tournament — resolved: **Player** = `players` row; **Participant** = `tournament_participants` row referencing a player in the context of one tournament.
