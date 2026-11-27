# Tournament bridge

DuelingDomain owns application identity and the member ID. The public
`DuelingDomain/tournament-software` repository owns the tournament application,
its SQLite database, sessions and container. It runs separately on the same VM.
There is no shared database mount, tournament backend, or Discord webhook here.
Every integration touchpoint is marked `Tournament bridge` and can be removed.

## Environment and deployment

Web receives only these explicit Compose entries:

```dotenv
TOURNAMENT_URL=https://tournament.duelingdomain.com
TOURNAMENT_BRIDGE_SECRET=<at least 32 characters; same secret in both services>
```

An empty/whitespace `TOURNAMENT_URL` disables **all** bridge routes with 404 before
Clerk, database access, or body reads. An enabled bridge requires a secret of at
least 32 characters and an HTTP(S) origin without credentials, path, query or
fragment; invalid configuration returns 503 `{"error":"bridge_unavailable"}`.
Use HTTPS in production. The secret is runtime-only, never a browser/build env.

Caddy receives `TOURNAMENT_DOMAIN`, default `tournament-disabled.localhost`.
Set it to `tournament.duelingdomain.com` when ready. Caddy proxies to
`host.docker.internal:3400` using its existing `host-gateway` mapping, like the
LiveKit host proxy. The separate container must publish port 3400 so Caddy can
reach it on the VM host; do not expose that port to public clients. The HTTPS
host applies a 1 MB request-body cap, `X-Robots-Tag: noindex, nofollow`,
`Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. `/robots.txt` returns
`User-agent: *` / `Disallow: /`. An explicit HTTP host redirects to HTTPS with
308, preserving path and query, ahead of the app's catch-all.

## Identity and storage

The `User` wire shape is exactly:

```ts
{ id: number, username: string, displayName: string,
  discordUserId: string | null, discordUsername: string | null,
  memberId: string | null }
```

`id` is the integer `users.id`, never a gameplay player ID or Clerk ID. Users are
global identities; `players` are guild-scoped, so there is no guild filter here.
No bridge response includes email. An anonymised account is treated as deleted.

The additive, idempotent migration creates
`user_profile_ids(user_id integer primary key references users(id) on delete cascade,
member_id text unique, discord_username text, updated_at text not null)`.
Member IDs are strings: remove spaces/whitespace and dashes, strip leading zeros
(an all-zero ID becomes `"0"`), then require 1–10 digits. Stored values are canonical;
the table also enforces this form. Empty strings are invalid; only `null` clears.
Updates preserve the other profile field and set `updated_at` to an ISO timestamp.

Account deletion itself is unchanged. FK cascade removes profiles when a user is
deleted. Because existing deletion retains users with shared history, the
bridge-owned `tournament_bridge_anonymised_user` trigger also removes the profile
when that row becomes the existing `deleted-<id>` / `Deleted player` tombstone
with a null Clerk ID. Lookup and search exclude those tombstones.

## Browser handoff

`GET /api/tournament-bridge/start?return=<relative path>` uses normal Clerk
protection. Anonymous visitors redirect to `/sign-in?redirect_url=...` with this
path and query intact. Sign-in displays tournament invite guidance beside the
waitlist link. Successful sign-in follows the requested event link.

The anonymous redirect also sets a host-only, Secure, HttpOnly, SameSite=Lax
cookie for 7 days. If a visitor later opens an approved waitlist invitation
in the same browser, sign-up uses the marker to return to the tournament
homepage. An ordinary sign-in with the marker does the same when it would
otherwise go to the dashboard. The marker applies only while the bridge is
configured. Explicit app destinations take precedence, and creator sign-ups
skip the marker. The app clears it when the handoff ends or the user signs out.
A failed handoff with the marker redirects to the dashboard.

With the bridge configured, owners can use **Admin → Creators → Invite tournament
organizer** to email a 30-day Clerk invitation. The ticket opens the app's
sign-up page and continues to DD Tournaments after account creation, including
in a different browser. Pending invites stay in place. For an existing account,
send the tournament link directly. The route shares the creator invitation
budget and records the actor and outcome in `mod_actions`. Denied and failed
invite entries include a hash of the normalized email.

Requests without the marker receive a 503 during identity-sync outages.
`return` defaults to `/`. It must start with a single slash, be at most 512
characters, and contain neither backslashes nor control characters. An invalid
value on a request without the marker returns 400 `{"error":"invalid_return"}`.

After resolving the application identity, exactly one `currentUser()` call
refreshes `discord_username` from the matching Discord external account
(`oauth_discord`, provider user ID matching the application's Discord ID).
An unavailable Clerk user is silently skipped, preserving the last snapshot.
A successful refresh without a matching account clears the snapshot to null.
The member ID is preserved. If the user is removed during the refresh, a
request without the marker returns 404.

The assertion is `payloadB64url + "." + signature`, where:

```text
payloadB64url = base64url(UTF8(JSON.stringify(payload)))
signature = lowercase hex(HMAC-SHA256(secret,
              "dd-tournament-assertion.v1." + payloadB64url))
payload = {v:1, nonce:<16 random bytes as unpadded base64url>,
           iat:<Unix seconds>, exp:iat+60, return:<validated path>, user:<User>}
```

The response is 302 to
`${TOURNAMENT_URL}/auth/callback?assertion=<assertion>` with
`Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
The receiving app verifies the signature and lifetime, validates the return,
consumes each nonce once, and establishes its own session. Assertion contents
are signed, not encrypted; never log the assertion or callback query.

## Signed service API

Only the following exact method/path combinations bypass Clerk. They require
no Clerk session or browser cookie. Each verifies the signature over bounded
raw bytes **before** parsing query inputs/JSON/route parameters or accessing the
database. Header format is strict:

