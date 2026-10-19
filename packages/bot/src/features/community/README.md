# Community commands

Implementation plan (owner-approved scope in `bot-phase1-common.md` and `discord-bot-plan.md`):

1. Add integration coverage with real migrated SQLite, the real dispatcher/adapters and a local Discord HTTP/Gateway stub. No unit tests.
2. Add `/announce`: an optional slash-command role selector (Discord's server-role list), then a title/body/HTTPS-image modal; an actor-bound, one-use Post/Cancel preview that expires in 60 seconds. Check admin access at every step and role hierarchy at selection and posting. Post to the configured same-guild text/announcement channel, crosspost announcement messages, and record the result through the shared audit/outbox API.
3. Add `/card`: bounded catalog queries plus a read-only, cached engine CDB reader; include previews based on the engine's `ot & 0x100` flag or `card_catalog.is_prerelease`. Public reply, five requests per user per 30 seconds. Load only the duel-server banlist module when available; otherwise state that TCG status is unavailable.
4. Add `/online` and `/stats`: direct SQLite readers with the exact definitions in `origin/feat/admin-console-live-stats` (`5a2bfb54f`) and `origin/feat/admin-console` (`e49ee6339`). Guard missing presence columns. Keep the 500-user/100-live-row limits and UTC/weekly distinct-user semantics.
5. Run the feature integration tests, Phase 0 bot tests, bot typecheck and build; review the diff, commit with the required trailer, and push `feat/discord-bot-community`. No PR.

## Configuration and access

- `DISCORD_ANNOUNCE_CHANNEL_ID`: destination for announcements. The bot needs View Channel, Send Messages and Embed Links; publishing its own message uses those same permissions. View Channel and Send Messages are also needed in `DISCORD_MOD_LOG_CHANNEL_ID`.
- Admin commands require the linked site user to be in `OWNER_USER_IDS`. Discord's Administrator command default is a second visibility gate, not an alternative to the site allow-list. `/card` is public in the configured guild.
- Announcement role choice defaults to none. `@everyone`, managed roles, and roles at or above either the actor or bot are refused. A non-mentionable role also requires the bot's Mention Everyone permission. All mention parsing is disabled. Only a role explicitly selected and confirmed by the admin is allowed in the announcement's `allowed_mentions.roles`; preview, card, audit and other replies never allow mentions.
- Card embeds use public image URLs: YGOPRODeck `https://images.ygoprodeck.com/images/cards/<passcode>.jpg` for normal catalog cards; Project Ignis `https://pics.projectignis.org:2096/pics/<passcode>.jpg` for pre-release or engine-only cards. No site sign-in or `SITE_DOMAIN` setting is needed. The current site has no card detail page, so no card page link is emitted.
- `DUEL_DATA_DIR` selects the engine bundle; otherwise it is `duel-engine` beside the shared SQLite file. Missing engine data falls back to the catalog. No card network API is queried.
- The bot-only Docker image does not include the duel-server package. It therefore reports TCG status as unavailable. A source/dev installation or a deployment with the lightweight duel-server banlist module can use that module without loading the engine. No banlist data is copied or maintained here.
- Before the admin-console presence migration is deployed, `/online` says "presence not available"; `/stats` still counts play activity and labels the missing presence contribution.

## Data definitions

Online = latest server-recorded presence within 120 seconds, capped at 500 users. Only stored route templates are mapped to labels. Duel routes use the user's newest play lobby/active table for the format label, as in the console.

Statistics cover seven UTC days ending today. Sign-ups use `users.created_at`. Started duels include a `started_at` or active/completed/interrupted status; only completed duels count as finished. Replay forks are excluded. Drafts use `started_at` and completed `ended_at`. Active users are distinct site users in started duels/drafts or with their latest presence on that day; weekly users are a union, not a sum. Past presence cannot reconstruct earlier visits.

Live rows use the console's query limits and filters: same guild, play duels, no archived rows, no idle active/lobby tables past 10 minutes, no empty lobbies; pending drafts older than 24 hours are excluded, active drafts are retained. Up to 100 rows per kind are included. The report distinguishes active tables from waiting lobbies.

## Public card images

The site card-image route remains protected. The integration uses direct public image URLs and removes the unused web-access patch.

## Verification

Node 22.23.3; `npm run test --workspace=packages/bot`: 48 tests passed (17 community integration checks plus 31 existing bot checks). Bot typecheck and build passed. The `.mts` integration file also passed an explicit strict TypeScript check with `--ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck` so production builds do not contain tests. The stats computation matches the console source exactly except for the presence-column guard; the copied presence route labels match exactly. Generated bot/shared build output was removed.
