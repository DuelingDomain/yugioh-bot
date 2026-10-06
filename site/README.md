# Dueling Domain marketing site

Static waitlist page for the closed alpha. Plain HTML, CSS and JS: no build step, no framework, no npm dependencies.
Caddy serves `site/public/` at the marketing domain root (`file_server`, with `404.html` for missing paths).

```
site/
  public/            everything that is served
    index.html       the page (one h1, landmarks, both email forms, inline logo sprite)
    style.css        all styles; tokens at the top
    app.js           form, pack rip, card deal, reveals (no dependencies)
    privacy.html     clean /privacy URL, shared header/footer and reading layout
    404.html         shared styles and absolute URLs (served for any missing path)
    favicon.svg, favicon-32.png, favicon-16.png, favicon.ico, apple-touch-icon.png
    og.png           1200x630 social image
    robots.txt, sitemap.xml, site.webmanifest
    logo-192.png, logo-512.png
    assets/          card backs (webp) and the trailer poster (webp)
  src/               sources for the generated icons and og.png, plus the script that renders them
```

## Preview

```bash
python3 -m http.server 8080 --directory site/public
# open http://localhost:8080
```

The form posts to `/api/waitlist`, which the static server does not have, so a plain preview shows
"Couldn't reach the list". To see the other states, stub the route in your browser tooling (the
Playwright `page.route` pattern works), or run behind the real Caddy.

Motion follows `prefers-reduced-motion` only. In dev tools, emulate "prefers-reduced-motion: reduce" to check it.

## Waitlist API contract

`POST /api/waitlist` (same origin, proxied by Caddy to the web app).

Request, `Content-Type: application/json`:

```json
{ "email": "you@example.com", "source": "hero", "company": "" }
```

- `source` is `"hero"` (top form) or `"footer"` (bottom form).
- `company` is a honeypot. It is a visually hidden, `tabindex="-1"`, `autocomplete="off"` input that real people never fill in.
- The client trims the email and checks it first: no spaces, one `@`, a dot in the domain, 254 characters at most.

Responses the page understands. It shows success only for the first row, never otherwise.

| Status | Body | What the page shows |
| --- | --- | --- |
| 201 | `{"status":"joined"}` | "You're on the list." The packs rip open. |
| 200 | `{"status":"exists"}` | "Already on the list." |
| 400 | `{"error":"invalid_email"}` | Inline "That doesn't look like an email." |
| 429 | any | "Too many tries. Try again in a few minutes." |
| anything else, or a network failure or timeout (15 s) | any | "Couldn't reach the list. Try again." The email stays in the field and the button is re-enabled. |

A 201 or 200 with a different body is treated as "anything else". Both forms share state, so a result in one shows in both.

### No-JS fallback

Each `<form>` has `method="post" action="/api/waitlist"` with fields `email`, `source` and `company`.
For these form posts the server answers with a `303` to one of:

```
/?waitlist=joined#join
/?waitlist=exists#join
/?waitlist=invalid#join
/?waitlist=limited#join
```

On load, `app.js` reads `waitlist`, shows the matching state in both forms, then removes the query with
`history.replaceState`. With JavaScript off the redirect lands on `#join` (the bottom form) and the page shows the plain form again,
because there is nothing to read the parameter.

## Logo and icons

- The header and footer use the "In the slot" lockup as an inline SVG symbol (`#dd-lockup` in `index.html`). It never animates.
- Both packs and their marks are static HTML, visible without JavaScript. Their base style is the finished mark. The entrance (a card drops into the slot and
  shrinks into the gem) is the `.pack.mark-play` rule in `style.css`, added by `app.js` when a pack opens.
- `favicon.svg` and `src/favicon-16.svg` are tuned for small sizes: a heavier D with a bigger counter and gem, pixel-snapped at 16.
  `apple-touch-icon.png` uses the full mark.
- To regenerate the PNGs, `favicon.ico` and `og.png` after editing the sources in `src/`:

```bash
NODE_PATH=/path/to/node_modules CHROMIUM=/path/to/chromium node site/src/build-icons.mjs
```

`build-icons.mjs` needs the existing `sharp` and Playwright packages. The added 192/512 PNG marks come from
`src/mark.svg`; `node site/src/build-icons.mjs --marks-only` renders those without Chromium.
`node site/src/build-poster.mjs` renders the original geometric table diagram from `src/arena-poster.svg` using sharp.
The trailer slot is explicitly an illustration. Its old screenshot contained third-party card art and was replaced.

`og.html` still loads Google Fonts under the network fallback below. After font setup it uses the local WOFF2s
through paths relative to `site/src`. The icon builder serves a temporary loopback HTTP origin so browser font loading works offline without file-origin restrictions. The mark and poster builds
never fetch fonts.

## Fonts: network fallback and exact setup command

The 2026-10-05 sandbox could not resolve the font download host (`curl: (6) Could not resolve host`).
Per the task's fallback, Google Fonts remains on all three pages and the OG source. The privacy notice discloses
those requests and the CSP temporarily permits the stylesheet and font origins. This is still an external,
render-blocking stylesheet; the fully local performance/privacy target is pending.

From this worktree on a machine with outbound HTTPS, run exactly:

```bash
python3 site/src/self-host-fonts.py
python3 site/src/verify-static.py
```

The first command downloads Russo One 400 and Chakra Petch 400/500/600/700, Latin WOFF2 only, from the font API's
Latin face URLs, plus both upstream OFL license texts from the Google Fonts repository. It prints each byte count.
After all downloads validate, it adds `@font-face` rules with `font-display: swap` to `style.css`, preloads Russo One
400 and Chakra Petch 400 on every page, removes remote font links, updates the OG source and privacy disclosure,
and removes the two remote font origins from Caddy's CSP. Review the resulting diff and deploy Caddy with the assets.
Failed downloads leave the site alone. Font changes after installation need a new filename because of the one-year cache.

## Verification and screenshots

```bash
python3 site/src/verify-static.py
python3 scripts/deployment/verify-domain-routing.py
# Against local Caddy serving this directory (not the Python static preview):
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium node site/src/verify-browser.mjs
```

The browser harness checks real Caddy CSP/HSTS, mocks every waitlist POST and writes screenshots to
`/tmp/dd-privacy-seo-shots` (`SHOTS_DIR` overrides it). It never submits a signup. Docker and Chromium are blocked
in this sandbox; their successful runs remain an orchestrator task. See `VERIFICATION.md` for results and the exact
visual review matrix. The static check is structural sanity checking, not a full HTML conformance validator.

With JS disabled, both packs, all feature copy, the trailer heading, all three face-up steps and both forms are
present. The native form still posts to the API; its no-JS 303 return displays the plain form as documented above.
JS adds its class only when the deferred script loads. There is no blocking executable inline script.
The inert JSON-LD block is data and remains readable to crawlers under `script-src 'self'`.

## Before launch

- Owner: resolve the two `OWNER:` comments in `public/privacy.html` and establish the request/deletion process.
- Complete the font setup and browser/routing checks; review the calm privacy layout and both forms in all states.
- Follow `SEO.md` for DNS verification, sitemap submission and launch checks.
- Follow `../docs/deployment/domain-cutover.md` for the owner-gated DNS cutover and Clerk coordination.
