# Sign-in and access

Dueling Domain is a closed alpha. Clerk runs sign-in in Waitlist mode: only approved people can make an account. Being signed in is access; there is no guild check. The decision is [ADR 0004](../adr/0004-alpha-access-clerk.md). Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source |
| --- | --- | --- |
| `/` | Goes to `/dashboard` with a session, else to `/login` | `app/page.tsx` |
| `/login` | Old NextAuth URL. Redirects to `/sign-in` and keeps a safe `callbackUrl` as `redirect_url` | `app/(auth)/login/page.tsx` |
| `/sign-in` | Sign-in card: email + password, or Discord | `app/(auth)/sign-in/[[...sign-in]]/` |
| `/sign-up?__clerk_ticket=...` | Accept an invite and finish the account | `app/(auth)/sign-up/[[...sign-up]]/` |
| `/sso-callback` | Discord returns here; Clerk resumes the attempt | `app/(auth)/sso-callback/` |
| `/welcome-back` | Existing player recovery, last step | `app/(auth)/welcome-back/` |
| `/access` | "Invite-only for now" page with a waitlist link | `app/(auth)/access/` |
| `/join/<code>` | Creator invite link: "Invited by <creator>" and one email field | `app/(auth)/join/[code]/` |
| `/settings/account` | Account page (Clerk profile, sign out, delete) | `app/(app)/settings/account/` |

All paths in this table are relative to `packages/web/`.

## 1. Join the waitlist

1. The person enters an email on the marketing site, or on the sign-in card after "not invited".
2. The form posts to `POST /api/waitlist` (public; Caddy proxies it from the marketing host).
3. The route stores the email in SQLite first (`createWaitlistService(...).join`), then creates a Clerk waitlist entry with `notify: true`.
4. A form post gets a 303 back to `/?waitlist=<outcome>#join`. A JSON post gets 201 `joined`, or 400, 429, 503 or 500.

Limits: 5 posts per IP in 10 minutes, a 2 KB body, and a hidden `company` field that drops bots silently. Source: `app/api/waitlist/route.ts`.

The forms also ask an optional "How did you hear about us?" (`heardFrom`, plus a short `heardFromDetail` for "Other"). It is stored in `waitlist_signups.heard_from`. An email that the owner allowlisted for a creator gets its Clerk invitation again instead of a waitlist entry; the answer to the browser is the same.

The Clerk webhook `POST /api/webhooks/clerk` receives `waitlistEntry.created` and `user.created` and turns them into join-request notices. The owner approves people in the `/admin` console (see [owner-admin.md](owner-admin.md)).

## 2. Accept the invite

1. Clerk emails an invite link: `/sign-up?__clerk_ticket=<ticket>`.
2. The card shows the email from Clerk, never from the URL. The person picks a username and password and accepts the terms.
3. Clerk may ask for an email code. Then the session starts.
4. A pack-opening animation plays (about 1.7 s), then the page goes to the return path or `/dashboard`.

The create-account card asks the optional "How did you hear about us?" and sends it to Clerk as `unsafeMetadata`. Clerk sync copies a valid answer to `users.heard_from` (or the waitlist answer for that email). The card hides the question for a creator invite (`?via=creator`).

## 2a. Creator invite

Normal people stay on the waitlist. Content creators and their communities get in at once. The decision is [ADR 0007](../adr/0007-creator-fast-track.md).

1. The owner makes a creator in `/admin` > Creators, then adds the creator's email (allowlist) or makes a link: Personal (1 use, 14 days) or Community (50 uses, 30 days, or custom 1 to 500 uses).
2. A visitor opens `/join/<code>`. The card shows "Invited by <creator>", the spots left, and one email field.
3. `POST /api/join/<code>` checks the link, claims one use in one SQLite transaction (`creator_grants`), and asks Clerk to send an invitation (`notify: true`, redirect `/sign-up?via=creator`, `public_metadata.ddGrant`).
4. The card always says "If this email can join, your invite is on its way. Check your inbox." The same answer covers an inbox that already has a grant and an email that already has an account.
5. The person follows the email to the normal invite card (section 2) and uses a password or Discord.
6. Clerk sync after sign-up binds the grant to the user: `creator_grants.status = signed_up`, `users.creator_id`, `users.heard_from = creator`.