```text
x-bridge-signature: t=<Unix seconds>,v1=<64 lowercase hex characters>

HMAC-SHA256(secret,
  "dd-tournament-api.v1\n" + METHOD + "\n" + pathWithQuery + "\n" + t + "\n" + rawBody)
```

`METHOD` is uppercase. `pathWithQuery` is the exact pathname and encoded query,
including `?` when present, excluding scheme/host/fragment. `rawBody` is the
exact request bytes (empty for GET); do not reorder query parameters, decode
escapes, add whitespace or reserialize JSON after signing. Sign with the shared
`@yugidraft/shared/tournament-bridge` `signTournamentRequest` helper, or implement
these bytes in the separate repository.

The inclusive clock window is ±60 seconds. Body size is at most 65,536 bytes,
checked against declared size and streaming bytes. Digest comparisons use
`timingSafeEqual`. Invalid/missing signatures, stale/future timestamps outside
the window, body mismatches/read failures and oversized bodies return 401
`{"error":"unauthorized"}`. All bridge responses use `Cache-Control: no-store`;
bridge route responses also use `Referrer-Policy: no-referrer`. These service
signatures permit retries within the window; they are not single-use nonces.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/tournament-bridge/users/search?q=` | Signed query with optional `exact=1` | `{users:[User]}`, up to 20 in partial mode or 1 in exact mode |
| `POST /api/tournament-bridge/users/lookup` | `{ids:number[]}`, at most 500 positive safe integer IDs | `{users:[User],missing:number[]}` |
| `PUT /api/tournament-bridge/users/[id]/member-id` | `{memberId:string|null}`, positive safe integer path ID | `{memberId:string|null,checkDigitOk:boolean}` |

Search trims `q` and returns an empty list for empty queries. Partial mode
matches exact `discord_user_id`, exact normalized member ID, and case-insensitive
SQLite LIKE prefix/contains matches on username, display name and Discord
username. LIKE wildcards (`%`, `_`) and backslashes are escaped. Exact ID
matches sort first, followed by username prefixes and other contains matches.
Ties sort by username and ID.

Set `exact=1` for whole-identifier matches on username, Discord username,
normalized member ID, or verified email. Usernames use SQLite's case-insensitive
comparison. Email queries are lowercased to match stored addresses. If several
accounts match, the lowest user ID wins. Both modes return the same user fields
and omit email.

Lookup de-duplicates IDs in first-request order; `users` and `missing` follow
that order. Deleted, anonymised and unknown users appear in `missing`. An empty
list is valid. Malformed JSON, invalid types, extra JSON fields or too many IDs
return 400 `{"error":"invalid_body"}` after authentication.

Member-ID conflicts return 409 `{"error":"member_id_taken"}` without changing
either profile. Invalid IDs return 400 `{"error":"invalid_member_id"}`; invalid
path IDs/body shapes return 400 `{"error":"invalid_body"}` in the handler.
Deleted/unknown users return 404 `{"error":"not_found"}`. The uniqueness check
and update run in an immediate transaction. A null member ID returns
`checkDigitOk:false`. The checksum is advisory and never blocks a valid value:
pad to 10 digits; multiply the first nine digits by `9,8,7,6,5,4,3,2,9`, sum,
and compare the last digit to `(11 - sum % 11) % 10`.

## Owner steps

1. Configure the separate repository/container and its own SQLite volume. Set
   the same strong random runtime bridge secret in both services. Keep clocks
   synchronized; configure the bridge app origin as the signed API destination.
2. Add DNS for the tournament host pointing at this VM; set `TOURNAMENT_DOMAIN`,
   `TOURNAMENT_URL` and `TOURNAMENT_BRIDGE_SECRET` in the VM env. Leave URL empty
   until the separate callback verifies assertions and prevents nonce replay.
3. Build/release shared and web together through the normal deployment workflow;
   its offline migration creates the additive table/trigger. Start the separate
   container with host port 3400 reachable by Caddy and its own private data.
4. Recreate web and Caddy after env/config changes (Caddy restart alone does not
   refresh the bind mount). Verify sign-in from an event link, organizer
   invitation sign-up and waitlist approval in the same browser. Check one
   successful assertion handoff, signed search/lookup/member-ID updates, conflict
   and deletion behavior, HTTPS headers, body limit and `/robots.txt`.
5. To disable the identity bridge, clear `TOURNAMENT_URL` and recreate web. Clear
   `TOURNAMENT_DOMAIN` and recreate Caddy to remove the public host as needed.

## Removal checklist

- Remove `packages/shared/src/tournament-bridge/`, its `./tournament-bridge`
  package export, and `packages/shared/tests/tournament-bridge/`.
- Remove `packages/web/app/api/tournament-bridge/`,
  `packages/web/src/lib/tournament-bridge.ts`, the marked proxy clauses and
  `packages/web/tests/tournament-bridge*.test.ts`. Remove the console's
  tournament invitation action and the auth return cookie and navigation code.
- Remove the marked schema block; separately plan deletion of
  `tournament_bridge_anonymised_user` and `user_profile_ids` from existing databases
  after the owner has handled member-ID retention/export needs. Removing the
  migration source alone does not drop persisted objects.
- Remove the three env entries, explicit web/Caddy Compose entries, the two
  marked Caddy host blocks and the tournament host/config verification cases.
  Keep `extra_hosts` because LiveKit also uses it.
- Remove this page, its docs index entry and the tournament host row in the
  domains page. Stop/remove the separate app only through its own repository.
- Rebuild shared, typecheck web and rerun account-deletion, proxy and domain
  routing tests. The existing engine, legacy file handling and UI work have
  separate owners and are outside this bridge's removal.
