# Domains

Live since 2026-10-06. Contact: `support@duelingdomain.com`. Server: Nuremberg, Germany.

## Hosts

| Hostname | Serves or redirects to |
| --- | --- |
| `duelingdomain.com` | Static marketing site |
| `www.duelingdomain.com` | 308 to `https://duelingdomain.com`, preserving path and query |
| `app.duelingdomain.com` | App and Socket.IO |
| `www.app.duelingdomain.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |
| `duelistskingdom.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |
| `www.duelistskingdom.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |

## Env

Compose reads production `.env` and passes the host variables to Caddy. See [vm-runbook.md](vm-runbook.md#create-env) for editing it:
```dotenv
SITE_DOMAIN=app.duelingdomain.com
MARKETING_DOMAIN=duelingdomain.com
LEGACY_DOMAIN=duelistskingdom.com
MARKETING_URL=https://duelingdomain.com
NEXTAUTH_URL=https://${SITE_DOMAIN}
WEB_URL=https://${SITE_DOMAIN}
```
After `.env` edits, run `docker compose -f docker-compose.yml up -d`. After Caddyfile edits, run `docker compose -f docker-compose.yml up -d --no-deps --force-recreate caddy`; `restart` does not refresh the bind mount.
Discord OAuth redirects to `https://app.duelingdomain.com/api/auth/callback/discord`; the old domain's callback remains registered for rollback.

## Marketing host behaviour

- Static files come from `site/public`, mounted read-only at `/srv/site`.
- Clean `/privacy` and `/terms` resolve to their HTML files.
- Only exact `POST /api/waitlist` is proxied to the app; other APIs and socket paths return 404.
- `/login` returns 302 to `https://app.duelingdomain.com/login`.
- Missing files use `404.html` with status 404 and `Cache-Control: no-store`.
- CSP restricts resources to self (data images and inline styles allowed), forbids framing, and uses self-hosted fonts. HSTS is `max-age=31536000`, without `includeSubDomains` or `preload`.

## Checks

Routing checks need Docker. Browser checks need local Caddy with `SITE_DOMAIN=localhost`, `MARKETING_DOMAIN=marketing.localhost`, `LEGACY_DOMAIN=legacy.localhost`, plus Playwright and Chromium. Production curls use normal TLS validation and do not follow redirects.
```bash
python3 site/src/verify-static.py
python3 scripts/deployment/verify-domain-routing.py
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium SHOTS_DIR=/tmp/dd-site-shots node site/src/verify-browser.mjs
curl -sS -i https://duelingdomain.com/
curl -sS -i https://www.duelingdomain.com/privacy
curl -sS -i https://app.duelingdomain.com/robots.txt
curl -sS -i https://www.app.duelingdomain.com/path
curl -sS -i 'https://duelistskingdom.com/draft/example?from=shared-link'
curl -sS -i 'https://www.duelistskingdom.com/draft/example?from=shared-link'
curl -sS -i https://duelingdomain.com/login
curl -sS -i https://duelingdomain.com/api/waitlist -H 'Content-Type: application/json' --data '{"email":"test@example.com","company":"verification"}'
```

**Rollback:** Restore the pre-cutover `.env` backup; clear `MARKETING_DOMAIN` and `LEGACY_DOMAIN` before restoring the old `SITE_DOMAIN`.
Run `docker compose -f docker-compose.yml up -d`, then `docker compose -f docker-compose.yml up -d --no-deps --force-recreate caddy`.
Do not restore the database; keep the new waitlist signups.

**Waitlist:** SQLite stores unique normalized email, ISO `created_at`, source (default `form`, max 80 characters), and nullable user agent (max 300); no IP is persisted in SQLite or application logs.
Rate limit: 5 supported attempts per IP per process per 10 minutes, including honeypots; in memory, reset by restart. A filled honeypot returns success without storing a signup.
Handle deletion requests through the contact mailbox within 30 days; delete waitlist emails by the end of alpha, including exports and backups. Protect exports and set `WAITLIST_DB` to the absolute production SQLite path:
```bash
sqlite3 -header -csv "$WAITLIST_DB" 'select email, created_at from waitlist_signups order by created_at;' > waitlist.csv
```
**Search engines (still to do):** Create a Search Console Domain property and a Bing Webmaster property.
Add each tool's exact verification TXT record in Namecheap; retain the records after verification.
Submit `https://duelingdomain.com/sitemap.xml` to both tools; check canonical selection and indexing. The private app stays excluded from search.

**Clerk:** The app signs in through Clerk (application "Dueling Domain"); there is no NextAuth origin or web Discord credential left.
- **Instances:** development (`ins_3KLXWtn1cgAToznzTpN0azZeq2k`, dev keys only in an ignored `packages/web/.env.local`), production on `app.duelingdomain.com`, and a separate staging instance with its own keys and HTTPS origin. Never copy keys or Clerk user IDs between instances; staging scrubs `clerk_user_id` from copied databases.
- **DNS:** creating the production instance lists the exact CNAME records (Frontend API, accounts, and the email DKIM/return-path records). Add each in Namecheap, wait for Clerk to show them verified, and record the readback here before deploying.
- **Keys:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the repository variable `vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (must be `pk_live_*`) and a web build arg only. `CLERK_SECRET_KEY` is web runtime only; owner commands get it explicitly with `docker compose run --rm --no-deps -e CLERK_SECRET_KEY worker ...`.
- **Env:** `WEB_URL=https://app.duelingdomain.com` (web links and WS CORS), `MARKETING_URL=https://duelingdomain.com`, `OWNER_USER_IDS` (owner-only pages), `DISCORD_BOT_ENABLED=0`.
- **Discord sign-in:** production uses our own Discord application. Add Clerk's Discord redirect URI from the dashboard to that application's OAuth2 redirects; the app's own return page is `/sso-callback`. Keep the old NextAuth callback in place until the rollback window ends.
- **Dashboard settings:** waitlist sign-up mode; email + password with email code; username required; legal consent with `https://duelingdomain.com/terms` and `/privacy`; 30-day sessions; bot protection on; passkeys, passwordless and phone off; **"Allow users to delete their accounts" off** (the app's own deletion also anonymises the database). Waitlist and invitation emails use our wording.
- **Before the switch:** publish the updated privacy page; back up the database; stop writers; run the import and waitlist reconcile as dry runs, then for real (`npm run ops -- clerk-precreate-users`, `clerk-reconcile-waitlist`).
- **After the switch:** sign-in page 200, anonymous `/api/auth/session` 200 `null`; sign in by email and by Discord; accept an invitation; sign out and back in; open the account page; check WS updates and worker timers with the bot absent.
- **Rollback:** redeploy the PR 1 images and env (NextAuth origin, bot service and switch, one worker). Keep the database and the Clerk accounts for a later retry; do not restore an older database.
