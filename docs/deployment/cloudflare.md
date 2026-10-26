# Cloudflare in front of production

Status: **plan, not live** (written 2026-10-25). The owner does every Cloudflare, registrar (Namecheap) and VM step. This page lists the steps and the checks.

Decision (2026-10-24): use the Cloudflare **Free** plan as a proxy only. Do not move the app to Workers or Durable Objects.

## Why

| Goal | How Cloudflare helps |
|---|---|
| Stop DDoS traffic | Cloudflare absorbs it at the edge. The HTTP DDoS rules are always on, on all plans. |
| Hide the VM IP | Visitors see Cloudflare IPs. Lock the VM firewall to Cloudflare to make this real. |
| Cache static files and card images | The edge serves `/_next/static/*` and card images. The VM sends fewer bytes. |
| Show a page when the site is down | See [Maintenance pages](#maintenance-pages). The Free plan cannot do this alone. |

## What the PR changes in the repo

All changes work with and without Cloudflare in front.

| File | Change |
|---|---|
| `Caddyfile` | A global `servers` block. Caddy trusts `CF-Connecting-IP` only from the Cloudflare ranges. Any other peer is used as the client address. |
| `Caddyfile` | `header_up X-Forwarded-For {client_ip}` on every proxy to `web`, and on the PostHog proxy. The app reads the first `X-Forwarded-For` value for rate limits ([`rate-limit.ts`](../../packages/web/src/lib/rate-limit.ts)). Without this change, all players share one Cloudflare edge IP and one rate-limit bucket. |
| `Caddyfile` | `handle_errors 502 503 504` on the app host. See [Maintenance pages](#maintenance-pages). |
| `docker-compose.yml` | Caddy mounts `./site/maintenance` at `/srv/maintenance`, read-only. |
| `Caddyfile` | `/healthz` on the app host. It asks `web` for `/icon.svg` and answers `200 ok` only when `web` answered 2xx. Otherwise 502 JSON. It is never cached (`Cache-Control: no-store`). The maintenance page calls it. |
| `site/maintenance/index.html` | The maintenance page, design "Between turns". One self-contained file. Three states: restart, planned, outage. |

Tests that ran on this branch (Docker, image `caddy:2.11.2-alpine`):

- `caddy validate` with the official image: valid.
- `python3 -I scripts/deployment/verify-domain-routing.py`: pass.
- `python3 -I scripts/deployment/verify-web-restart.py`: pass.
- Manual: a trusted peer with `CF-Connecting-IP` gives `X-Forwarded-For` = that IP. A client-set `X-Forwarded-For` is dropped. `/healthz` gives 200 with `web` up and 502 JSON with `web` down. An untrusted peer that sends `CF-Connecting-IP` is ignored.
- Manual: with `web` stopped, a browser page load gets 503 and the HTML page. API, Socket.IO and `fetch` calls get JSON with the real status (502).
- Manual (Playwright, headless Chromium, 1366x768 and 390x780): the three states show, no demo bar, no script errors. After two failed checks and one good check, the page reloads.

### Keep the IP list current

The list in the `Caddyfile` comes from <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6> (checked 2026-10-25). Cloudflare says the ranges [do not change often](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/). Check every three months. If a range is missing, that traffic loses its real IP and the rate limits count the edge IP again. It does not break the site. To check:

```bash
curl -fsS https://api.cloudflare.com/client/v4/ips | python3 -c 'import json,sys; r=json.load(sys.stdin)["result"]; print(*r["ipv4_cidrs"], *r["ipv6_cidrs"])'
```

Compare the output with the `trusted_proxies static` line. Update the Caddyfile and the Hetzner firewall together.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Plan | Free | Proxy, DDoS, cache and WebSockets work on Free. |
| SSL mode | **Full (strict)** | Caddy keeps its own Let's Encrypt certificates. Full (strict) accepts them ([Cloudflare](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)). Do not use Flexible: Caddy redirects HTTP to HTTPS and the site loops. |
| Origin certificate | Keep Caddy ACME. Do **not** use a Cloudflare Origin CA certificate. | An Origin CA certificate is trusted only by Cloudflare. Rollback to DNS-only would show a browser error, and HSTS (1 year) would lock people out. |
| ACME renewal | HTTP-01 through the proxy. Caddy tries HTTP-01 and TLS-ALPN-01 and [switches to the other after a failure](https://caddyserver.com/docs/automatic-https). | TLS-ALPN-01 [cannot work through the proxy](https://community.letsencrypt.org/t/cannot-negotiate-alpn-protocol/111996). HTTP-01 works when the edge passes `/.well-known/acme-challenge/` to the origin. See [ACME check](#acme-check). |
| Always Use HTTPS | **Off** at first | Caddy already redirects all HTTP. Cloudflare says Always Use HTTPS [does not stop HTTP DCV](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/), but it does not mention ACME HTTP-01 for the origin. Leave it off to keep the ACME path simple. |
| HSTS at Cloudflare | **Off** | Caddy sends `max-age=31536000` already. A Cloudflare HSTS with `includeSubDomains` or preload would also hit `clerk.app`, mail records and other subdomains. |
| Clerk records | **DNS only** (grey cloud) | Clerk checks its CNAME records by DNS. A proxy breaks this check ([Clerk](https://clerk.com/docs/guides/development/deployment/production), troubleshooting section). |
| `www.app.duelingdomain.com` | **Delete the record** | Free Universal SSL covers only the apex and one level (`*.duelingdomain.com`). A deeper name [has no valid certificate](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/). A grey record would show the VM IP. The Caddy block stays; it is harmless. |
| `duelistskingdom.com` (legacy) | Add it to Cloudflare as a second Free site, proxied | If it stays grey, its DNS shows the VM IP and the firewall lock cannot work. |
| Bot Fight Mode | **Off** | It cannot be skipped by WAF rules and it [may challenge API traffic](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/). Clerk and Discord call our web server from servers (for example `/api/webhooks/clerk`). |
| Other speed options | Rocket Loader **off**, Email Address Obfuscation **off**, Web Analytics auto-install **off** | They rewrite HTML or inject scripts. Next.js hydration and the CSP can break. |
| Security Level | Low | Players on VPNs would see challenges at Medium. Use "Under Attack Mode" only in an attack. It shows a JavaScript challenge, which API and Socket.IO clients cannot pass. |
| Lock the origin | Hetzner Cloud Firewall (ports 80 and 443 from Cloudflare ranges) | Works with ACME, easy to undo. Authenticated Origin Pulls need a client-certificate setup in Caddy and break the DNS-only rollback. |

## Limits that matter

| Item | Value | Effect on us |
|---|---|---|
| WebSockets | Supported on all plans ([docs](https://developers.cloudflare.com/network/websockets/)) | Socket.IO works. |
| WebSocket idle close | The current docs page gives **no number**. Older sources say 100 seconds. Cloudflare advises a heartbeat. | Duel sockets ping every 5 s ([`socket-options.ts`](../../packages/ws/src/socket-options.ts)). Other sockets use the Socket.IO default (25 s). Both are far below 100 s. |
| Proxy read timeout | 125 s, then error 524. Not configurable on Free ([docs](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)). | Caddy answers or holds for 30 s at most. No effect. |
| Upload size | 100 MB on Free. | Caddy limits request bodies to 1 MB. No effect. |
| Cacheable file size | 512 MB on Free ([docs](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)). | No effect. |
| Cloudflare caches | By file extension. HTML and JSON are **not** cached by default. A response with `private`, `no-store`, `no-cache`, `max-age=0` or `Set-Cookie` is not cached. | Safe default. Do not add "Cache Everything". |

## Owner steps

Do the steps in this order. Stop at any step that does not match the check.

### A. Before Cloudflare

1. Merge this PR. Run the normal Deploy. Check that `https://app.duelingdomain.com/` still loads and that you can sign in.
2. Optional, at a quiet time: on the VM, run `docker compose -f docker-compose.yml stop web`. Open the app in a browser. You must see the maintenance page. Run `docker compose -f docker-compose.yml start web`. Do not do this while duels run.
3. In Namecheap, open Advanced DNS for `duelingdomain.com` and `duelistskingdom.com`. Save a screenshot or export of **every** record. Note the VM IPv4 and IPv6 addresses.
4. In Namecheap, check that DNSSEC is off for both domains. If it is on, turn it off before you change the name servers.

### B. Add the site (no traffic change yet)

5. Create a Cloudflare account. Use a strong password and two-factor sign-in.
6. Choose **Add a site**, enter `duelingdomain.com`, choose the **Free** plan.
7. Cloudflare scans the DNS. Compare its list with your Namecheap export. Add every missing record. Pay attention to MX, SPF, DKIM, DMARC and Search Console or Bing TXT records.
8. Set the proxy state for each record:

| Record | Proxy |
|---|---|
| `duelingdomain.com` A and AAAA (VM) | Proxied (orange) |
| `www` | Proxied (orange) |
| `app` A and AAAA (VM) | Proxied (orange) |
| `www.app` | Delete |
| `clerk.app` CNAME (Clerk Frontend API) | **DNS only (grey)** |
| `accounts.app` CNAME (Clerk) | **DNS only (grey)** |
| Clerk mail records (DKIM, return path CNAMEs) | **DNS only (grey)** |
| MX, TXT (SPF, DMARC, verification) | DNS only (Cloudflare does not proxy these) |
| Any record not for the web (for example a mail host) | DNS only (grey) |

9. Open **SSL/TLS**. Set the mode to **Full (strict)** now, before the name server change.
10. Open **SSL/TLS > Edge Certificates**. Keep Always Use HTTPS **off**. Keep HSTS **off**. Set the minimum TLS version to 1.2.
11. Open **Security > Settings**. Set Security Level to Low. Set Bot Fight Mode to off.
12. Open **Speed > Optimization**. Set Rocket Loader off. Open **Scrape Shield**. Set Email Address Obfuscation off. Open **Analytics & Logs > Web Analytics**. Do not enable the automatic setup.
13. Open **Network**. Check that WebSockets is **On** (it is the default).

### C. Cache rules

14. Open **Caching > Cache Rules**. Add two rules. Use the setting "Eligible for cache" and Edge TTL "Use cache-control header if present, bypass cache if not". Keep the default cache key.

| Rule | Match (custom filter) |
|---|---|
| Static files | URI Path starts with `/_next/static/` or starts with `/_next/image` |
| Card images | Hostname equals `app.duelingdomain.com` and URI Path starts with `/api/cards/` and URI Path ends with `/image` |

The card image route answers with `Cache-Control: public, max-age=86400, immutable` for our own images. Error answers have no cache header or use `no-store`, so the rule skips them. Do **not** cache anything else under `/api/`, any HTML, `/socket.io/`, or the sign-in pages.

Known effect: the card image route needs a signed-in session. After a rule caches an image, a person who is not signed in can fetch that cached image. The images are public card art. The owner accepts this, or skips the card image rule.

### D. Switch traffic

15. For `duelistskingdom.com`, repeat steps 6 to 13. Proxy only the apex and `www`.
16. In Namecheap, set the name servers of each domain to the two that Cloudflare shows. Wait until Cloudflare shows the site as **Active**. This can take some hours.
17. Do the [checks](#checks) now.

### E. Lock the origin (after two days without problems)

18. In Hetzner Cloud, create a Firewall with these inbound rules:

| Protocol | Port | Source |
|---|---|---|
| TCP | 80 | The Cloudflare IPv4 and IPv6 ranges |
| TCP | 443 | The Cloudflare IPv4 and IPv6 ranges |
| TCP | 22 | **Any** (keep as is) |
| ICMP | - | Any |

Do not use `ufw`. Docker publishes ports around it. A Hetzner Cloud Firewall works before the VM.

Notes on these rules:

- Keep SSH open. The Deploy workflow connects from GitHub runners with changing IPs. Keep key-only login.
- UDP 443 (HTTP/3) can stay closed. Cloudflare does not use it to reach the origin.
- A firewall has up to [500 effective rules](https://docs.hetzner.com/cloud/firewalls/overview/). 22 ranges for two ports fit.
- After this step, a direct request to the VM IP fails. Old `http://<IP>` links in Discord stop working.
- Every host name that Caddy serves must be proxied now. A grey host cannot renew its certificate.

19. Attach the firewall to the VM. Run the [checks](#checks) again.
20. Optional: the VM IP was public before. To make it secret, ask for a new IP (Hetzner Primary IP) and update the two A records and the AAAA records.

## Checks

| Check | How | Pass |
|---|---|---|
| Traffic goes through Cloudflare | `curl -sI https://app.duelingdomain.com/` | Header `server: cloudflare` and a `cf-ray` header. |
| Sign-in | Open the app in a private window. Sign in with email and with Discord. | Both work. The Clerk sign-in widget loads. |
| Clerk stays direct | `dig +short CNAME clerk.app.duelingdomain.com` | Shows the Clerk target, not Cloudflare IPs. |
| WebSocket duel | Start a 1v1 duel with a second account. Play a few turns. Leave it open 3 minutes without input. | The badge stays Live. No reconnect loop. In browser tools, the `/socket.io/` request is `101` (websocket). |
| Static cache | `curl -sI https://app.duelingdomain.com/_next/static/<a file from the page source>` twice | Second answer has `cf-cache-status: HIT`. |
| Card image cache | Open a duel with card images, then request one image URL twice. | `cf-cache-status: HIT` on the second request. |
| No HTML or API cache | `curl -sI https://app.duelingdomain.com/sign-in` | `cf-cache-status` is `DYNAMIC` or absent. |
| Real client IP | Send 6 requests of `curl -sS -o /dev/null -w '%{http_code}\n' https://duelingdomain.com/api/waitlist -H 'Content-Type: application/json' --data '{"email":"test@example.com","company":"verification"}'` from one network. Then send 1 more from a phone on mobile data. | The 6th request from the first network gives 429. The phone request still gives 200. If both give 429, the real IP is lost. See [Risks](#risks). |
| Maintenance page | On the VM: `docker compose -f docker-compose.yml stop web`. Open the app in a private window. Wait 30 s. Then `start web`. | Page shows "Between turns" and reloads by itself within 30 s after `web` is back. In browser tools `/healthz` is 502 while down and 200 after. |
| Health check not cached | `curl -sI https://app.duelingdomain.com/healthz` twice | 200, `cache-control: no-store`, and `cf-cache-status` is `DYNAMIC` or absent. |
| Marketing | Open `https://duelingdomain.com/`. | Page loads. A signed-in browser goes to the app. |
| Legacy | `curl -sI https://duelistskingdom.com/draft/x?y=1` | 308 to the app, path kept. |
| Email | Send a mail to the contact address. | It arrives. |
| ACME | See below. | Pass. |

### ACME check

Caddy renews 30 days before a certificate ends. Test the path now so a failure shows in time.

1. From any computer: `curl -sI http://app.duelingdomain.com/.well-known/acme-challenge/test`. The answer must **not** be a Cloudflare challenge or block page (no `cf-mitigated` header). A plain 404 is correct.
2. On the VM: `docker compose -f docker-compose.yml logs caddy | grep -i -E 'certificate|acme|renew' | tail`. Look for errors.
3. On the VM: `echo | openssl s_client -connect 127.0.0.1:443 -servername app.duelingdomain.com 2>/dev/null | openssl x509 -noout -enddate`. Write the date in your calendar. Do this for `duelingdomain.com` too.

If a renewal fails: set the failing record to DNS only for one day. Open the firewall to all on 80 and 443 for that day if you did step 18. Caddy retries by itself. Then restore both.

## Maintenance pages

There are two cases.

### Case 1: the VM is up, `web` or `ws` is restarting (done in this PR)

Caddy holds a request for up to 30 seconds (`lb_try_duration`). If the upstream is still down, Caddy raises 502, 503 or 504. The new `handle_errors` block answers:

| Caller | Answer |
|---|---|
| Browser page load (`GET` or `HEAD`, `Accept` has `text/html`, not a `fetch` call) | Status **503**, the static page from `/srv/maintenance`, `Cache-Control: no-store`, `Retry-After: 15`, `X-Robots-Tag: noindex, nofollow`. |
| API, `fetch`, Socket.IO, assets, `POST`, `/healthz` | The real status (502, 503 or 504), body `{"error":"service_unavailable","retryable":true}`, `Cache-Control: no-store`, `Retry-After: 15`. Never HTML. |
| A 5xx that the app itself sends | Not changed. It passes through. |
| Marketing and legacy hosts | Not changed. |

### The page ("Between turns")

The page shows a tilted playmat and a deck that shuffles. It has three states:

| State | Chip and title | When |
|---|---|---|
| `restart` (default) | "Between turns" / "Shuffling the deck." | Caddy could not reach `web`: a deploy or a restart. Usually less than a minute. |
| `planned` | "Planned maintenance" / "Resetting the field." | The owner sets it. It can show an expected time and a message. |
| `outage` | "Service interruption" / "The field went dark." | The server is down and not planned. See Case 2, option B. |

How it works:

- Every 10 s (then 15 s, 20 s, up to 30 s after failed checks, plus 0-1 s of random jitter) the page calls `GET /healthz` with `cache: no-store` and a 5 s time limit. A "Try now" button checks at once.
- `/healthz` is on the same host. It is answered by Caddy from `web`. It is not answered by the maintenance handler, and Cloudflare does not cache it (no file extension, no cache rule, `no-store`). It returns 200 only when `web` is up.
- When `/healthz` gives 200, the page shows "We are back." and reloads after 2.4 s (`location.reload()`). The reload goes to the original URL, so the player lands where they were.
- Under `prefers-reduced-motion`, the animation stops. No outside request: no fonts, no images, no scripts.
- The "Status and news in our Discord" link goes to the community invite that the marketing site uses (`https://discord.gg/sUSmbRbBUm`).

Which state is shown. Caddy always serves the same file. The file shows `restart` unless the owner changes `CONFIG` in it. So:

- Caddy `handle_errors` (502, 503, 504): `restart`, or `planned` when the owner set it.
- Cloudflare VM-down page (Case 2): Cloudflare cannot serve our file on the Free plan. With option B, the Worker serves a copy of this file and sets the state by a text replace of `state:'restart'` with `state:'outage'` in the HTML before it answers. The Worker must pass `/healthz` through to the origin. With option A or C there is no link to this file.

### Turn on planned maintenance

1. Open `site/maintenance/index.html`. Find the block `var CONFIG={...}` at the top of the script. Change three values:
   - `state:'planned'`
   - `etaIso:'2026-11-02T22:30:00-05:00'` (an ISO time with the offset, or `null` for no time)
   - `message:'...'` (one or two short sentences)
2. Open a PR and merge it to `main`. Run the Deploy. The Deploy updates the file on the VM (`git reset --hard`). Caddy reads the file on each request, so it does not need a restart. To check, read the file in the Caddy container: `docker compose -f docker-compose.yml exec caddy grep -n "var CONFIG" /srv/maintenance/index.html`.
3. At the planned time, stop the service you work on. For example `docker compose -f docker-compose.yml stop web`. Visitors now see the planned page after the 30 s hold. Do not stop `web` while duels run.
4. When you are done, start it again: `docker compose -f docker-compose.yml start web`. Players reload by themselves within 30 s.
5. After the work, set `state:'restart'` and `etaIso:null` again in a new PR. If you forget, the page changes by itself: one hour after `etaIso` it shows `restart` again. With `etaIso:null` the `planned` state stays until you change it.

Emergency only: you can edit the file on the VM. The next Deploy resets it. Keep Cloudflare cache rules away from this page: Caddy sends `no-store`.

If you change the design later: keep one self-contained file, no outside requests, keep the `/healthz` check and the `CONFIG` block. After a design change, run the same checks as in the PR (page renders in the three states, no console errors, 390 px and 1366 px wide).

During a Deploy, Caddy stays up until the step `compose down` and starts again at `compose up`. So this page covers most of a deploy. Only the short gap between `down` and the new Caddy shows Case 2.

### Case 2: the VM or Caddy is down

Cloudflare then shows its own error page (521, 522, 523 or 524). Facts, checked on 2026-10-25:

- **Custom Errors and Error Pages are not on the Free plan.** The plan table shows 0 rules and 0 assets for Free. They start at Pro ([docs](https://developers.cloudflare.com/rules/custom-errors/)).
- A WAF "Block" custom response is also Pro and above, and only allows status 400-499 ([docs](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/)).
- Cloudflare shows an error page only when it cannot reach the origin. It never calls our Caddy page in that case.

| Option | Cost | Limits | Verdict |
|---|---|---|---|
| **A. Accept the Cloudflare default page** | $0 | Page is Cloudflare-branded ("Web server is down"). Short for deploys. | **Recommended now.** |
| B. Cron Worker that adds a Worker route only during an outage | $0 | See below. About 1 minute to detect. Needs one API token and about 60 lines of code. | Build later if outages hurt. |
| C. Cloudflare Pro, Custom Error Rules or Error Pages | $20/month billed yearly, $25 monthly ([plans](https://www.cloudflare.com/plans/network-cdn.md)) | 25 rules and 25 assets. Pages up to about 1.5 MB. | Choose this if you want a branded page without code. |
| D. A Worker route in front of every request | $0 up to 100,000 requests/day, then Paid ($5/month) | **Every request to the route counts**, including API polling. A busy duel day passes 100,000. After the limit, a route set to "fail open" skips the Worker; "fail closed" shows error 1027 ([docs](https://developers.cloudflare.com/workers/platform/limits/)). | Not recommended. |

Recommendation: **A now, C if a branded VM-down page matters, B as the free alternative to C.** Reason: Case 1 already covers restarts and most of a deploy. Real VM outages are rare. A Worker in front of all traffic (D) costs requests on normal days and adds a failure point.

Design of option B, not built in this PR:

1. A Worker with a Cron Trigger every minute (the Free plan allows [5 Cron Triggers per account](https://developers.cloudflare.com/workers/platform/limits/)).
2. It requests `https://app.duelingdomain.com/robots.txt`. Caddy answers this path by itself, so it shows whether Caddy is up. (`/healthz` shows whether `web` is up. Use it only for the page.)
3. On 520 to 524 (or no answer) it adds a route `app.duelingdomain.com/*` to a second Worker. That Worker returns the maintenance HTML (with `state:'outage'`) with status 503 and `Retry-After`. It passes `/healthz` to the origin so the page can detect the return.
4. When `robots.txt` answers 200 again, it deletes the route.
5. Its API token is limited to Workers Routes on this zone and is stored as a Worker secret.
6. Worker requests exist only during an outage. If the 100,000 limit is reached, set the route to fail open so visitors see the default page again.

Open details to verify when you build it: Free route fail-open setting, API route edit scope, and propagation time of a route change.

## Rollback

1. If you did step 18: in Hetzner, open ports 80 and 443 to any source (or detach the firewall). Do this **first**.
2. In Cloudflare DNS, click each orange record and set it to **DNS only**. Visitors reach the VM directly within about 5 minutes. Caddy certificates are valid, so there is no browser error.
3. To leave Cloudflare fully: in Namecheap, set the name servers back to Namecheap DNS. Check that all records exist there first.
4. The `Caddyfile` changes need no rollback. Without Cloudflare, Caddy uses the real peer address. The maintenance page still works.

## Risks

| Risk | What happens | Control |
|---|---|---|
| Real IP lost | All players share one rate-limit bucket (for example waitlist: 5 per 10 minutes for everyone). | The `Caddyfile` change in this PR. Run the "Real client IP" check. Update the range list every three months. |
| Client-set `X-Forwarded-For` | Cloudflare appends to a client header, so the first value can be forged. | Caddy now writes `{client_ip}` as the only value. Test shows a forged value is dropped. |
| Clerk sign-in breaks | A proxied Clerk record fails Clerk's DNS check and the sign-in page fails. | Keep every Clerk record grey. Check the Clerk dashboard shows "Verified" after the switch. |
| WebSocket drops | Edge idle close or a Cloudflare restart ends sockets. | Heartbeats (5 s and 25 s). Clients reconnect. Cloudflare may [restart servers and end WebSockets](https://developers.cloudflare.com/network/websockets/). |
| ACME renewal fails | After about 60 days, the certificate expires and Cloudflare shows error 526. | [ACME check](#acme-check). Caddy tries 30 days early. Calendar reminder. |
| HSTS | The browser keeps HTTPS for one year. A grey rollback needs a valid certificate. | Keep the Caddy ACME certificates. Never use only an Origin CA certificate. |
| Bot Fight Mode or Under Attack Mode | Server-to-server callers (Clerk webhook, Discord link preview) get a challenge and fail. | Keep Bot Fight Mode off. Use Under Attack Mode only in an attack, then turn it off. |
| Cache shows the wrong content | A signed-in page is cached and shown to other people. | Only the two cache rules above. No "Cache Everything". Check `cf-cache-status` on `/sign-in` and `/api/*`. |
| Cached card image without sign-in | A person not signed in can fetch a cached card image. | Accepted (public art), or skip the card image rule. |
| Firewall locks you out | SSH or ACME fails. | Keep SSH open. Keep a Hetzner console login. Detach the firewall to undo. |
| Nameserver change outage | DNS goes dark if records are missing. | Step 7: compare every record before step 16. Email records are easy to forget. |
| New Universal SSL gap | `www.app` has no valid certificate. | The record is deleted in step 8. |

## What the browser does today when the server fails

Checked in `packages/web/src` on 2026-10-25. Nothing here changes in this PR.

- **Duel page**: the socket reconnects (250 ms to 3 s). A badge shows `Live`, `Catching up…`, `Reconnecting` or `Polling` ([`connection-label.ts`](../../packages/web/src/components/duel/connection-label.ts)). Room reads and actions retry on a network error or 502, 503 and 504 with backoff for 30 s, and the board stays on screen. A Caddy answer with `Retry-After` and JSON works with this retry code. See [domains.md](domains.md#web-only-restarts-during-live-duels).
- **Duel lobby and presence**: lobby shows "Connection dropped. Reconnecting…". Presence reconnects with the same delays.
- **Draft and tournament pages**: Socket.IO reconnects by default. The hook logs a warning (`Draft WS connect error`) and rejoins on reconnect and on tab focus. There is **no banner** for a lost socket.
- **Other API calls** (decks, cubes, settings): there is no shared offline banner or retry. A failed call shows that screen's own error, or the route error page ("This page hit a problem", `Try again`) from [`app/(app)/error.tsx`](../../packages/web/app/(app)/error.tsx).
- **A failed page load** shows the new maintenance page (Case 1) instead of an empty 502.
- **Gap**: draft, tournament and general pages have no "reconnecting" indicator. A small shared banner would help. This is a separate task.

## Sources

Read on 2026-10-25.

- Cloudflare: [WebSockets](https://developers.cloudflare.com/network/websockets/), [connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/), [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), [Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/), [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/), [Universal SSL limits](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/), [default cache behaviour](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), [HTTP DDoS rules](https://developers.cloudflare.com/ddos-protection/managed-rulesets/http/), [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/), [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/), [IP ranges](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/), [Custom Errors](https://developers.cloudflare.com/rules/custom-errors/), [WAF custom rules](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [plans and prices](https://www.cloudflare.com/plans/network-cdn.md).
- Caddy: [global options](https://caddyserver.com/docs/caddyfile/options) (`trusted_proxies`, `client_ip_headers`), [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [automatic HTTPS](https://caddyserver.com/docs/automatic-https).
- Clerk: [production deployment, DNS troubleshooting](https://clerk.com/docs/guides/development/deployment/production).
- Hetzner: [Cloud Firewall overview](https://docs.hetzner.com/cloud/firewalls/overview/).
- Let's Encrypt community: [TLS-ALPN-01 and Cloudflare](https://community.letsencrypt.org/t/cannot-negotiate-alpn-protocol/111996).

Not verified in current Cloudflare docs: the exact WebSocket idle limit (older sources say 100 s), and whether Always Use HTTPS leaves `/.well-known/acme-challenge/` alone for origin ACME. The plan avoids both.
