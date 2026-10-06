# Dueling Domain cutover

Status on 2026-10-05: `duelingdomain.com` is registered at Namecheap. DNS still points to a parking page.
The owner controls DNS and production cutover; this work changes neither. `SITE_DOMAIN` stays the app hostname.
Blank/unset `MARKETING_DOMAIN` and `LEGACY_DOMAIN` use `marketing-disabled.localhost` and
`legacy-disabled.localhost` through Compose and Caddy defaults. These reserved local names use Caddy's local CA,
not public ACME ([Caddy hostname requirements](https://caddyserver.com/docs/automatic-https#hostname-requirements)).
They are local virtual hosts, not disabled blocks; never point public DNS at them.

**Intentional change before cutover:** the current production `SITE_DOMAIN` also receives
`X-Robots-Tag: noindex, nofollow`, and Caddy answers `/robots.txt` with `User-agent: *` / `Disallow: /` without app
authentication. This is intended because the app is private. All legacy-host requests, including robots, keep
308 redirects to the app, preserving path and query. Robots directives do not replace authentication.

## Ordered checklist — owner performs external changes

1. Record the current deployed commit, current app hostname and image versions. Save a protected copy of the
   production `.env` and back up SQLite using the VM runbook's online backup procedure. Keep ownership and
   renewal of the old domain; it will keep serving legacy links.
2. Complete the privacy confirmations in `site/public/privacy.html`: operator legal identity, monitored public
   privacy mailbox/business contact address, and Hetzner contracting name, VM region and security-log retention.
   Confirm the 30-day deletion and end-of-alpha cleanup processes, including exports/backups and invite lists.
   Run `python3 site/src/self-host-fonts.py` from a machine with HTTPS access, then the checks below. Until then,
   Google Fonts is deliberately retained and disclosed under the sandbox fallback; do not claim fonts are local.
3. In Namecheap, replace parking records with VM A records for `duelingdomain.com`, `www.duelingdomain.com`,
   `app.duelingdomain.com` and `www.app.duelingdomain.com`. Add AAAA only with working public IPv6; remove stale
   AAAA records. A `www` CNAME to its appropriate host is also suitable. Preserve old-domain apex/`www` DNS to the
   VM. Allow TCP 80/443 (UDP 443 optional). Verify propagation before enabling hosts.
4. Coordinate with the separate Clerk/auth work before changing app origins. It owns production Clerk DNS,
   email SPF/DKIM records, optional Discord OAuth redirects, credentials, sign-in policy and auth environment
   variables. Use the exact records and callback URLs from its production dashboard/runbook; do not reuse a
   historical auth callback path by assumption. Retain the previous working auth configuration through the
   rollback window. Clerk handles app accounts and alpha invite emails; the marketing POST only stores signups.
5. Set the following routing values in the protected production `.env`:

   ```dotenv
   SITE_DOMAIN=app.duelingdomain.com
   MARKETING_DOMAIN=duelingdomain.com
   LEGACY_DOMAIN=<previous production app hostname from the backup>
   WEB_URL=https://app.duelingdomain.com
   NEXT_PUBLIC_WS_URL=
   ```

   `WEB_URL` controls bot links. An empty `NEXT_PUBLIC_WS_URL` uses the app's origin, but it is a build-time variable:
   rebuild if an old origin was baked in. Until the auth work updates Compose, ws CORS is derived from
   `NEXTAUTH_URL`; that origin must agree with the app. The auth owner must reconcile `NEXTAUTH_URL`/`AUTH_URL`
   and their replacement settings before deployment. Routing variables alone do not migrate authentication.
6. Complete Docker routing checks and browser checks with the final combined auth/site changes. Ensure the
   `site/public` directory exists on the VM and is mounted read-only at `/srv/site`. It now includes privacy,
   sitemap, manifest and mark PNGs. Deploy through the existing Deploy workflow only after owner review/merge.
   The workflow recreates Caddy, refreshing its single-file Caddyfile mount after git replaces its inode.
   For an approved manual Caddy/static-only update, recreate it explicitly:

   ```bash
   docker compose -f docker-compose.yml up -d --no-deps --force-recreate caddy
   ```

   A `restart` or in-container `reload` alone can retain the old file inode. Preserve the VM runbook's deployment
   and active-game precautions. No deployment workflow changes are needed for this site.
7. Run the production checks below. In a browser, verify anonymous marketing, both JS and native-form waitlist
   submissions, the final Clerk email/password and optional Discord sign-in paths, access policy and Socket.IO
   updates. Expect users to sign in again on the new host; do not broaden cookie domains to avoid that.
8. Retain old-domain DNS/certificates and redirects permanently for shared links. Remove obsolete auth callback
   configuration only after the owner confirms the migration is stable. Follow `site/SEO.md` for owner-managed
   Search Console and Bing verification TXT records in Namecheap, then submit the sitemap.

## Local preview and response policy

Use `SITE_DOMAIN=localhost`, `MARKETING_DOMAIN=marketing.localhost`, and `LEGACY_DOMAIN=legacy.localhost` in the
local stack. Recreate Caddy after config edits. Trust its local CA in the browser if needed; `-k` is local-only:

```bash
docker compose up -d --no-deps --force-recreate caddy
curl -ki --resolve marketing.localhost:443:127.0.0.1 https://marketing.localhost/privacy
curl -ki --resolve localhost:443:127.0.0.1 https://localhost/robots.txt
```

Marketing `/login` redirects to the app. Only exact `POST /api/waitlist` is proxied; other APIs and socket paths
are static misses. `try_files {path} {path}.html {path}/index.html =404` serves clean `/privacy`. Missing resources
return the shared 404 page with status 404 and `Cache-Control: no-store`.

HTML/CSS/JS, robots, sitemap and manifest retain `public, max-age=300, must-revalidate`; images retain one day.
WOFF2 files under `/fonts/` cache for one year. The manifest explicitly uses `application/manifest+json`.
Marketing responses add `Strict-Transport-Security: max-age=31536000`, with neither `includeSubDomains` nor
`preload`. Existing nosniff, referrer and frame headers remain.

After local-font setup, the marketing CSP is:

```text
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Inline styles are currently needed by SVG ring/sparkle attributes and JS-generated dust styles; executable scripts
are external and deferred. JSON-LD is inert data. While the documented font fallback is active, `style-src` also
permits the Google Fonts stylesheet origin and `font-src` permits its font origin. `self-host-fonts.py` removes both
exceptions and updates the privacy disclosure together with the fonts. The marketing CSP never applies to the app;
Clerk's own resource/cookie requirements belong to the auth work.

## Repeatable verification

```bash
python3 site/src/verify-static.py
docker pull caddy:2-alpine
python3 scripts/deployment/verify-domain-routing.py | tee /tmp/dueling-domain-routing.txt
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium node site/src/verify-browser.mjs
```

The routing script runs the real Caddyfile through `caddy validate`, `caddy adapt`, temporary static fixtures and
web/ws stub upstreams. It reads the real sitemap, manifest and marketing robots into fixtures; it writes nothing
in the repo. It prints every curl and full response. Checks include `/privacy`, sitemap URLs, manifest MIME type,
font caching, CSP/HSTS, custom 404, ETag/304, exact waitlist routing, app robots/noindex (including an auth redirect),
legacy robots redirects, and HTTP/canonical redirects.

Its **21 unset-variable baseline comparisons** allow only the new app noindex header and Caddy-served robots body
and length. Date/Alt-Svc are ignored because they vary per run. The original app/socket routes and `www`/HTTP
redirects are still compared. Temporary containers/network are removed; logs and adapted JSON remain in the
printed `/tmp/dueling-domain-caddy-*` directory.

For standalone config checking without public hosts:

```bash
docker run --rm -e SITE_DOMAIN=localhost -e MARKETING_DOMAIN=marketing.localhost -e LEGACY_DOMAIN=legacy.localhost -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
docker run --rm -e SITE_DOMAIN=localhost -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --pretty
```

Sandbox results on 2026-10-05: static checks and syntax checks passed. Font download failed on DNS resolution.
Docker failed at `docker info`: `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`.
Chromium failed during startup: `setsockopt: Operation not permitted`, then SIGTRAP. **No Caddy runtime or browser
pass is claimed.** The orchestrator must run these checks; `site/VERIFICATION.md` lists exact screenshot states.

## Production checks after owner cutover

Use normal certificate validation, without `-k`. Inspect redirects without following them:

```bash
curl -sS -i https://duelingdomain.com/
curl -sS -i https://duelingdomain.com/privacy
curl -sS -i https://duelingdomain.com/sitemap.xml
curl -sS -i https://duelingdomain.com/site.webmanifest
curl -sS -i https://duelingdomain.com/robots.txt
curl -sS -i https://duelingdomain.com/missing/deep/path
curl -sS -i https://duelingdomain.com/login
curl -sS -i https://duelingdomain.com/api/anything-else
curl -sS -i https://duelingdomain.com/socket.io/
curl -sS -i https://www.duelingdomain.com/privacy
curl -sS -i https://app.duelingdomain.com/
curl -sS -i https://app.duelingdomain.com/robots.txt
curl -sS -i https://www.app.duelingdomain.com/path
curl -sS -i 'https://app.duelingdomain.com/socket.io/?EIO=4&transport=polling'
curl -sS -i http://duelingdomain.com/privacy
curl -sS -i http://app.duelingdomain.com/
# Set this from the protected pre-cutover record, not the new app hostname.
curl -sS -i "https://${PREVIOUS_SITE_DOMAIN}/draft/example?from=shared-link"
curl -sS -i "https://${PREVIOUS_SITE_DOMAIN}/robots.txt"
# Honeypot proves anonymous routing without inserting a fake signup.
curl -sS -i https://duelingdomain.com/api/waitlist -H 'Content-Type: application/json' --data '{"email":"test@example.com","company":"verification"}'
curl -sS -i https://duelingdomain.com/api/waitlist --data 'email=test%40example.com&company=verification'
```

Expected: index/privacy/assets 200; missing pages, other APIs and socket paths 404; marketing `/login` 302 to app;
marketing `www` 308 to apex. Marketing has the headers/cache policy above. App signed-out `/` reaches the final
auth flow with noindex; app robots is 200 plain text with `Disallow: /` and noindex, never a login redirect.
Legacy is always 308 to the app with path/query intact, including robots. Honeypot JSON returns 201
`{"status":"joined"}`; native form returns 303 `Location: /?waitlist=joined#join`. Submit one owner-controlled real
email and repeat a case/whitespace variant to verify duplicate 200/`exists` and persistence. The browser harness
mocks submissions, so it does not prove storage or invite delivery.

## Rollback

1. Restore origins/auth variables from the protected environment backup. Clear `MARKETING_DOMAIN` and
   `LEGACY_DOMAIN` before restoring the previous `SITE_DOMAIN`, avoiding duplicate Caddy blocks.
2. Redeploy compatible code/images under the VM runbook. Recreate web, bot, ws and Caddy; rebuild if the baked-in
   websocket origin changed. Coordinate the auth rollback with its owner. Do not restore/drop the database;
   the additive waitlist table is backward compatible and contains new signups.
3. Verify old app sign-in, bot links, `www`, HTTP and Socket.IO. Preserve the previous auth configuration during
   the rollback window. With this Caddyfile the restored app still intentionally returns robots/noindex.
4. Cached 308s may keep sending old links to the new app host. Test with fresh curl/browser sessions; keep the
   new host available during recovery if cached redirects must work. Never create opposing redirects.

## Waitlist operations and retention

The existing API stores normalized unique email, ISO `created_at`, source (default `form`, capped at 80 characters)
and user agent (nullable, capped at 300). No IP is persisted in SQLite or application logs. Only POST is registered;
JSON and URL-encoded forms are supported. Invalid requests return 400; unsupported media types 415. Bodies are
limited to 2 KiB. A filled company honeypot returns success without writing. Responses use `no-store` and do not
return an email. The endpoint does not send emails or provide an admin UI.

Rate limiting is in memory: 5 supported attempts per 10 minutes per IP per process, including honeypots. Restarting
resets it; shared NAT users share a bucket. The map expires old entries and caps at 10,000 clients. Missing forwarded
IP shares an unknown bucket. Keep port 3000 private and retain Caddy's default handling of untrusted forwarded
headers ([proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)); reassess before
introducing a CDN. Server/security logs at the host are distinct from the waitlist database.

The owner must operate the published commitments: alpha-only email, withdrawal at any time, deletion within 30 days
of request, and deletion of waitlist emails by the end of alpha. The mailbox, suppression/deletion handling, backup
retention and Clerk invite process need confirming before launch. No automated unsubscribe/deletion endpoint was
added; the privacy notice gives the public mailbox as the request route. Do not import addresses into unrelated
mailing lists. Protect exports as personal information. Set `WAITLIST_DB` to the absolute production SQLite path:

```bash
sqlite3 -header -csv "$WAITLIST_DB" 'select email, created_at from waitlist_signups order by created_at;' > waitlist.csv
```