A full, expired or revoked link shows the normal waitlist form with source `creator:<code>`, so those leads still count for the creator. An invitation that is not used in 7 days frees its use. Limits: 5 posts per IP in 10 minutes, 20 sends per link per hour, 80 creator sends per hour in all (Clerk allows 100). Source: `app/api/join/[code]/route.ts`, `packages/shared/src/services/creator-access.ts`.

## 3. Sign in

The sign-in state machine is `packages/web/src/lib/auth-flow.ts`; the hook is `src/hooks/use-sign-in-flow.ts`.

| Way | Steps |
| --- | --- |
| Email + password | Enter email -> password -> (code if Clerk asks for client trust) -> success |
| Forgot password | Enter email -> code -> new password -> success |
| Discord | "Continue with Discord" -> Clerk OAuth -> `/sso-callback` -> success |

After success, the server resolves the identity (`resolveSessionIdentity`). On the first visit it syncs the Clerk user into `users` (`src/lib/clerk-sync.ts`) and records `first_sign_in_at`. Sessions last 30 days.

## 4. Existing player recovery

This is for members from the Discord era who have no Clerk account yet.

1. The person tries Discord sign-in. Clerk refuses because of the waitlist.
2. The card shows "recovering" and goes to `GET /api/auth/existing-player/start`.
3. That route starts a second Discord OAuth (PKCE, `identify email`) and returns to `GET /api/auth/callback/discord`.
4. The callback finds the `users` row by Discord ID.
   - No row, or no verified Discord email: go to `/access`.
   - Row already has a Clerk account: sign in to that account with a one-time ticket.
   - Row has no Clerk account: go to `/welcome-back`.
5. `/welcome-back` shows "Welcome back, <name>". The person accepts the terms.
6. `POST /api/auth/existing-player/complete` creates the Clerk account, links it to the old `users` row, and sets a ticket cookie.
7. The page goes to `/sign-in?existing_player=1`. The card reads the ticket from `POST /api/auth/existing-player/ticket` and signs in.

The proof cookies are encrypted, bound to `WEB_URL`, and live 10 minutes (the ticket 2 minutes). The routes check the Origin and rate-limit by IP. An email that already belongs to a Clerk account is refused with a support message. Source: `packages/web/src/lib/existing-player.ts`.

## 5. Account page

`/settings/account` shows the Clerk `<UserProfile/>` (email, password, connected accounts), the duel view setting, sign out and delete.

- Link Discord in the Clerk profile. The page calls `POST /api/account/refresh` so the link reaches `users`. If the Discord account belongs to another user, or both accounts have history, nothing changes and the page says so (`src/components/account/account-messages.ts`).
- Delete: `POST /api/account/delete` deletes the Clerk user and waitlist entries, then anonymises the rows (`deleteUserAccount`), including creator grants. If the database step fails, the owner finishes it with `npm run ops -- delete-user`.
- `/settings` redirects here.

## Access errors

| What the person sees | Cause | Source |
| --- | --- | --- |
| Not invited (with a waitlist form) | Email not found in Clerk | `err-invite` in `src/lib/auth-errors.ts` |
| Sign-up closed | Clerk waitlist refusal on sign-up, Discord or ticket | `err-signup` |
| Account unavailable | Clerk user is banned, locked or deactivated | `err-banned` |
| Banner "Sign-in is having trouble" | Any other Clerk error | `mapClerkError` |
| Discord recovery banners | `?error=discord_recovery_cancelled` (also `_busy`, `_unavailable`, `_expired`, `_support`) | `src/hooks/use-sign-in-flow.ts` |
| `/access` page | Unknown Discord identity in recovery | `app/api/auth/callback/discord/route.ts` |

API routes answer 401 `unauthorized` with no session and 503 `session_unavailable` when Clerk cannot be reached (`src/lib/web-access.ts`). The owner removes a person with a Clerk ban.

## Public routes

`proxy.ts` lets these through without a session: `/sign-in`, `/sign-up`, `/sso-callback`, `/welcome-back`, `/access`, `/join/<code>`, `/login`, `/monitoring`, icons, `POST /api/waitlist`, `POST /api/join/<code>`, `GET /api/auth/session`, the existing-player routes, `POST /api/webhooks/clerk`, and the FX lab when it is on.
