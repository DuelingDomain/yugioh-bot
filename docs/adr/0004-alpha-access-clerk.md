# Clerk Waitlist mode for sign-in, a real `users` table, and the Discord bot shelved

**Status:** accepted (owner, 2026-10-05)

The closed alpha of Dueling Domain brings players in from an email waitlist, and many of them have never been in our Discord server. Today the app is a tool for one Discord server: Auth.js signs people in with Discord only, membership of `DISCORD_GUILD_ID` gates access, and players are identified by Discord ID.

We decided the following:
- **Clerk** (`@clerk/nextjs`) replaces Auth.js.
  - **Waitlist mode** is on, so only people we have approved can create an account. We approve them in the Clerk dashboard. Being signed in means having access; there is no guild check.
  - Sign-in is **Discord OAuth** or **email + password** with email verification. A username is required, and sessions last 30 days.
  - People are removed with a **Clerk ban**.
- A **`users` table** owns identity.
  - `players` and every creator or owner column point at `users.id`, not at a Discord ID.
  - Discord becomes an optional linked account on a user.
- The app has **no admin role**.
  - Creators manage their own drafts, tournaments and cubes.
  - The owner starts and ends the single app-wide season with a script on the VM.
- The **Discord bot is shelved** behind a switch and removed from Compose.
  - Its timers, card-set sync and image cleanup move to a new `packages/worker`.
  - Discord-only web features are hidden while the switch is off.
- In-app notifications (an inbox) replace Discord DMs and announcements.

## Considered options

- **Stay on Auth.js and add email sign-in.** Rejected by the owner. We would have to build the email provider, the verification and password flows, and the waitlist and invite handling ourselves. Auth.js is also in maintenance mode under Better Auth.
- **Clerk Open mode with our own invite gate in SQLite.** Rejected in favour of Waitlist mode. The waitlist, the approvals and the invite emails then live in one product we don't have to build.
  - Existing members are handled by importing them (see Consequences), not by a guild check.
- **Reuse `players.discord_user_id` as an opaque "player key".** Rejected by the owner. It would have been smaller, but identity would stay tied to Discord's column, and every Discord-facing use would need a guard.
- **A job queue for the bot's background work** (BullMQ, pg-boss). Rejected for now.
  - The deadlines already live in SQLite as part of draft and tournament state, so a sweep over due rows is the queue.
  - Per-deadline delayed jobs would duplicate that state and add Redis to a single-VM deployment.
  - Revisit if we run more than one app server.
- **Keep the bot as a "worker mode".** Rejected. A separate `packages/worker` makes the break from Discord clean.

## Consequences

- **Existing members are imported.**
  - PR 1, still on Auth.js, creates a `users` row for every existing Discord player, then records each member's verified Discord email whenever they sign in.
  - At the cutover, a script pre-creates a Clerk account for every user with a verified email. Clerk's account linking connects their first Discord sign-in to it.
  - Members with no email on file join the waitlist. Their history reattaches when they sign in with Discord.
- **Linking Discord later** attaches an existing Discord-only user, and their history, to the signed-in account. If both sides already have history, the link is refused and the owner merges them by script.
- **Clerk is a runtime dependency of web.** If Clerk is down, nobody can sign in, and sessions stop refreshing within about a minute.
  - ws and duel-server are unaffected: they keep verifying our own HMAC tokens.
  - Draft tokens and duel tokens carry our ids, not Clerk's.
- **E2E keeps an offline, test-only login.** Clerk is mocked in unit tests.
- **Bot-only features are dropped for the alpha:**
  - external `/duel` reporting (in-app ranked series and tournaments keep recording; practice-bot and unranked casual series stay UNRECORDED in match history, per `packages/shared/src/services/duel-series.ts:675`; Q43 = A, owner 2026-10-06, closed with no follow-up PR)
  - seeding other players at event creation
  - role-ping signup posts
  - draft-config templates
- **One community.** `guild_id` keeps its current value as the single community id. Multi-tenancy is out of scope.
- **Go-live.** Production Clerk needs DNS on `duelingdomain.com`, so the switch ships with the domain cutover.
