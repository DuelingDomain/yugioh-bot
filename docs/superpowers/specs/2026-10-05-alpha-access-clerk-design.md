# Alpha access: Clerk, application users, and a standalone worker

Owner decisions: **2026-10-05, amended 2026-10-06** for marketing-hosted legal pages, retained community functionality, Q43 = A, custom Clerk auth flows and the sign-in shell/rename before PR 2. Authority: [ADR 0004](../../adr/0004-alpha-access-clerk.md).
This replaces the Open-mode/invite-table/player-key design, including its uncommitted S1 implementation.
Ship identity and scheduling first on NextAuth, switch authentication at the domain cutover, then ship the inbox.
This document specifies future implementation; this rewrite changes documentation only.

References describe the inspected checkout, including S1; line numbers are pre-implementation.
Path abbreviations: **S** = `packages/shared/src`, **W** = `packages/web`, **B** = `packages/bot/src`, **X** = `packages/ws/src`, **E** = `packages/e2e`.
The prior `s0-result.md` and `bot-inventory.md` were checked against code; their recommendations to retain player keys, web Discord credentials, or a bot worker mode are superseded.
Marketing sources were inspected read-only in the sibling `/home/imran/orca/workspaces/yugioh-discord-bot/marketing` checkout, including PR #193's `site/public/privacy.html`; merge marketing before changing its waitlist route or cutover document. The marketing session supplies terms, concept A's reusable sign-in shell on today's NextAuth login page and committed step markup/shots, plus a separate whole-app rename PR. Marketing PR #193, the sign-in shell PR and the rename PR all merge before PR 2, which rebases on them.

## What stays

All community functionality stays in the app:

- Draft night, cube drafts (booster and theme mode), cubes and the cube editor.
- Tournaments: creation, registration, decks, brackets, reporting/approval and deadlines.
- Domain format and all duel game modes (1v1, Tag, FFA3/FFA4), including casual and practice play; saved decks.
- Seasons, current Elo ratings, point awards, standings and achievements, leaderboards, and bug reports.

The worker keeps draft and tournament timers running, including pick expiry, report approval and deadlines; duel-server keeps its own timers. Removing the Discord bot and Discord I/O does not remove these app features or their history. Discord OAuth remains a sign-in option.
The only dropped features are four bot-only extras: external `/duel` reporting, seeding other players at event creation, role-ping signup posts, and draft-config templates. Existing in-app match-history rules stay unchanged: ranked series and tournaments record results; unranked casual series and practice-bot series stay **UNRECORDED** (Q43 = A, owner 2026-10-06; `S/services/duel-series.ts:675`). This decision is closed, with no follow-up PR.

## Decisions

