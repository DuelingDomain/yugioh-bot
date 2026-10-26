# Domains

Live since 2026-10-06. Contact: `support@duelingdomain.com`. Server: Nuremberg, Germany.

## Hosts

| Hostname | Serves or redirects to |
| --- | --- |
| `duelingdomain.com` | Static marketing site; returning members' home GETs get a 302 to the app (details below) |
| `www.duelingdomain.com` | 308 to `https://duelingdomain.com`, preserving path and query |
| `app.duelingdomain.com` | App and Socket.IO |
| `www.app.duelingdomain.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |
| `duelistskingdom.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |
| `www.duelistskingdom.com` | 308 to `https://app.duelingdomain.com`, preserving path and query |

A plan to put the Cloudflare Free plan in front of these hosts is in [cloudflare.md](cloudflare.md). Until the owner changes DNS, nothing here changes.

## Env

Compose reads production `.env` and passes the host variables to Caddy. See [vm-runbook.md](vm-runbook.md#create-env) for editing it:
```dotenv
SITE_DOMAIN=app.duelingdomain.com
MARKETING_DOMAIN=duelingdomain.com
LEGACY_DOMAIN=duelistskingdom.com
MARKETING_URL=https://duelingdomain.com
WEB_URL=https://${SITE_DOMAIN}
```
After `.env` edits, run `docker compose -f docker-compose.yml up -d --no-build`. After Caddyfile edits, run `docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate caddy`; `restart` does not refresh the bind mount.
Discord OAuth redirects to `https://app.duelingdomain.com/api/auth/callback/discord`; the old domain's callback remains registered for rollback.

## Analytics routing

The app and marketing host blocks import the same `(posthog_ingest)` Caddy snippet before their app/static fallbacks. `/ingest/static/*` goes to `https://eu-assets.i.posthog.com`; `/ingest` and other `/ingest/*` requests go to `https://eu.i.posthog.com`. Caddy strips the `/ingest` prefix and removes Cookie, Authorization and Referer upstream. These anonymous requests bypass Next.js authentication.

## Marketing host behaviour

- Static files come from `site/public`, mounted read-only at `/srv/site`.
- Only `GET /` and `GET /index.html` with `dd_signed_in=1` return 302 to `https://app.duelingdomain.com/`. Adding `?home=1` serves the marketing page even with the hint. Home responses carry `Vary: Cookie` and `Cache-Control: private, no-store`.
- Clean `/privacy` and `/terms` resolve to their HTML files.
- `/robots.txt` allows the public marketing pages and links to the sitemap. The sitemap lists only the canonical home, privacy and terms URLs, with dates updated when their content changes.
- `/llms.txt` serves a short product overview and public source links as `text/plain; charset=utf-8`, using the static file cache policy. It is optional context for agents; Google does not require it for AI Search features.
- Only exact `POST /api/waitlist` is proxied to the app; other APIs and socket paths return 404.
- `/login` returns 302 to `https://app.duelingdomain.com/login`.
- Missing files and direct `/404` or `/404.html` requests use `404.html` with status 404, `X-Robots-Tag: noindex` and `Cache-Control: no-store`. The HTML also carries `noindex`.
- Static responses negotiate Zstandard or gzip compression. Home HTML stays `private, no-store`; other static files revalidate after five minutes, images cache for a day and versioned font files for a year.
- CSP restricts resources to self (data images and inline styles allowed), forbids framing, and uses self-hosted fonts. HSTS is `max-age=31536000`, without `includeSubDomains` or `preload`.

| Marketing request | Behaviour |
| --- | --- |
| `GET /` or `/index.html`, `dd_signed_in=1` | 302 to app `/`; an active Clerk session resumes and app `/` redirects to `/dashboard` |
| Same GET, hint absent, cleared, `0` or any other value | Static marketing page |
| Same GET, stale hint but no active app session | 302 to app, then app `/sign-in?redirect_url=%2F`; no automatic return to marketing |
| Same GET with `?home=1`, any cookie state | Static marketing page |
| `HEAD` or other methods, legal pages, assets, waitlist or any other path | Existing routing and caching rules |

The app owns `dd_signed_in`: its Clerk state observer sets the non-HttpOnly hint to `1` on `.duelingdomain.com` (`Path=/`, `Secure`, `SameSite=Lax`, 30-day maximum age) after Clerk loads a signed-in session, and clears it on sign-out when Clerk reports that state. Account deletion also explicitly clears it before Clerk sign-out and before fallback navigation, without waiting for a signed-out update. Hint writes and clearing only run on `https://app.duelingdomain.com`, outside isolated E2E mode. It carries no user ID or token and does not authenticate app requests. Existing sessions need one app visit after deployment to seed the hint; blocked JavaScript or cookies leave visitors on marketing with the existing login link.

App links and account-deletion redirects to the marketing home include `?home=1`, so a stale hint cannot bounce a person back to the app. Waitlist links keep the fragment after the query (`/?home=1#join`); existing query parameters are preserved.

The installed SDKs identify `__client_uat` and instance-suffixed variants, but do not define the production Frontend API's domain/HttpOnly attributes for these cookies. Offline inspection cannot confirm that they reach `duelingdomain.com`; the app-owned hint makes this routing independent of those attributes. After deployment, inspect cookie attributes and request cookie **names** in browser tools without copying tokens or secrets. Check sign-in, sign-out, the escape hatch, and a stale hint with an inactive session. App and Caddy changes must deploy together.

## Web-only restarts during live duels

The app host's `web:3000` proxy holds requests for up to 30 seconds while no
upstream is available (`lb_try_duration 30s`, `lb_try_interval 250ms`). Passive
health tracking remembers a failed connection for one second, so concurrent
requests wait briefly before dialing again. No active probe depends on app
authentication. Socket.IO still goes directly to `ws:3001`; a web-only recreate
does not close its existing connections. Marketing and legacy routing are unchanged.

When the 30 seconds end and web or ws is still down, Caddy shows the maintenance
page (`site/maintenance/index.html`, status 503) to browser page loads and a JSON
error to API and Socket.IO callers. The page checks `/healthz` and reloads when web
is back. See [cloudflare.md](cloudflare.md#maintenance-pages).

POST safety follows Caddy's default `lb_retry_match` (GET only). A POST can be
retried after a **dial failure**, when the upstream received no request; a failed
round trip after connecting is not replayed. An upstream 503 response is passed
back rather than retried by this proxy. Do not broaden `lb_retry_match` to POST.
See [Caddy's retry rules](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#load-balancing)
and [the dial-error check in Caddy 2.11.2](https://github.com/caddyserver/caddy/blob/v2.11.2/modules/caddyhttp/reverseproxy/reverseproxy.go).
The integration check below exercises a real 20-second upstream outage, one
delivery of the held POST, and a connected POST whose response is dropped.

The duel page also retries room GETs and `/actions` on network errors, proxy
502/503/504, or the web adapter's `DUEL_UPSTREAM_UNAVAILABLE` response. Backoff
runs from 250ms to 3s, with a 30-second window for starting retries. Each attempt
can finish within 60 seconds, allowing Caddy's 30-second hold plus engine work;
an action timeout re-fetches the authoritative room instead of reporting a
failed move. Aborted body reads propagate to recovery, and leaving the room
aborts pending requests and backoff timers.

The existing connection badge shows `Reconnecting` for an action retry or after
background reads have failed continuously for three seconds. Brief background
failures keep menus, effects and the live badge unchanged. The board stays up
during recovery, and exhaustion shows the existing error. 401/403 access
denials, explicit access-unavailable errors (including 503), engine errors
(`DUEL_ENGINE_ERROR`), missing configuration/secret mismatches
(`DUEL_ENGINE_CONFIG`), illegal moves and stale choices fail immediately.
Other POSTs (opening, response
switch, surrender, deck changes, etc.) are not automatically retried by the client.

An action's existing `(duel, seat, promptId, revision)` is its retry identity;
the same serialized command is reused for every attempt. The duel host runs each
duel's commands in one queue. Its revision/prompt check prevents a second engine
answer, and its durable accepted-command journal now recognizes an exact replay
(including the answer) and returns current state, even if the original reply was
lost or the duel has since ended. Another answer or seat cannot claim that result.
Replay-fork actions are excluded from automatic retries because a fork rewind or
restart can reuse prompt/revision identities; their GETs still retry safely.
No new nonce or in-memory deduplication cache is needed. State reads re-fetch the
authoritative room; existing polling and token/join retries resume live updates
after web returns without a page reload. Duel clocks keep running during an outage.

Deploy the duel-host replay handling and web client together through the existing
guarded workflow, and install the Caddy change before relying on this protection.
After editing only web runtime env, recreate only web:

```bash
docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate web
```

This covers short **web-only** outages with duel, ws and Caddy still running.
The current `.github/workflows/deploy.yml` checks activity again immediately
before stopping **web, duel, worker and ws**, then migrates/installs resources and
runs `compose down --remove-orphans` before starting the stack. That also stops
Caddy and can replace the engine bundle. Keep its live-duel idle guard unchanged:
this hold cannot protect a stopped proxy or make engine/schema changes safe.
A future deploy path restricted to web, with no shared schema/bundle or other
service changes, could assess relaxing its own guard after restart validation.

## Checks

Routing checks need Docker and a preloaded `caddy:2.11.2-alpine` image; they never pull an image. They validate/adapt the real Caddyfile and exercise cookie/query/method cases against Caddy. Browser checks need local Caddy with `SITE_DOMAIN=localhost`, `MARKETING_DOMAIN=marketing.localhost`, `LEGACY_DOMAIN=legacy.localhost`, plus Playwright and Chromium. Production curls use normal TLS validation and do not follow redirects.
```bash
python3 -I site/src/verify-static.py
python3 -I scripts/deployment/verify-domain-routing.py
python3 -I scripts/deployment/verify-web-restart.py
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium SHOTS_DIR=/tmp/dd-site-shots node site/src/verify-browser.mjs
curl -sS -i https://duelingdomain.com/
curl -sS -i https://duelingdomain.com/ -H 'Cookie: dd_signed_in=1'
curl -sS -i 'https://duelingdomain.com/index.html?home=1' -H 'Cookie: dd_signed_in=1'
curl -sS -i https://www.duelingdomain.com/privacy
curl -sS -i https://app.duelingdomain.com/robots.txt
curl -sS -i https://www.app.duelingdomain.com/path
curl -sS -i 'https://duelistskingdom.com/draft/example?from=shared-link'
curl -sS -i 'https://www.duelistskingdom.com/draft/example?from=shared-link'
curl -sS -i https://duelingdomain.com/login
curl -sS -i https://duelingdomain.com/api/waitlist -H 'Content-Type: application/json' --data '{"email":"test@example.com","company":"verification"}'
```

**Rollback:** Restore the pre-cutover `.env` backup; clear `MARKETING_DOMAIN` and `LEGACY_DOMAIN` before restoring the old `SITE_DOMAIN`.
Run `docker compose -f docker-compose.yml up -d --no-build`, then `docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate caddy`.
Do not restore the database; keep the new waitlist signups.

**Waitlist:** SQLite stores unique normalized email, ISO `created_at`, source (default `form`, max 80 characters), and nullable user agent (max 300); no IP is persisted in SQLite or application logs.
Rate limit: 5 supported attempts per IP per process per 10 minutes, including honeypots; in memory, reset by restart. A filled honeypot returns success without storing a signup.
Handle deletion requests through the contact mailbox within 30 days; delete waitlist emails by the end of alpha, including exports and backups. Protect exports and set `WAITLIST_DB` to the absolute production SQLite path:
```bash
sqlite3 -header -csv "$WAITLIST_DB" 'select email, created_at from waitlist_signups order by created_at;' > waitlist.csv
```
**Search engines:** The owner reports that Google Search Console is now verified. Retain its verification record. After deploying the marketing changes, submit `https://duelingdomain.com/sitemap.xml` under Sitemaps, then use URL Inspection for `https://duelingdomain.com/`, run Test live URL and choose Request indexing. Check the selected canonical and Page indexing reports as Google recrawls. Import the verified property in Bing Webmaster Tools using Import from Google Search Console, confirm the apex host, and submit the same sitemap there.

The app's Caddy-served `/robots.txt` allows crawling (`User-agent: *`, `Allow: /`), while every app response retains `X-Robots-Tag: noindex, nofollow`, including public sign-in pages and authentication redirects. [Google requires crawlers to see noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing); `Disallow: /` would prevent that and could leave linked app URLs in search. Authentication still protects private content. Do not add app URLs to the marketing sitemap or request app indexing. If app URLs already appear in search, use a Search Console property covering the app to inspect the header and monitor exclusion after recrawl; use temporary removals only when immediate removal is needed.

The reported Safe Browsing "Deceptive pages" issue is separate from indexing and trust copy. After the sign-in remediation is deployed and checked, the owner should review the affected URLs in Search Console's Security issues report and request a review. Publishing contact details or changing robots rules does not by itself resolve that classification.

**Clerk:** The app signs in through Clerk (application "Dueling Domain"); there is no NextAuth origin or web Discord credential left.
- **Instances:** development (`ins_3KLXWtn1cgAToznzTpN0azZeq2k`, dev keys only in an ignored `packages/web/.env.local`), and production on `app.duelingdomain.com`. Staging is removed. A future staging server needs its own Clerk instance, keys and HTTPS origin. Never copy keys or Clerk user IDs between instances. Scrub `clerk_user_id` from a database before you copy it to another instance.
- **DNS:** creating the production instance lists the exact CNAME records (Frontend API, accounts, and the email DKIM/return-path records). Add each in Namecheap, wait for Clerk to show them verified, and record the readback here before deploying.
- **Keys:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is the repository variable `vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (must be `pk_live_*`) and a web build arg only. `CLERK_SECRET_KEY` is web runtime only; owner commands get it explicitly with `docker compose run --rm --no-deps -e CLERK_SECRET_KEY worker ...`.
- **Env:** `WEB_URL=https://app.duelingdomain.com` (web links and WS CORS), `MARKETING_URL=https://duelingdomain.com`, `OWNER_USER_IDS` (owner-only pages), `DISCORD_BOT_ENABLED=0`.
- **Discord sign-in:** production uses our own Discord application. Add Clerk's Discord redirect URI from the dashboard to that application's OAuth2 redirects; the app's own return page is `/sso-callback`. Keep the old NextAuth callback in place until the rollback window ends.
- **Dashboard settings:** waitlist sign-up mode; email + password with email code; username required; legal consent with `https://duelingdomain.com/terms` and `/privacy`; 30-day sessions; bot protection on; passkeys, passwordless and phone off; **"Allow users to delete their accounts" off** (the app's own deletion also anonymises the database). Waitlist and invitation emails use our wording.
- **Before the switch:** publish the updated privacy page; back up the database; stop writers; run the import and waitlist reconcile as dry runs, then for real (`npm run ops -- clerk-precreate-users`, `clerk-reconcile-waitlist`).
- **After the switch:** sign-in page 200, anonymous `/api/auth/session` 200 `null`; sign in by email and by Discord; accept an invitation; sign out and back in; open the account page; check WS updates and worker timers with the bot absent.
- **Rollback:** redeploy the PR 1 images and env (NextAuth origin, bot service and switch, one worker). Keep the database and the Clerk accounts for a later retry; do not restore an older database.
