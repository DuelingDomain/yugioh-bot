# Owner and admin

Owners are the users in `OWNER_USER_IDS` (application `users.id` values, comma separated). The app has no other admin role: creators manage their own drafts, tournaments and cubes. Everyone who is not an owner gets 404 on the owner pages and routes. Policy: `packages/shared/src/access/owner-access.ts` (`isOwnerUser`). Data flow: [architecture/data-flow.md](../architecture/data-flow.md).

## Entry points

| URL | What it is | Source (`packages/web/`) |
| --- | --- | --- |
| `/admin` | Admin console (full screen, own menu) | `app/(app)/admin/page.tsx`, `src/components/admin-console/` |
| `/admin/watch/duel/[slug]` | Read-only live watch of a duel | `app/(app)/admin/watch/duel/[slug]/page.tsx` |
| `/admin/watch/draft/[slug]` | Read-only live watch of a draft | `app/(app)/admin/watch/draft/[slug]/page.tsx` |
| `/settings/card-data` | Card data status | `app/(app)/settings/card-data/page.tsx` |
| `/settings/bug-reports` | Bug report list | `app/(app)/settings/bug-reports/page.tsx` |
| `/settings/bug-reports/[id]` | One bug report with all saved data | `app/(app)/settings/bug-reports/[id]/page.tsx` |

The sidebar shows these under "Admin" only for an owner (`src/components/layout/shell-model.ts`). `GET /api/admin/access` tells the page if the viewer is an owner.

## Admin console

Sections and their routes. Setup, keys and status rules: [deployment/admin-console.md](../deployment/admin-console.md).

| Section | Shows | Route |
| --- | --- | --- |
| Overview strip | Online now, live duels, pending waitlist, errors, sign-ups today, system | several below |
| Online now | Signed-in people seen in the last 2 minutes and their page | `GET /api/admin/console/online`, person: `GET .../people/[id]` |
| Waitlist | Pending sign-up requests, Approve or Reject | `GET /api/admin/console/waitlist`, `POST .../waitlist/[id]` |
| Live duels and drafts | Open and running tables and drafts, with Watch links | `GET /api/admin/console/live` |
| Duels today | Every duel since local midnight, with Replay or Watch | `GET /api/admin/console/today` |
| Stats | Sign-ups, active users, duels and drafts | `GET /api/admin/console/stats` |
| Errors | Sentry errors for 24 hours | `GET /api/admin/console/errors` |
| Usage | PostHog visitors and pages | `GET /api/admin/console/usage` |
| System | Version, card-data state, service health, disk | `GET /api/admin/console/system` |
| VPS health | CPU, RAM, load, engine workers, history | `GET /api/admin/console/vps-health` |

Approving a waitlist entry makes Clerk send the invite email. The person then follows [sign-in-and-access.md](sign-in-and-access.md#2-accept-the-invite).

## Live watch

1. In "Live duels and drafts" or "Duels today", the owner presses Watch.
2. Duel watch: `GET /api/admin/duels/[slug]/spectate?seat=public|0|1|2|3`. Neutral view or any seat, with hand and prompt, read only.
3. Draft watch: `GET /api/admin/drafts/[slug]/spectate?seat=<playerId>`. A player's pack, pool, picks, saved deck and timer.
4. Live refresh: `GET .../spectate/connection` gives a 60-second token for the `admin:spectate` ws room.

Watching never takes a seat, drives bots, settles clocks or counts as activity. An owner who sits in that live duel or draft cannot use watch; they use the player view. Each hidden seat view writes an `admin_spectate` row to `mod_actions`.

## Replays and Jump in

The owner sees every seat of a replay and can Jump in to a private replay fork. See [replays.md](replays.md#jump-in-owner-only).

## Card data page

`/settings/card-data` shows how current the card pools are: engine data, card catalog, and the gap between them. It calls `GET /api/admin/card-data-status`. The weekly data update is in [deployment/engine-data-updates.md](../deployment/engine-data-updates.md) and [runbooks/engine-data-update.md](../runbooks/engine-data-update.md).

## Bug report pages

1. `/settings/bug-reports` lists reports (`GET /api/admin/bug-reports`).
2. `/settings/bug-reports/[id]` shows `Report #<public_id>`, the submitter (user ID, username, email), page, time, text, duel, deck and all saved data.
3. Links on that page:

   | Link | Route |
   | --- | --- |
   | Open replay at this moment | `GET /api/admin/bug-reports/[id]/replay` (303 to the replay) |
   | Open duel replay | `/duels/[slug]/replay` |
   | Deck as `.ydk` | `GET /api/admin/bug-reports/[id]/deck` |
   | All saved data (JSON) | `GET /api/admin/bug-reports/[id]` |

Replays and Jump in work only after the duel ends. How reports are made: [bug-reports.md](bug-reports.md).

## Draft cancel

An owner can cancel any draft, including a private one without a seat: `POST /api/drafts/[slug]/cancel`. See [cubes-and-drafts.md](cubes-and-drafts.md#cancel-rule).

## Owner CLI

Owner jobs that change accounts or seasons run on the VM as `npm run ops -- <command>` (`packages/worker/src/ops/cli.ts`). Every command is a dry run unless you add `--apply`. Each run writes a JSON report (mode 0600). `DATABASE_PATH` must be absolute.

| Command | What it does |
| --- | --- |
| `season status` / `season start [--name <text>] [--actor <usersId>]` / `season end` | Show, start or end the one app-wide season (uses `DISCORD_GUILD_ID`) |
| `merge-users --source <usersId> --target <usersId>` | Merge two accounts. Stop writers and revoke the source's Clerk sessions first |
| `clerk-precreate-users [--skip-legal-checks] [--check-remote]` | Create Clerk accounts for existing users with a verified email |
| `clerk-reconcile-waitlist [--notify or --no-notify] [--check-remote]` | Bring the local waitlist and the Clerk waitlist into line |
| `delete-user --user-id <usersId> [--skip-clerk]` | Delete the Clerk user, then anonymise or remove the rows. Safe to run again |

`--check-remote` allows Clerk reads but never Clerk writes. Remote checks and `--apply` need `CLERK_SECRET_KEY`. Run `npm run ops -- --help` for the full text.

## Change the owner list

Set `OWNER_USER_IDS` for web, ws and duel, then restart all three. Session and identity caches mean a removal may not act at once.
