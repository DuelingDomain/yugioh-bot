# Creator fast-track: our own grants plus Clerk Invitations

**Status:** accepted (owner, 2026-10-24)

Dueling Domain stays a closed alpha. Normal people join the waitlist and wait; the scarcity is intended. Content creators must get in at once, and a creator must be able to bring their community in with a link that has a fixed number of uses, so we can measure what each creator brings.

We decided the following:
- A **grant** (`creator_grants`) means "this email may join now, because of creator X". Every fast-track path makes one grant and then sends one **Clerk invitation** (`POST /v1/invitations`, `notify: true`).
  - **Allowlist email**: the owner adds an email in `/admin` > Creators. The invitation goes out at once (30 days).
  - **Personal link**: `/join/<code>` with 1 use (default 14 days). The owner enters the creator's email to lock it to that inbox.
  - **Friends link**: 3 uses, default 14 days, no email lock. Anyone with the link skips the waitlist.
  - **Community link**: `/join/<code>` with N uses, 1 to 500 (default 50 uses, 30 days).
- Expiry is selectable at creation for every preset (1 to 90 days). **Custom** keeps editable uses (1 to 500) and an optional email lock; adding a lock fixes uses at 1. The create-link API also accepts an optional lock independently of the preset and rejects locked links with more than one use.
- Email locks use the same `email_key` inbox comparison as grants. `creator_links.locked_email_key` and the owner-only display address `locked_email` are nullable, additive columns; existing links stay unlocked. A mismatched inbox is rejected before account/grant lookup, claims no use and sends nothing. The public page/API never receives the locked address.
- A link use is a grant that signed up, or one whose invitation is still valid. An unused link invitation expires after 7 days and frees its use. We compute this in SQL; there is no job.
- One grant per inbox for all time (`email_key`: lower case, `+tag` removed, Gmail dots removed). An expired, failed or revoked grant can be re-opened by another link.
- The invitation carries `public_metadata.ddGrant` and redirects to `/sign-up?via=creator`. At Clerk sync after sign-up we bind the grant to the user and set `users.creator_id` (attribution).
- "How did you hear about us?" is an optional answer on the waitlist forms and the create-account card (`waitlist_signups.heard_from`, `users.heard_from`, sent from sign-up as `unsafeMetadata`). It is survey data and is checked against a fixed list. Creator sign-ups do not see it.

Proof on the dev Clerk instance with Waitlist mode on (2026-10-24): plain sign-up gets 403 `sign_up_restricted_waitlist`; a ticket from `POST /v1/invitations` completes sign-up, and `public_metadata` and `unsafe_metadata` arrive on the user.

## Considered options

- **Clerk Allowlist (Restrictions).** Rejected. It is a global sign-up restriction in the Clerk dashboard, not a way past Waitlist mode. It is not in `/admin` and gives no attribution.
- **Create a waitlist entry and invite it (the approve path).** Rejected for creators. It fires `waitlistEntry.created`, so the owner gets a Discord "approve?" alert for a person who is already approved, and it gives no attribution.
- **Clerk `publicMetadata` only, no local table.** Rejected. Use limits need an atomic count, and counts per creator must be cheap to read. SQLite does both.
- **Open sign-up for creator links (Clerk Open mode plus our own gate).** Rejected. It would remove the waitlist for everyone.

## Consequences

- The ticket URL verifies the email, so it never reaches a browser: Clerk mails it, and our client drops `url` from the invitation answer.
- Clerk allows 100 invitations per hour per instance. We keep our own budget of 80 per hour for all creator sends, 20 per hour per link, and 5 join posts per IP per 10 minutes. The limiter is in memory, which is correct for one web process. With more than one, move the counters to SQLite.
- `/join/<code>` always answers in the same way for a new email, an inbox that already has a grant, and an existing account, so it cannot be used to find accounts.
- An email-lock mismatch returns only `email_mismatch` and shows "This invite is for a different email address." Success, retry and mismatch responses keep the 1200 ms timing floor, independent of whether an account exists. The mismatch answer lets someone holding a Personal link test guesses of the creator's email; this accepted risk is limited by the per-IP limit, and a correct guess only sends the invite to the creator.
- An allowlisted person who joins the waitlist again gets the invitation again, and no waitlist entry or Discord alert is made. The admin waitlist hides emails that have a live grant.
- Account deletion removes the person's grants and scrubs matching email locks, revoking those links so erasing a lock cannot open access. The privacy page says that we store how you heard about us and which creator invited you.