| # | Final decision |
|---|---|
| 1 | Clerk replaces Auth.js. `sign_up_mode=waitlist`; approve in Clerk's dashboard. A valid signed-in session grants access. No guild-membership gate or application invite table. |
| 2 | Keep marketing `waitlist_signups` and `createWaitlistService.join`. After marketing merges, `/api/waitlist` also calls server-side `waitlistEntries.create({ emailAddress, notify: true })`. Clerk sends confirmation and invitation emails using our custom wording in the Pro workspace. |
| 3 | Discord OAuth with custom credentials, or email/password with email verification code. Concept A “Sealed pack”: form column left, pack right, pack above the form on phone; an identifier-first single card swaps steps in place. Marketing lands the reusable shell on NextAuth before PR 2; PR 2 reuses it with Clerk v7 hooks, committed step markup and a pack-tear success frame. The card wall, ring and YGOPRODeck art are deleted by the shell PR. No prebuilt `<SignIn/>`/`<SignUp/>` or deprecated Clerk Elements. Username required; passwordless sign-in and passkeys disabled. Session lifetime 30 days. No webhook in v1: sync on a request when missing/older than five minutes, and force sync after linking. |
| 4 | Removal is a Clerk dashboard ban; no application block flag. |
| 5 | No app admin role. Creators manage drafts, tournaments and cubes. Remove Discord guild settings UI/writes. VM owner script starts/ends the single season; another script handles account conflicts. |
| 6 | `users.id` is identity. Link players with `user_id`; rebuild the five creator/owner columns as integer FKs. Draft tokens/events use user IDs; duel tokens retain player IDs. |
| 7 | One community. Keep the existing `DISCORD_GUILD_ID` value and `guild_id` scoping. Do not introduce `COMMUNITY_ID`; it adds configuration without changing behavior. |
| 8 | `/settings/account` may retain Clerk's prebuilt `<UserProfile/>`, themed with our tokens, for connected accounts/linking; verified-email auto-linking is also supported. Attach a Discord-only row using the history rules below; two histories require an owner merge. |
| 9 | PR 1 imports existing players and captures verified Discord emails on each NextAuth sign-in. Cutover script pre-creates Clerk accounts for verified-email users; verify Discord auto-linking in development, with email-code password reset as fallback. Members without email use the waitlist, then recover history through Discord. Owner announces manually. |
| 10 | New `packages/worker` owns draft/tournament timers, set sync and image eviction from PR 1. Bot retains Discord features in PR 1, then leaves Compose at cutover and remains buildable/tested behind `DISCORD_BOT_ENABLED=0`. Discord notification cleanup/reminders stay shelved. SQLite state supplies due work; no job queue. |
| 11 | Drop only the four bot-only extras: external `/duel` reporting, seeding other players at event creation, role-ping signup posts and draft-config templates. Preserve all in-app community functionality and existing result recording. **Q43 = A (owner, 2026-10-06):** unranked casual series and practice-bot series stay UNRECORDED in match history; ranked series and tournaments keep recording. Closed; no follow-up PR. |
| 12 | With the bot off, hide Discord channel pickers, Discord Announce controls, announcement toggles and Discord command hints; channels become optional and web-to-bot calls are skipped. In-app creation, registration and play remain available. Challenger gets “Copy the link”; challenged player gets inbox/live delivery in PR 3. |
| 13 | PR 3 adds an inbox after a workshop-page design pass and render review: shell bell/unread count, dropdown or `/inbox`, mark-read, existing WS transport, six triggers, 30-day retention, no email. |
| 14 | Marketing hosts the single privacy policy at `https://duelingdomain.com/privacy` (PR #193, `site/public/privacy.html`) and terms at `https://duelingdomain.com/terms` (marketing session). App footer/account area and Clerk legal-consent checkbox link there; no app `/privacy` or `/terms` pages/public paths. PR 2 extends that privacy page for Clerk waitlist entries, users/email capture and imports; PR 3 extends it for inbox retention. Coordinate wording with marketing. |
| 15 | Whole-app rename to Dueling Domain is being done now by the marketing session in its own PR, at the owner's request; it merges **before PR 2**, as do marketing PR #193 and the separate sign-in shell PR. Rename scope includes app metadata, shell branding, duel header/room files, match-sheet CSS, YDK export, `PRODUCT.md` and tests, excluding `app/(auth)/login/*`, which the sign-in shell PR handles first. PR 2 rebases on all three and also edits sidebar/mobile-drawer/shell-model to remove admin/Discord/guild-settings entries while preserving community navigation and account settings. |
| 16 | PR 1: users/identity/import/email capture/worker, still NextAuth and functioning bot. PR 2: custom Clerk auth/domain cutover after marketing PR #193, the sign-in shell and rename; reuse the shell, build Clerk steps/error mapping and pack-tear success, bot off/Discord controls hidden, waitlist bridge, import/linking scripts, marketing privacy extensions/legal links, admin-role removal and docs. Custom auth increases PR 2's size and is its larger risk area. PR 3: inbox. Each gets one review, one fix pass, one re-review; unresolved blockers stop shipment. |
| 17 | Codex implements the work. After owner CLI login, configure the Clerk dev instance with `clerk apps create`, `clerk config patch`, `clerk env pull`; approvals remain in the dashboard. |

## Out of scope (next designs)

- **Multiple Elo ladders.** Today one Elo is tied to drafts/cubes/tournaments. The owner wants separate ladders later (e.g. against friends, private tournaments) plus a proper ranked ladder. A separate design session must decide which ladders, which games feed which, and seasons per ladder; this work's `users` table is the base.
- **Multi-tenancy.** This work keeps one community.
- **Re-enabling the Discord bot.** The bot stays shelved after cutover.

## Data model and migration

### Choice and invariants

Rebuild `players`, `tournaments`, `cubes`, `drafts`, `seasons`, and `saved_decks` in PR 1.
Keep existing owner-column names, replacing their text values with integer `users.id` references.
This avoids five pairs of competing identity columns and required legacy text fields (`S/db/schema.ts:46,100,133,446,629`).
The draft rebuild also makes `channel_id` nullable; PR 1 still supplies channels while its Discord UI remains active.
Every existing `players.id` and every gameplay FK stays unchanged. Only user identity/ownership is translated.
`players.discord_user_id` becomes a nullable compatibility field, with its existing per-guild uniqueness retained; `users.discord_user_id` is the unique canonical Discord identity.
PR 1 bot adapters keep that compatibility field synchronized transactionally. Email-only players have NULL, never `clerk:*`.
User email is lowercased and nullable, deliberately not unique: import duplicate emails must be reported, not silently merge histories.
`synced_at` is nullable until a successful Clerk profile sync; services maintain `updated_at`.

### Exact target SQL

Create the six replacement tables under their `_identity_new` names exactly as below; the ordered migration renames them to their base names.
Unchanged columns/defaults come from the current schema plus its later `addColumnIfMissing` calls.

```sql
create table if not exists users (
  id integer primary key autoincrement,
  clerk_user_id text unique,
  email text check (email is null or email = lower(trim(email))),
  email_verified integer not null default 0 check (email_verified in (0, 1)),
  username text not null,
  display_name text not null,
  discord_user_id text unique,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  synced_at text,
  check (email_verified = 0 or email is not null)
);
create index if not exists users_email_idx on users(email) where email is not null;

create table players_identity_new (
  id integer primary key autoincrement,
  guild_id text not null,
  user_id integer not null references users(id),
  discord_user_id text,
  display_name text not null,
  created_at text not null default current_timestamp,
  unique (guild_id, user_id),
  unique (guild_id, discord_user_id)
);
create table tournaments_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, format text not null, status text not null,
  created_by_user_id integer not null references users(id),
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, completed_announced_at text, deadline_at text,
  report_confirm_window_hours integer, best_of integer not null default 3, duel_rules_json text
);
create table cubes_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, archetype text, banlist text,
  config_json text not null default '{}',
  created_by_user_id integer not null references users(id),
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  unique (guild_id, name)
);
create table drafts_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, channel_id text, name text not null, status text not null,
  created_by_user_id integer not null references users(id),
  config_json text not null default '{}',
  current_wave_number integer not null default 0, current_pick_step integer not null default 0,
  pick_deadline_at text, status_message_id text,
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, tournament_id integer references tournaments(id), complete_message_id text
);
create table seasons_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, number integer not null, name text, status text not null,
  started_at text not null default current_timestamp, ended_at text,
  created_by_user_id integer references users(id)
);
create table saved_decks_identity_new (
  id integer primary key autoincrement,
  guild_id text not null,
  owner_user_id integer not null references users(id),
  name text not null, mode text not null, deck_json text not null,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  draft_id integer references drafts(id) on delete set null
);
```

After renaming, recreate these indexes; table-declared UNIQUE constraints recreate their own indexes:

```sql
create index if not exists players_user_idx on players(user_id);
create unique index if not exists tournaments_current_name_unique
  on tournaments(guild_id, name) where status in ('pending', 'active');
create unique index if not exists tournaments_web_slug_unique
  on tournaments(web_slug) where web_slug is not null;
create index if not exists tournaments_creator_idx on tournaments(created_by_user_id);
create index if not exists cubes_creator_idx on cubes(created_by_user_id);
create unique index if not exists drafts_current_name_unique
  on drafts(guild_id, name) where status in ('pending', 'active');
create index if not exists drafts_creator_idx on drafts(created_by_user_id);
create unique index if not exists seasons_one_active on seasons(guild_id) where status = 'active';
create index if not exists seasons_creator_idx on seasons(created_by_user_id);
create index if not exists saved_decks_owner_list_idx on saved_decks(guild_id, owner_user_id, updated_at);
create unique index if not exists saved_decks_owner_draft_idx
  on saved_decks(guild_id, owner_user_id, draft_id) where draft_id is not null;
```

### Ordered, idempotent `migrate()` procedure

1. Run existing historical migrations to converge old DB versions, then the new identity block near the end of `S/db/schema.ts`. Remove S1's table-creation block at `:756`. Do not put network calls in migrations.
2. Detect completion using `PRAGMA table_info`: `players.user_id` exists/non-null and all five owner columns have INTEGER type. All-new means skip import/rebuild; all-old means migrate; a partial shape aborts. Recheck inside the write lock. Re-running must not recreate users deleted by a later fold.
3. Preflight row counts, FK violations, distinct guild values, legacy actor keys and S1 tables. Preserve other guild rows if present; do not rewrite guild IDs or expose them in the single-community app. Unexpected columns/indexes/triggers require explicit preservation rather than silent loss.
4. Save `foreign_keys` state and six `sqlite_sequence` high-water marks. Outside any transaction, set `foreign_keys=OFF`, then `BEGIN IMMEDIATE`. Follow create/copy/drop/rename at `schema.ts:259` (not rename-old-table-first, which can retarget child FKs). On failure roll back; always restore the pragma in `finally`. `openDatabase` explicitly enables FKs for normal operation (`S/db/connection.ts:6`).
5. Create `users` and the replacement tables. Build a temporary mapping for every player Discord key and every non-null owner key, allocating in deterministic key order. Each real Discord ID creates/reuses one user across guilds; select the earliest player's name/date deterministically. A creator who never played still gets a user. NULL season creators stay NULL.
6. Existing test players use `bot_player_dev_` (`S/services/draft-decks.ts:22`); give each legacy key its own non-login user with NULL canonical Discord ID, preserving the legacy player key for test-bot detection. Known seed/system owner keys likewise get non-login users. Reject unknown synthetic formats (especially `clerk:*`) for explicit reconciliation. Never claim those strings are Discord accounts.
7. Imported users start with NULL Clerk ID/email/sync time, `email_verified=0`; derive a lowercase sanitized username from display name, append a deterministic ID suffix, and use `duelist_<id>` if empty. Keep it stable in PR 1; Clerk import revalidates/deduplicates. Creating a row does not grant authentication.
8. Populate the temporary map during allocation, then execute the exact copies below. Scalar lookups fail NOT NULL constraints if a required key was missed. Preserve every JSON, timestamp, slug and player ID.

```sql
create temp table identity_key_map (legacy_key text primary key, user_id integer not null);
-- For each allocated/reused user, bind the original key and users.id:
insert into identity_key_map(legacy_key, user_id) values (:legacy_key, :user_id);
insert into players_identity_new
  select id, guild_id, (select user_id from identity_key_map where legacy_key = p.discord_user_id),
    discord_user_id, display_name, created_at from players p;
insert into tournaments_identity_new
  select id, guild_id, name, format, status,
    (select user_id from identity_key_map where legacy_key = t.created_by_user_id),
    created_at, started_at, ended_at, web_slug, completed_announced_at, deadline_at,
    report_confirm_window_hours, best_of, duel_rules_json from tournaments t;
insert into cubes_identity_new
  select id, guild_id, name, archetype, banlist, config_json,
    (select user_id from identity_key_map where legacy_key = c.created_by_user_id),
    created_at, updated_at from cubes c;
insert into drafts_identity_new
  select id, guild_id, channel_id, name, status,
    (select user_id from identity_key_map where legacy_key = d.created_by_user_id),
    config_json, current_wave_number, current_pick_step, pick_deadline_at, status_message_id,
    created_at, started_at, ended_at, web_slug, tournament_id, complete_message_id from drafts d;
insert into seasons_identity_new
  select id, guild_id, number, name, status, started_at, ended_at,
    (select user_id from identity_key_map where legacy_key = s.created_by_user_id) from seasons s;
insert into saved_decks_identity_new
  select id, guild_id, (select user_id from identity_key_map where legacy_key = s.owner_user_id),
    name, mode, deck_json, created_at, updated_at, draft_id from saved_decks s;
```

9. Validate counts/mappings; for each of the six fixed names execute `DROP TABLE <base>; ALTER TABLE <base>_identity_new RENAME TO <base>;`. Recreate indexes, restore sequence values at least as high as before, drop the map, and require empty `PRAGMA foreign_key_check` and successful integrity checks before commit. Check restored FK enforcement after commit. Disable cascades while replacing parents.
10. Make recurring draft-deck backfill `schema.ts:709` schema-aware: old DBs use the old Discord join before conversion; converted DBs join `s.owner_user_id = p.user_id`. Never run the old comparison against new integer IDs on later startups. Tests cover repeat migration, concurrent starters and failure rollback.
11. Deploy migration once with all writers stopped; startup still calls the same idempotent `migrate()`. PR 1 deploys all consumers together. Application IDs must never be interpreted as Discord snowflakes by old code.

### S1 disposition and later tables

| S1 artifact | Required disposition |
|---|---|
| `app_users`, `services/app-users.ts`, tests | Replace with `users` and `services/users.ts`; adapt normalization, five-minute `needsSync`, transactional uniqueness and history-query ideas. Rewrite tests for stable IDs. Delete `player_key`, rekeying, `blocked_at`, block/unblock and snowflake-as-identity helpers. This is not a blind SQL rename. |
| `alpha_invites`, `services/alpha-invites.ts`, tests | Delete definitions/service/exports/tests; Clerk owns waitlist approval/invitation. |
| `services/alpha-access.ts` | Delete invite/guild/block policy and its exports/tests. Session validity is the gate. |
| `access_events`, `services/access-events.ts` | Delete superseded schema/service/exports; no admin audit page. Owner migration/merge scripts produce protected operation reports. |

Inside `migrate()`, drop S1 tables only after verifying emptiness: `DROP TABLE IF EXISTS alpha_invites; DROP TABLE IF EXISTS access_events; DROP TABLE IF EXISTS app_users;`.
If any has data, abort before mutation and retain a backup for explicit reconciliation; an unshipped design does not authorize discarding identity/history. No production rollout assumes S1 shipped.

Marketing retains its table verbatim, with lowercasing in `createWaitlistService.join`:

```sql
create table if not exists waitlist_signups (
  id integer primary key autoincrement, email text not null unique,
  created_at text not null, source text not null, user_agent text
);
```

PR 3 adds this inbox table/indexes inside `migrate()`; `event_key` identifies a transition, including its round/reopen generation where appropriate:

```sql
create table if not exists notifications (
  id integer primary key autoincrement,
  user_id integer not null references users(id),
  kind text not null check (kind in ('duel_challenge', 'match_ready', 'result_approval',
    'tournament_started', 'draft_started', 'draft_finished')),
  event_key text not null, payload_json text not null,
  created_at text not null default current_timestamp, read_at text,
  unique (user_id, event_key)
);
create index if not exists notifications_user_created_idx on notifications(user_id, created_at, id);
create index if not exists notifications_unread_idx on notifications(user_id, id) where read_at is null;
create index if not exists notifications_retention_idx on notifications(created_at);
```

## Identity resolution

### PR 1: NextAuth to users

NextAuth retains Discord login and the existing membership policy until cutover.
After successful membership verification, transactionally ensure `users(discord_user_id)` and capture lowercased `profile.email`, verified only when `profile.verified === true` (`W/src/lib/auth.ts:99`). Clear stale verified status if the current provider profile no longer verifies that address; never infer verification from `user.email` alone.
Existing JWTs containing `token.discordId` lazily resolve to the imported user; `token.sub` is not an application ID. Retain Discord ID separately for PR 1 membership/admin calls.
`auth()` preserves `{ user: { id, name, email, image }, expires }` where possible, but **`session.user.id = String(users.id)`** from PR 1 onward (`auth.ts:113`). Add explicit `discordUserId` for transitional Discord checks; `/api/auth/session` reports the application ID.
Convert that canonical positive decimal string once at the server boundary. `requireWebAccess().userId`, shared owner arguments/results and WS identity claims are integer user IDs; raw SQL ownership comparisons use integers too. Never use coercive equality or feed a session ID to a Discord API.
`createPlayerService.findOrCreate/findByGuildAndUser` now resolve `(guild_id, user_id)` and return `Player.userId`; retain an explicitly named Discord adapter for bot ingress. Player/user creation is one immediate transaction/upsert.
Update SQL/DTOs across routes/pages, saved decks, tournament registration, draft access/decks and bug-report actor lookup. Gameplay IDs, seats and `themeAssignments` remain player IDs.
Bot repository `upsert` (`B/repositories/players.ts:21`) ensures the user before players; command/modals creating events without a participant also ensure the creator (`B/commands/handlers.ts:474`, `B/interactions/modals.ts:124`). Creator checks resolve `interaction.user.id` to `users.id`; mentions/DMs still use Discord IDs.
Test-bot factories/seeds also create users; make bot detection null-safe so an email-only human is never classified as a bot.
Draft claims change `userId` to a positive integer with a new signature domain/version; reconnect/reissue at PR 1 deployment (`S/ws/draft-token.ts:3`, `X/events.ts:122`, `S/services/draft-access.ts:8`). Duel claims retain `players.id` (`S/ws/duel-token.ts:8`).

### PR 2: Clerk to users

`proxy.ts` uses `clerkMiddleware`; server `auth()` becomes a compatibility wrapper around one session-identity resolver.
Verify the Clerk session each request, find `users.clerk_user_id`, and fetch the authoritative Clerk user only when missing, `synced_at` is NULL/invalid/older than five minutes, or a link/profile change forces refresh. Deduplicate in-flight fetches per Clerk ID.
Copy username/display name, primary email and verification state, and the `oauth_discord` external account's provider user ID. Missing Discord is valid. Normalize email; use only verified email for import matching. Advance `synced_at` only after successful sync; a cached profile never proves session validity.
Resolve imports by stored Clerk ID first; server-set `externalId` is a reconciliation hint that must agree with local ownership. Never merge local rows merely because emails match; Clerk authenticates verified-email linking and the algorithm below resolves Discord history.
Force server refresh after `<UserProfile/>` OAuth return, external-account changes and account-page focus/return. Clients request refresh, never supply trusted Discord/email values. Missing/stale profile fetch failure returns retryable 503; invalid session returns 401. Fresh profiles need no Backend API call.
Clerk ban invalidates sessions; there is no local block flag/exception. Existing HMAC subscriptions expire under their own TTLs, so this does not promise instantaneous socket revocation. No webhook endpoint is added.

### Linking and owner merge

Fetch outside SQLite; re-read identities/history under `BEGIN IMMEDIATE` before applying local changes. Never change a history-bearing player ID during automatic attachment.

```text
resolve(clerkProfile):
  A = user by clerk_user_id, or a new user with no accepted Discord link
  D = verified OAuth Discord provider ID, if any
  B = user by discord_user_id D
  if D absent: clear A's accepted Discord compatibility fields; preserve history; return A
  if B absent or B == A: attach D to A and its players; return A
  if B.clerk_user_id is non-null: refuse automatic attachment; return A + conflict
  if !hasHistory(A):
    delete A's empty players; clear A.clerk_user_id; delete empty A
    put Clerk ID/profile on B; retain B's Discord ID and players; return B
  if !hasHistory(B):
    delete B's empty players; clear B.discord_user_id; delete empty B
    attach D to A and its players; return A
  return A + conflict without modifying B or transferring any history
```

If both are empty, preserve imported B. “Empty” requires zero ownership/history references, not merely no matches.
Conflict message: “Both accounts have activity. Your history has not been merged. Contact the owner.” Keep A signed in without access to B's resources. Clerk's profile flow may already have linked OAuth: refusing local attachment does not undo that external link. Offer unlinking there; never silently remove the only login method.
After a fold, resolve the request/session to the survivor, invalidate identity caches and reissue draft/inbox tokens. Reconcile Clerk `externalId` to the survivor outside the transaction with retry; Clerk-ID lookup remains authoritative if that call fails.
VM merge script defaults to dry-run, records both identities/affected rows, and requires explicit source/target IDs for apply. Stop writes/revoke affected sessions before apply. Resolve same-community player collisions and owner/registered-deck conflicts explicitly, transfer all references below, preserve an audit report and run FK checks. No automatic two-history merge.

History includes all owned tournaments/cubes/drafts/seasons/saved decks, PR 3 notifications, and any row referencing any of the user's players:

| Player reference tables | Columns / evidence in `S/db/schema.ts` |
|---|---|
| `tournament_participants`, `draft_player_cube`, `draft_players` | `player_id` (`:54`, `:117`, `:146`); count pending participation too. |
| `matches` | `player_one_id`, `player_two_id`, `winner_id`, `reporter_id`, `approver_id` (`:226`). |
| `tournament_matches` | `player_one_id`, `player_two_id` (`:242`); preserve `metadata_json.winnerId` during manual merges. |
| `player_ratings`, `point_awards`, `season_standings`, `player_achievements` | `player_id` (`:454`, `:465`, `:485`, `:496`); derived records count. |
| `duels`, `duel_seats`, `duel_invite_grants` | Organizer/winner IDs (`:523`, `:533`), `player_id` (`:544`, `:610`). |
| `duel_series` | `player0_id`, `player1_id`, `winner_player_id`, `created_by_player_id` (`:649`, `:654`, `:667`). |
| `bug_reports` | `player_id` (`:739`). |
| Indirect draft references | `draft_cards.picked_by_player_id`, `draft_picks.player_id`, `draft_passes.player_id` reference `draft_players` (`:175`, `:204`, `:219`); manual merge also reviews `config_json.themeAssignments` and player-bearing snapshots. |

## Access and ownership after admin removal

PR 1 retains authorization through explicit Discord adapters; PR 2 removes the admin-role checks and Discord guild-settings controls below. Creator-managed community features remain in the app; season management moves to the VM owner script while season data and reads remain.
All resources remain scoped to the configured community. Signed-in access preserves creator, participant, seat, invite-grant and saved-deck ownership checks.

| Existing check / surface | PR 2 replacement |
|---|---|
| `W/src/lib/discord-web-access.ts:5,17`, `web-access.ts:5,10` | Delete member/admin dispatch; require valid session/resolved user. Delete Discord admin/membership verifiers and old policy tests. |
| `W/src/lib/auth.ts:102,140`, `duel-host.ts:41` | Remove proxy/sign-in and separate duel guild checks; use the common resolver. `saved-decks.ts:22` also uses it. |
| `W/app/api/admin/season/route.ts:19` | Delete write route/settings control. VM `scripts/season.ts start/end` calls shared season service for configured guild; optional actor is a real user ID, never an admin role. Preserve leaderboard/dashboard season reads. |
| `W/app/api/settings/route.ts:22` | Remove **PUT** guild-settings writes and obsolete GET/UI; remove `src/components/settings/{announcement-toggles,season-control}.tsx`. Keep DB settings for shelved bot compatibility. `/settings/account` is distinct. |
| `W/src/lib/cube-access.ts:30`, `W/app/api/cubes/route.ts:74,95` | Creator equality only; `canEdit` agrees with writes. Remove “owner or admin” copy from cube library/pool components. |
| `W/app/api/drafts/[slug]/helpers.ts:333`, `.../tournament/route.ts:39` | Only draft creator may create follow-on tournament; retain completed/no-existing-tournament requirements. |
| `S/services/draft-tournament.ts:13,57` | Remove `actorIsAdmin`; enforce creator equality in shared logic. Update finale/summary/page permission copy/comments. |
| `W/app/api/tournaments/[slug]/route.ts:245,287`, `.../complete/route.ts:32`, `.../kick/route.ts:36` | Already creator-only; preserve with numeric IDs. No general tournament admin override was found. Audit start/reopen/result/join-bot and draft mutations with the same rule. |

PR 2 public paths: custom sign-in/sign-up catch-alls, `/sso-callback`, `/access`, exact `POST /api/waitlist`, assets/icons and existing enabled FX-lab exceptions. Preserve marketing routing/robots behavior. The app hosts no `/privacy` or `/terms` pages and adds no public exceptions for them; footer/account links and signup consent use `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`.
Protected APIs return JSON 401; pages redirect to sign-in. Resource denials remain 403/404; Clerk sync failure is 503. `/access` explains the waitlist and links to marketing signup; it is not a second approval gate.
Keep `/api/auth/session` as our compatibility response for existing browser consumers; delete NextAuth catch-all/provider routes. Add server session resolution to `(app)/layout.tsx`, which currently only renders `AppShell` (`W/app/(app)/layout.tsx:4`), as well as route guards.

## Bot shelving and worker

`DISCORD_BOT_ENABLED` is true only for literal `1`, explicitly set in PR 1; cutover sets `0`. Server-render this capability to UI; do not rely on a stale public build-time flag.
Check it before bot token validation/client construction (`B/index.ts:60`) and login (`:547`). Guard `deploy-commands.ts` too: Compose/Docker currently register commands before startup. Disabled entrypoints exit cleanly without Discord I/O, announce server, timers or registration.
Keep bot source, package, runtime target and tests. PR 2 removes its service from production/dev/staging Compose; reenabling source alone does not recreate a service and is out of scope. All community functionality listed under “What stays” remains in the app, with worker-owned scheduling.

| Current implementation | New owner / behavior |
|---|---|
| `B/services/draft-timer.ts:18,56`; scheduling `B/index.ts:446` | `packages/worker/src/draft-timer.ts`: startup sweep and every 1s, expire picks and broadcast committed WS state. Preserve completion/deck hooks. |
| `B/services/tournament-timer.ts:29,69`; `B/index.ts:456` | `worker/src/tournament-timer.ts`: startup sweep and every 1 minute, auto-approve reports, close due tournaments/duels, broadcast invalidations. |
| `B/index.ts:396,405` | `worker/src/set-sync.ts`: empty-cache startup sync and `SETS_SYNC_CRON` (`0 6 * * *`), `SETS_SYNC_TIMEZONE` (`UTC`). Syncs set metadata, not the entire catalog. |
| `B/services/draft-cleanup.ts:100,116`; `B/index.ts:421` | Extract reusable filesystem eviction into shared; `worker/src/image-cleanup.ts` schedules `IMAGE_CLEANUP_CRON` (`0 4 * * *`) / timezone, same cache path/max-byte limit. Keep bot's command-facing cleanup wrapper. |
| `B/index.ts:464,483` | Discord notification-message cleanup/reminders stay with bot in PR 1, then shelve as Discord I/O. They are not gameplay timers or inbox retention jobs. |
| `B/index.ts:202,225,250`, announce handlers | PR 1 worker forwards Discord status/completion/resolve effects via signed bot HTTP; add a draft-status operation since `onDraftStarted` does nothing (`B/announce/handlers.ts:35`). Preserve completion sweeps/claims without a second gameplay timer. Skip these effects in PR 2. |

Remove all four migrated scheduler starts from bot in PR 1, including empty-cache sync; no “both” fallback.
Worker depends on shared, not discord.js/bot; effect adapters isolate Discord HTTP from state changes. Avoid claiming completion then asking a handler to claim it again.
One worker replica per SQLite file; stop the old bot before worker starts. Use non-overlapping ticks and drain on SIGTERM. Web opportunistic expiry (`W/app/api/drafts/[slug]/helpers.ts:99`) remains safe through shared transactional deadline checks; race-test it against worker expiry.
SQLite is the queue: pick deadlines, report confirmation windows and tournament deadlines persist due work. Sweeps reread state after restart; guarded transactions prevent repeating gameplay transitions. Network delivery is a separate effect, not evidence state committed twice. No Redis/BullMQ/pg-boss.
Add workspace manifest/build/test scripts, root `dev:worker`, Docker `worker` target and its manifest COPY in `deps`.
Compose worker shares absolute `DATABASE_PATH=/app/data/bot.sqlite`, image-cache volume, WS URL/secret and cron settings. Add staging worker on staging-only DB/cache and E2E worker per isolated DB; no public worker port.
Remove WS dependency on bot (`docker-compose.yml:32`); migrate before readers/writers, then start WS/worker without a dependency cycle. Preserve duel-server's clock/archive/series sweeps.
Update `.github/workflows/deploy.yml:235` image preservation/build/restart/health handling for worker and WS; remove bot there at cutover. Replace staging's unconditional cache deletion (`scripts/staging/remote-deploy.sh:117`) with worker eviction. CI explicitly tests worker and retains bot tests/typechecking.
With switch off, channel REST/dedicated announce endpoints return a deliberate disabled response (404), not 502; other mutations skip announce I/O without implying delivery (`W/app/api/tournaments/[slug]/announce/route.ts:70`).
Hide Discord channel pickers in `create-draft-form.tsx`, `create-theme-draft-form.tsx`, Discord announcement toggles/buttons and `/draft`/`/event` command hints; retain the forms, draft modes and event flows. Draft POST accepts NULL channel (`W/app/api/drafts/route.ts:122`). Remove Discord guild-settings navigation/page; redirect old `/settings` links to `/settings/account` and retain community navigation.
Duel challenge/tournament-duel responses expose a share URL and “Copy the link”; remove DM sent/failed language. PR 2 provides link sharing; PR 3 adds inbox/live delivery. This interval has no direct recipient notification.

## User flows

### Sign-in shell (marketing, before PR 2)

Owner agreement **2026-10-06**: concept A “Sealed pack”, with the form column left and pack right on desktop, pack above the form on phone, and a single card that swaps steps in place.
Marketing's separate sign-in shell PR lands this visual shell on today's NextAuth login page before PR 2. Add `packages/web/src/components/auth/sign-in-shell.tsx` and `sign-in-shell.module.css`; the reusable shell takes the form column as children. Keep `W/app/(auth)/login/page.tsx` thin. A presentational error component takes `{ title, body, action }`; the NextAuth `?error=` mapping stays in the page.
That PR deletes the card wall, ring and YGOPRODeck art. It commits the mock under `docs/design/sign-in/`, with one markup block per step: identifier, password, check-your-email code, new password, create account (locked email, username, taken-username error, consent and CAPTCHA slot), signing-you-in, and each error. Include desktop/mobile shots and a hook point for the pack-tear success frame.

### Custom sign-in/sign-up (PR 2)

Reuse the merged `sign-in-shell.tsx` and CSS module on the Clerk sign-in/sign-up catch-all routes. Build the single step card from the committed `docs/design/sign-in/` markup blocks, map Clerk errors onto the existing `{ title, body, action }` error component, and add the pack-tear success frame at the supplied hook point. Keep concept A's desktop/phone layout. Preserve safe internal return URLs and invitation context across steps and OAuth; the app owns state transitions and error mapping.
Installed `@clerk/nextjs` **7.9.11** exports `useSignIn`/`useSignUp` from its main entry via `dist/types/client-boundary/hooks.d.ts`; `@clerk/react` declares the signal returns `{ signIn, errors, fetchStatus }` / `{ signUp, errors, fetchStatus }`. Use these current hooks, not the `/legacy` hooks or prebuilt `<SignIn/>`/`<SignUp/>` components. `@clerk/elements` is absent from the installed packages and [Clerk Elements is deprecated](https://clerk.com/docs/guides/customizing-clerk/elements/overview); do not add it.
The installed `@clerk/shared/dist/types/{signInFuture,signUpFuture,state}.d.ts` defines the methods/structured errors below; recheck the installed exports during implementation. Keep a small, unit-testable step state machine/error mapper around Clerk's authoritative status, missing fields and verification state; handle returned `{ error }`, field errors and pending `fetchStatus` before advancing.

| Step / state | Required behavior / Clerk API |
|---|---|
| Sign in | “Continue with Discord”, or email + “Continue”. Start email identification with `signIn.create({ identifier })`, then show the password step; Discord uses `signIn.sso({ strategy: 'oauth_discord', redirectUrl, redirectCallbackUrl: '/sso-callback' })`. |
| Password | Submit with `signIn.password({ password })`; include “Forgot password”, which starts `signIn.resetPasswordEmailCode.sendCode()` for the identified email. Wrong password stays on this step with a useful error. |
| Check your email | One general six-digit code step with a purpose carried in state: signup verification uses `signUp.verifications.sendEmailCode/verifyEmailCode`; reset uses `signIn.resetPasswordEmailCode.sendCode/verifyCode`; new-device/client-trust verification, if enabled and returned as `needs_client_trust`, uses Clerk's supported email factor via `signIn.mfa.sendEmailCode/verifyEmailCode`. Include resend and invalid/expired-code handling. These verification/recovery paths do not enable passwordless sign-in. |
| Set new password | After reset-code verification reaches `needs_new_password`, submit with `signIn.resetPasswordEmailCode.submitPassword({ password })`; handle remaining verification before completion. |
| Create account / invite accepted | Consume `__clerk_ticket` with `signUp.ticket({ ticket })` and lock the email to Clerk's invitation result, not an editable/query-string email. Require username with taken-username error, password or “Continue with Discord”, and a legal-consent checkbox linking the two marketing URLs. Use `signUp.update` for username/actual `legalAccepted`, `signUp.password` or `signUp.sso` for the chosen method, preserving the accepted invitation attempt and filling any missing requirements after OAuth. |
| Signup bot protection | Mount `<div id="clerk-captcha" />` before signup requests; preserve/re-establish the mount through relevant step changes so Clerk can run its bot-protection CAPTCHA. |
| Errors | Map Clerk errors onto the shell PR's presentational `{ title, body, action }` error component and retain relevant field errors. Explicit “Not invited yet” state links to the marketing waitlist; map wrong password, taken username, banned account and service trouble separately. Keep retryable failures on the relevant step and never treat an incomplete/error response as authenticated. |
| Signing you in | Show the committed pending “Signing you in” step, prevent duplicate submissions and call the completed attempt's `finalize()`. Retain safe return destinations and handle outstanding Clerk requirements rather than granting access early. |
| Success | After successful finalization, show the pack-tear success frame at the shell's hook point, then navigate to the safe return destination. PR 2 implements this frame; the marketing shell PR supplies the hook. |

Add public `app/(auth)/sso-callback/page.tsx` for Discord redirects. Resume the v7 hook state there, return incomplete signup to the same card for missing username/consent/verification, and complete session activation before entering the app. Invitation ticket + Discord must be proved on the dev instance; a redirect must not lose invitation eligibility or unlock its email.
`/settings/account` may keep the prebuilt `<UserProfile/>` themed with our tokens; it handles connected accounts/linking, with the forced sync/history rules above. Include the marketing legal links in the account area and app footer.

### Waitlist → approval → invitation → first run

After marketing merges, preserve validation, honeypot, rate limit, no-store responses, JSON/native-form support and first-signup metadata (`marketing: W/app/api/waitlist/route.ts:99`).
Call `join(email, meta)`, then await Clerk `waitlistEntries.create({ emailAddress: email, notify: true })`, including on local `exists` so partial failure heals. Never hold a SQLite transaction across HTTP. Honeypot requests call neither service.
Clerk returns the existing entry on duplicate email; verify repeat-email delivery in development. On Clerk failure retain the local row and return retryable failure (JSON 503; native-form retry message), never false success. Add dry-run reconciliation for old/failed signups; retry must not re-invite revoked entries. [API contract](https://clerk.com/docs/reference/backend/waitlist-entries/create).
Owner approves in Clerk dashboard; Clerk sends our confirmation/invitation templates. Preserve invitation tickets when routing to custom signup and through Discord; test this because default routing uses the Account Portal. The invitation locks the email; required username, email verification and legal consent complete before access. [Waitlist behavior/templates](https://clerk.com/docs/guides/secure/restricting-access).
Before enabling the bridge/imports, PR 2 extends marketing PR #193's `site/public/privacy.html` in coordination with the marketing session. It already covers waitlist metadata, general app/Clerk use, cookies and deletion contact; replace its “Once you are invited” limitation because `/api/waitlist` now creates Clerk waitlist entries before approval. Disclose the `users` table, verified Discord email capture and imported/pre-created accounts, retaining one policy. Marketing writes terms beside it; all consent/footer/account links use the marketing URLs.
First authenticated request resolves a user, then lazily creates a community player as needed. No guild/local invite/admin gate intervenes.

### Existing member at cutover

PR 1 imports all players and captures email on subsequent Discord sign-ins. Owner asks members to sign in before cutover; never invent an email from Discord ID/name.
`scripts/clerk-precreate-users.ts` defaults to dry-run; apply selects humans with verified email and no Clerk ID, deduplicates emails/usernames and reports conflicts without merging.
Call `createUser({ emailAddress: [email], skipPasswordRequirement: true, username, externalId: String(user.id) })`; API-created email is verified by default. Sanitize usernames to instance rules/length, dedupe against local/imported and Clerk users, persist the chosen value. [Create-user contract](https://clerk.com/docs/reference/backend/user/create-user).
Persist Clerk ID per user; reconcile by externalId before retrying interrupted creation, never bind a different existing account solely by email. Bound rate-limit retries; record instance/counts/errors without credentials. Dry-run performs no remote/local writes.
Enable Discord before import. Never fabricate `legalAcceptedAt`; if migration requires `skipLegalChecks`, restrict it to imports and verify new signup still requires consent. Pre-created members are signing in, not signing up.
First Discord sign-in should attach by matching verified email; prove this in development. Fallback: password reset by email code, set a password, then link Discord in account settings. This is recovery, not passwordless sign-in. [OAuth linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking).
No-email members join the waitlist and, after approval, sign in/link Discord; resolve the Discord-only user before creating gameplay history. Owner announces manually.

### Email account links Discord / conflict

Open `/settings/account`, connect through the prebuilt `<UserProfile/>` themed with our tokens, return and force sync. Run the locked algorithm; display recovered history or conflict. Matching verified email may trigger Clerk auto-link without manual connection.
Two populated identities remain separate until the owner applies the reviewed merge script. An already-attached different Clerk ID is also a conflict even if its row appears empty.

### Inbox (PR 3)

Build a workshop page and review desktop/mobile renders with existing tokens; choose dropdown versus `/inbox` there.
Bell shows unread count; links retain ordinary resource authorization. Mark-read updates only the recipient's rows. Store minimal display/link data, never private decks or duel state.
Insert deduplicated notifications in the transition transaction: duel challenge (opponent), tournament match ready (both participants), result awaiting approval (approver), joined tournament started, joined draft started, draft finished (participants).
Shared transition hooks cover web/worker/duel-server; publish invalidation after commit over existing signed WS HTTP. Add authenticated web-issued user-room tokens bound to numeric `users.id`, short expiry and a separate signature domain. Never trust a browser-supplied room ID alone.
Reconnect refetches unread/list state. Worker removes read and unread notifications older than 30 days using UTC daily/startup cleanup. No email and no replay of pre-inbox history. PR 3 extends the same marketing privacy page for inbox data and 30-day retention, coordinating wording with the marketing session.

## File-by-file implementation scope

`New`, `change`, `delete` refer to future PRs. Expand grouped route/component families to every identity/admin/Discord consumer during implementation.

### PR 1 — ships early, NextAuth and bot active

| Package | Files / change |
|---|---|
| Shared schema | **Change** `src/db/{schema,connection}.ts`, `src/services/index.ts`, `src/types/*`, `src/duels/*` identity DTOs. **New** `src/services/users.ts`, migration/user tests. **Delete/rework** S1 files/tests per disposition table. |
| Shared services | **Change** `src/services/{players,drafts,tournaments,cubes,seasons,saved-decks,draft-decks,draft-access,draft-tournament,tournament-registrations}.ts`; all owner SQL/arguments become integer IDs. **Change** `src/ws/draft-token.ts`, notify contracts; **new** reusable image-cache cleanup. |
| Web lib | **Change** `src/lib/{auth,web-access,discord-web-access,duel-host,saved-decks,cube-access}.ts`, auth types/DB actor helpers; preserve PR 1 checks using Discord ID. **New** canonical user-ID parsing/resolution helper. |
| Web routes/UI | **Change** `app/api/{drafts,tournaments,cubes,decks,player,players,matches,bug-reports,admin/season}/**`, identity-reading `(app)` pages, draft pool/store/hooks and session consumers. Translate announcement identities to Discord IDs, never integer mentions; update related tests/fixtures. |
| Bot | **Change** `src/repositories/players.ts`, `commands/handlers.ts`, `interactions/{buttons,modals,select-menus,autocomplete}.ts`, `index.ts`, `deploy-commands.ts`, `announce/{server,handlers}.ts`, cleanup wrapper. Ensure users for player/event/cube creation and creator checks; keep interactions/messages functional. |
| Worker | **New** `package.json`, `tsconfig*.json`, `src/{index,draft-timer,tournament-timer,set-sync,image-cleanup}.ts`, effect adapters/tests. Extract schedulers; bot may keep re-export wrappers/tests but never starts them. |
| WS | **Change** `src/events.ts`, shared access reader use, token payload validation/tests; clients issue/consume numeric draft user IDs. |
| E2E/scripts | **Change** `stack/{seed,env,start,prepare,login-auth}.mjs`, `tests/auth.setup.ts`, login/seed unit tests/fixtures; retain NextAuth test login but assert application IDs. Update root seeds and every fixture inserting players/owner IDs. |
| Deploy/docs | **Change** root `package.json`/lockfile, Dockerfile, Compose production/override/staging, deploy/staging/test workflows and staging scripts. Document worker/transitional identity in `CLAUDE.md`, `docs/architecture.md`, `.env.example` and VM runbook. |

### PR 2 — domain cutover

Rebase on merged marketing PR #193, the sign-in shell PR and the rename PR first. The sign-in shell PR owns `W/src/components/auth/sign-in-shell.tsx`, its CSS module, the presentational error component, today's thin NextAuth `W/app/(auth)/login/page.tsx`, and the mock/step markup/shots under `docs/design/sign-in/`; it deletes the card wall, ring and YGOPRODeck art and supplies the pack-tear hook. PR 2 reuses this shell and error component.
The rename PR owns `W/app/layout.tsx` metadata, `W/src/components/layout/{sidebar,mobile-drawer,shell-model,brand-mark}.tsx`, duel header/room files, `W/src/styles/match-sheet.css`, `W/src/lib/ydk-file.ts`, `PRODUCT.md` and their tests; it excludes `W/app/(auth)/login/*`, which the sign-in shell PR handles before PR 2. PR 2 preserves that branding while changing the overlapping layout files and auth provider. The Clerk step card, orchestration, callback, pack-tear success and tests make PR 2 larger than a prebuilt-component integration; reserve the bounded review for this larger risk area as well as identity/cutover safety.

| Package | Files / change |
|---|---|
| Web auth | **Change** `package.json`/lockfile (Clerk replaces next-auth), `proxy.ts`, `app/layout.tsx`, `(app)/layout.tsx`, `src/lib/auth.ts`, guards/account/signout components. **New** `src/lib/{session-identity,clerk-sync,e2e-auth}.ts`, own `app/api/auth/session/route.ts`, gated E2E login and account-refresh routes. |
| Web pages | **Replace** `(auth)/login` with custom Clerk-hook sign-in catch-all; **new** custom sign-up catch-all, `app/(auth)/sso-callback/page.tsx`, `/access`, `/settings/account` catch-all with token-themed prebuilt `<UserProfile/>`. Reuse the merged `src/components/auth/sign-in-shell.tsx` and CSS module on both auth catch-alls with the step card as children; preserve Dueling Domain branding, old login links, invitation tickets and safe internal return URLs. No app legal pages. |
| Custom auth UI/tests | **Reuse** the shell PR's `src/components/auth/sign-in-shell.tsx`, `sign-in-shell.module.css` and presentational `{ title, body, action }` error component. **New** step-card components under `src/components/auth/`, built from each committed `docs/design/sign-in/` markup block: identifier/password/code/new-password/create-account, pending/errors, consent links and `clerk-captcha` mount; add the pack-tear success frame at the existing hook. **New** `src/lib/{auth-flow,auth-errors}.ts` for Clerk transitions/error mapping and focused unit/component tests with Clerk mocked. Wire the installed v7 hooks and SSO callback; review every step against the committed shots. No Clerk Elements. |
| Shell | **Change after rename** `src/components/layout/{sidebar,mobile-drawer,shell-model}.tsx` and tests to remove admin/Discord/guild-settings entries while retaining community navigation, account access and the new branding. Add marketing privacy/terms links to the app footer/account area. |
| Web deletion | **Delete** `app/api/auth/[...nextauth]/route.ts`, NextAuth login actions/provider config, `src/lib/discord-{web-access,guild-membership,guild-admin}.ts`, obsolete tests; remove admin/season route, guild-settings route/page/controls and listed overrides/copy. Remove NextAuth-specific Vitest config. |
| Discord UI/calls | **Change** `src/lib/{notify,announce-bot,env,bug-report-github}.ts`, draft/theme forms, tournament Announce UI/routes, list/hint copy, duel challenge/tournament-duel routes and invite UI to remove Discord controls/I/O while preserving their in-app flows, modes and bug reporting. Disable channel REST without credentials; absolute links use `WEB_URL`. |
| Shared/scripts | **Change** users service for Clerk/linking, `draft-tournament.ts` for creator-only access. **New** `scripts/{clerk-precreate-users,clerk-reconcile-waitlist,merge-users,season}.ts`; imports/reconciliation/merge default to dry-run. Add all linking-branch tests. |
| Marketing | **Change after merge** `W/app/api/waitlist/route.ts`, route tests and marketing form error handling; retain waitlist service/table. **Extend** existing `site/public/privacy.html` (PR #193) for pre-approval Clerk waitlist entries, users/verified-email capture and imported accounts; coordinate wording with marketing, which writes `site/public/terms.html`. Verify footer/account/Clerk consent links resolve to the marketing URLs. Reconcile old signups before opening the new funnel. |
| E2E | **Change** `stack/{env,start,prepare,login-auth,login,fetch-stub}.mjs`, `tests/auth.setup.ts`, `tests-unit/login.test.ts`, Playwright readiness/helpers. Replace CSRF/provider login with signed cookies; remove Discord auth stubs/NextAuth secrets, retain card stubs. |
| Deploy | **Change** Compose/Docker/deploy workflows: remove bot service, switch off, supply Clerk public key at web build and private key only at runtime, change WS origin from `NEXTAUTH_URL` to `WEB_URL`. Keep bot build/typecheck/tests. |
| Env/docs | **Remove** `NEXTAUTH_*`, obsolete `AUTH_URL/AUTH_TRUST_HOST`, web `DISCORD_CLIENT_ID/SECRET/TOKEN`; retain community ID and isolated shelved-bot credentials if needed. Replace broad web `.env` injection with scoped env. Update `.env.example`, staging env/health scripts, smoke tests, README, `CLAUDE.md`, architecture and VM/staging docs. |
| Cutover docs | **Change after merge** `docs/deployment/domain-cutover.md`: add Clerk DNS/email section; rewrite steps **3/5/7** for Clerk DNS, env/WS origin and real auth checks; update step 4, rollback and waitlist-email wording. Inspected sibling version already delegates Clerk work but still mentions NextAuth origin/storage-only waitlist. |

### PR 3 — inbox after design review

| Package | Files / change |
|---|---|
| Design/web | **New** `docs/design/inbox/workshop.html` and render evidence, notification components/hooks, chosen page/dropdown. **Change** shell/account navigation. **New** `app/api/inbox/{route.ts,[id]/read/route.ts,connection/route.ts}` with recipient guards. |
| Shared | **Change** `src/db/schema.ts`; **new** notification service/tests, user-room token/event contracts. **Change** duel/tournament/match/draft transitions for six atomic triggers. |
| WS/worker/duel | **Change** `X/{events,internal-http}.ts` for authenticated user rooms/invalidation; **new** worker retention task. **Change** duel-server transition effect wiring where needed; retain player-based duel tokens. |
| Tests/docs | **New/change** inbox unit/route/socket/E2E tests, retention fixtures; extend marketing `site/public/privacy.html` for inbox data/30-day retention in coordination with marketing, and update architecture. |

## Test plan and review bounds

Use Node 22: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`. Build shared before consumer checks.
Each PR runs affected package tests, all-package typecheck and required CI checks, including bot after shelving. One review → one fix pass → one re-review; report remaining blockers without expanding the loop.

| PR | Required evidence |
|---|---|
| Sign-in shell before 2 | On today's NextAuth login, review concept A's desktop form-left/pack-right and phone pack-above-form layout; keep the page thin, form column passed as children, and `?error=` mapping in the page. Verify presentational errors, removal of card wall/ring/YGOPRODeck art, every step/error markup block and desktop/mobile shot under `docs/design/sign-in/`, and the pack-tear hook. |
| 1 migration | Realistic SQLite backup, never live file: counts/IDs, every player FK, five owner mappings, creator-without-player, NULL season creator, multiple legacy guild rows, test bots, indexes/defaults/sequence values. Run twice, interrupt/roll back, race startup, reject invalid FKs, preserve snapshots/decks. Test S1 empty cleanup/non-empty abort. |
| 1 identity/routes | Verified provider email only; existing JWT migration; string session ID vs integer ownership; Discord checks still receive Discord ID. Draft/cube/tournament/deck permissions, bug-report actor, bot creation/ownership/mentions, deck backfill/registrations. Reject old/string draft tokens; preserve duel tokens. |
| 1 worker/E2E | Fake-clock expiry/approval/closure/crons, restart catch-up, non-overlapping ticks, web expiry race, failed Discord effects without lost WS state, completion claims, absence of four bot schedules. Offline NextAuth E2E plus bot smoke with worker and unattended events; isolated DB/cache paths. |
| 2 unit/routes | Mock Clerk; fresh/stale/missing/forced sync and failure, normalized emails, concurrent first access/linking, both empty directions, ownership-only history, both-history refusal, already-claimed Clerk ID. Deny former admin overrides. Email-only drafts/decks/duels work without channel/Discord calls; disabled announce never returns 502. |
| 2 custom auth unit/UI | Mock the installed v7 hooks; test the step state machine/error mapping onto the reused presentational error component for identifier → password, all three purposes of the shared code step, reset → new password, invitation email lock/username/consent and OAuth missing requirements. Cover taken username, not invited/waitlist, wrong password, ban, service trouble, invalid/expired code/resend, pending/finalize, pack-tear success only after finalization and no premature access. Check `clerk-captcha` mount, safe returns/ticket preservation, marketing legal URLs, and absence of app legal pages/public exceptions. Render-review **every step and each error** on desktop/phone against the committed `docs/design/sign-in/` shots, including locked email, username/taken error, consent/CAPTCHA slot and signing-you-in; review the added pack-tear frame at the supplied hook. |
| 2 offline E2E | HMAC-signed expiring HttpOnly/SameSite cookie, enabled only by literal `E2E_AUTH=1` plus ≥32-character secret on isolated stack. Secret-authenticated POST issues cookie for seeded `users.id`; invalid/expired/disabled cookies fail through common resolver. Production-like builds with gate off expose no bypass. Test mode bypasses Clerk middleware/provider network initialization and uses offline account controls. |
| 2 integration | Waitlist JSON/form/honeypot/rate-limit/duplicates/failure retry/reconciliation; import dry-run/resume/rate limits/email collisions; repeat migration on realistic copy. Offline email-only and linked ownership/duel suites; `/api/waitlistx` stays protected and `/sso-callback` is public. Verify retained community flows: draft night, booster/theme cube drafts, cube editor, tournament creation/registration/decks/brackets/reporting/approval/deadlines, Domain and 1v1/Tag/FFA3/FFA4, saved decks, seasons/current Elo/points/standings/achievements/leaderboards and bug reports; worker timers still advance with the bot off. Preserve ranked-series/tournament recording and no match for practice-bot/unranked casual series (closed Q43 = A). Season/merge scripts, disabled test gate and Docker secret isolation; rebased shell tests retain rename branding and community navigation while removing admin/Discord/guild-settings entries. |
| 2 manual Clerk dev | Pro/config readback; exercise **every custom step/state** with real invitation wording/delivery, ticket-locked email, required/taken username and legal consent for password **and invitation ticket + Discord**, including OAuth callback/missing requirements. Test email/password login, signup code, Forgot password/code/set-new-password and imported-account reset fallback, client-trust code on a new device if enabled, invalid/expired codes/resend, CAPTCHA, not-invited/waitlist, wrong password, banned account, service trouble and “Signing you in”. Verify marketing legal URLs, no passwordless/passkeys and 30-day session policy. Pre-create then Discord login proves **same Clerk ID, users.id, players.id**; test all linking branches, active-user ban and token expiry. |
| 3 | Desktop/mobile workshop/render review; recipient isolation, mark-read/count, all six triggers/all writers, deduplication, signed rooms/expiry, reconnect recovery, UTC 30-day cleanup and no email/Discord. Two-user E2E challenge → live unread → open/read plus worker-produced events. |

## Rollout and rollback

### PR 1 deploy

1. Back up SQLite first via existing online backup procedure; protect backup/env and record commit/images. Rehearse migration/rollback on a realistic copy, including bot commands and worker effects.
2. Build coordinated release, drain active work under VM runbook, stop web/bot/duel/worker writers and WS, run one migration process. Check mappings/counts/FKs/integrity before accepting traffic.
3. Start WS/duel/web, updated bot with `DISCORD_BOT_ENABLED=1`, and exactly one worker. Prove old bot timers are absent, unattended deadlines advance, and Discord commands/announcements work. Reconnect sessions/draft sockets.
4. Begin email capture; owner asks members to sign in. Retain NextAuth credentials/config through cutover rollback window.
5. Rollback: old binaries are incompatible with integer owner columns. Stop writers and restore pre-PR1 DB plus matching code/images/env (record/reconcile intervening writes), or fix forward. Never start old bot on new schema or run worker alongside old bot timers.

### Pre-cutover checklist

Owner logs into Clerk CLI; Codex targets the correct workspace/app, uses `clerk apps create`, inspects config/schema, applies `clerk config patch`, and `clerk env pull` into ignored/scoped files. Capture sanitized readback/diff; this docs task runs no configuration commands. [CLI reference](https://clerk.com/docs/cli).
Require Waitlist, custom Discord callback/credentials, email/password plus verification code, username, 30-day maximum session lifetime without shorter inactivity policy, passwordless/passkeys off, Pro templates and legal-consent checkbox configured with `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`. [Legal-consent support](https://clerk.com/changelog/2024-11-11-legal-consent).
Verify marketing's merged concept A shell and presentational error component are reused on the Clerk catch-all routes. Review every implemented step/error against the committed desktop/mobile `docs/design/sign-in/` shots and review PR 2's pack-tear success frame at the supplied hook. Confirm installed v7 hooks/types, `/sso-callback`, invitation email lock/Discord completion, reset, `clerk-captcha` and every custom state against the dev checklist; record whether client trust is enabled and prove its code step if so. Custom-auth evidence is required despite PR 2's larger size.
Require dev auto-link proof before production import; record email coverage, no-email users/conflicts. Never copy dev Clerk IDs into production; scrub production IDs from staging DB copies and use separate keys.
Merge **marketing PR #193, the sign-in shell PR and the whole-app Dueling Domain rename PR before PR 2**; rebase PR 2 on all three, preserving metadata/branding and resolving sidebar/mobile-drawer/shell-model overlap with admin/Discord/guild-settings removal while retaining community navigation. Marketing lands concept A on today's NextAuth login in the shell PR; the rename excludes `app/(auth)/login/*`. PR 2 then reuses the shell and replaces NextAuth with Clerk flows. Routing remains marketing `duelingdomain.com`, app `app.duelingdomain.com`; production Clerk must match final app origin, with legacy redirects retained.
Coordinate the PR 2 privacy extensions with the marketing session and verify its terms are published beside the existing privacy policy. Confirm operator/contact/retention wording, including `privacy@duelingdomain.com`, and app footer/account/Clerk checkbox links to both marketing URLs; no app legal pages/public paths. Prepare production build/public key, scoped runtime secrets and exact Clerk DNS/email verification records.

### Cutover order (PR 2)

1. Confirm marketing PR #193, the sign-in shell PR and the rename PR are merged and PR 2 rebased on all three, with shell/layout overlap resolved; the shell and rename are already landed before cutover. Record DB/env/image backup and PR 1-compatible rollback release. Configure production Clerk for final app origin; apply exact DNS/email records with marketing A/AAAA/CNAME changes. Add its Discord callback and app `/sso-callback` routing; retain old settings for rollback.
2. Verify DNS/TLS/templates, marketing privacy extensions and terms, and app footer/account/consent links; publish coordinated disclosures before enabling Clerk waitlist writes/imports. Dry-run import/reconciliation and resolve collisions. Quiesce sign-ins/writes, take final backup, apply resumable production import, verify Clerk IDs/counts.
3. Deploy rebased PR 2 with the custom auth flows/callback and themed account profile: Clerk keys, canonical `WEB_URL`/WS origin, switch `0`, bot removed; retain worker/WS/duel. Recreate Caddy with final marketing/app/legacy hosts per domain runbook. Remove web NextAuth/Discord env injection; legal pages remain on marketing.
4. Reconcile existing waitlist signups into Clerk; enable combined route. Smoke-test custom email/password and Discord login, invitation ticket + Discord/signup consent, shared code/reset/new-password steps, CAPTCHA, ban behavior and pack-tear success against dev/render evidence. Verify history recovery, retained community flows and worker timers, channel-free drafts, decks, WS, renamed shell and marketing legal links. Owner announces new URL/access manually.
5. Rollback to **PR 1-compatible** release/env/origin and explicit bot service/switch, retaining one worker. Preserve current DB/Clerk mappings and email-only users/history, although NextAuth cannot sign them in. Never overwrite new activity with a stale DB. Keep Clerk accounts for forward recovery; coordinate cached redirects. Pre-PR1 rollback requires the separate DB restore above.

### PR 3 deploy / rollback

After design/render and bounded code review, publish the coordinated inbox/30-day retention extension to marketing's privacy page, back up DB, migrate notifications, deploy producers/worker/WS/web together and test two-user delivery. Roll back code to PR 2 while retaining additive notifications data; pause new retention task and preserve records. Link sharing remains available.

## Risks and genuinely open checks

| Risk / unresolved evidence | Required resolution |
|---|---|
| Custom Clerk auth is PR 2's larger risk area and increases its size: invitation + Discord, code-purpose transitions, reset, CAPTCHA, errors and finalization are application-owned UI. | Reuse marketing's merged concept A shell/error component and committed step markup with installed v7 signal hooks/types; unit-test state/error mapping with Clerk mocked and prove every step in the dev instance, including ticket preservation, locked email, consent and ban. Render-review every step/error against `docs/design/sign-in/` shots and the added pack-tear success frame. No prebuilt sign-in/sign-up or deprecated Elements shortcut. |
| Sign-in shell, rename and PR 2 overlap in auth/layout files and sidebar/mobile-drawer/shell-model. | Marketing PR #193, the sign-in shell PR and the owner-requested rename all merge before PR 2; rebase it on all three and retain Dueling Domain branding/community navigation while removing admin/Discord/guild-settings entries. Rename excludes `app/(auth)/login/*`; the shell PR updates today's NextAuth login first, and PR 2 reuses its shell/error component for Clerk and adds pack-tear success. |
| Discord auto-link/reset is documented, not tested on this owner's instance. Current auth only copies Discord ID (`W/src/lib/auth.ts:105`). | Capture verified email in PR 1; prove import/login/fallback before cutover. Do not claim current users already have email stored. |
| `<UserProfile/>` can finish OAuth before local two-history conflict detection. | Refuse local attachment without exposing B's history; test external unlink/owner recovery. No app block flag or implicit merge. |
| PR 2 precedes inbox: current invites are DMs (`W/src/lib/announce-bot.ts:28`). | Document temporary link-sharing-only delivery; inbox/live arrives in PR 3. |
| Rebuild/FK safety and test identities extend beyond player lookups (`S/db/schema.ts:259,709`, `S/services/draft-decks.ts:22`). | Realistic-copy evidence, coordinated deployment, null-safe bot classification; preserve high-water IDs/all children. |
| Completion is claimed before Discord delivery (`B/services/tournament-timer.ts:57`); intervals can overlap slow I/O (`draft-timer.ts:58`). | Single claim owner and non-overlapping ticks; no exactly-once external-message promise. PR 3 inserts/dedupes notifications with state. |
| Ban/outage propagation follows session refresh and independent tokens: draft TTL 60s, duel TTL 5 min. | Measure behavior; distinguish token validity from 30-day sessions/five-minute profile sync. [Clerk session model](https://clerk.com/docs/guides/how-clerk-works/overview). |
| Marketing privacy currently says Clerk processing starts once invited; PR 2 adds pre-approval waitlist entries and account imports. Legal operator/contact/retention confirmations and marketing handoff remain required. | Coordinate extensions to existing `site/public/privacy.html`, marketing's new terms and all app/Clerk links before enabling PR 2 bridge/imports; extend the same page for PR 3 inbox retention. Keep the policy on marketing. |
| Inbox presentation is still unspecified. | Resolve UI in PR 3 workshop. |
