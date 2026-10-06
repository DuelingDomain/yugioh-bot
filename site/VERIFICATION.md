# Privacy and SEO implementation report — 5 October 2026

Implemented in branch `marketing`; no commit, push, merge, DNS change or deployment. Existing work outside the
requested scope was preserved. App/auth packages and game code were not edited.

## Files changed by this task

- `public/index.html`, `public/privacy.html`, `public/404.html`: metadata, common navigation/footer/disclaimer,
  privacy content, consent notices, static packs and crawlable alpha steps. The home copy now explains browser
  card drafts and the free alpha. Removed an unsupported competitor-exclusivity claim. The 404 uses shared CSS.
- `public/style.css`, `public/app.js`: scoped privacy/error layouts and consent styles; deferred JS enhancement,
  no inline executable bootstrap, no template-only packs, no-JS steps face up. Fixed the existing mobile footer's
  360px flex-basis becoming vertical space. Reduced-motion preferences also work without JS.
- `public/robots.txt`, `public/sitemap.xml`, `public/site.webmanifest`: discovery, two canonical URLs dated
  2026-10-05, brand colors and 192/512 icons.
- `public/logo-192.png`, `public/logo-512.png`, `src/mark.svg`, `src/build-icons.mjs`: PNG marks rendered from the
  existing geometric mark. `--marks-only` works without Chromium. The full icon/OG builder uses temporary HTTP
  serving so local font requests share an origin.
- `public/assets/card-back-main-hd.webp`, `public/assets/card-back-extra-hd.webp`: resized to 600×874.
- `public/assets/arena-poster.webp`, `src/arena-poster.svg`, `src/build-poster.mjs`: original table illustration
  replaces the screenshot containing official card art and old branding. Caption/alt now correctly say illustration.
- `src/self-host-fonts.py`: reproducible font download and activation command, including OFL texts, page preloads,
  OG source, privacy disclosure and CSP changes. **Actual downloads are pending**, so `src/og.html` still uses the
  existing remote fonts. The helper will change it after all downloads succeed.
- `src/verify-static.py`, `src/verify-browser.mjs`: repeatable structural checks and browser/CSP/state screenshots.
- `README.md`, `SEO.md`, this report: setup, query mapping, owner actions and verification handoff.
- `../Caddyfile`, `../scripts/deployment/verify-domain-routing.py`, `../docs/deployment/domain-cutover.md`:
  security/cache/robots configuration, expanded routing verification, registered-domain facts and Clerk coordination.

## Asset sizes

Actual file bytes; image artifacts were decoded and inspected. All `<img>` elements have width/height; every
below-fold home-page image, including the bottom pack, has `loading="lazy"` and async decoding.

| Asset | Before | After | Dimensions / reason |
| --- | ---: | ---: | --- |
| Main card back | 40,206 | 12,794 | 1394×2031 → 600×874; largest rendered width about 280px, enough for 2× density. |
| Extra card back | 32,762 | 10,216 | Same dimensions and sizing rationale. |
| Trailer poster | 78,148 | 29,262 | 1440×900 retained; replacement was required to remove official art/old branding. |
| OG PNG | 362,093 | 362,093 | 1200×630 unchanged; social metadata only, not a rendered page request. |
| Logo 192 PNG | — | 1,869 | 192×192. |
| Logo 512 PNG | — | 9,127 | 512×512; absolute Organization logo and manifest icon. |
| Apple touch PNG | 1,227 | 1,227 | 180×180, unchanged. |
| Favicon SVG / 32 PNG / 16 PNG / ICO | 379 / 748 / 320 / 1,106 | unchanged | Existing icons retained. |
| Local WOFF2 fonts / OFL texts | — | **not downloaded** | Sandbox DNS failure; byte sizes cannot be measured yet. |

Card backs save 49,958 bytes combined; all three page image assets save 98,844 bytes combined. No oversized
new raster assets or remote images were introduced. The new static packs add about 3.8KB to index HTML.
The only JS resource is deferred. **The remaining extra render blocker is Google Fonts CSS under the explicit
network fallback.** Once the font helper succeeds, style.css is the only stylesheet, and two local 400-weight
above-fold faces are preloaded with `font-display: swap` on all five faces.

## Structured data

The inline, inert JSON-LD graph contains `WebSite` and `Organization` (Dueling Domain, canonical homepage, absolute
`https://duelingdomain.com/logo-512.png`), plus `WebApplication` at the app URL. It declares
`applicationCategory: GameApplication`, `operatingSystem: Web browser`, `creativeWorkStatus: Closed alpha`, and an
Offer priced at `0` in `CAD`, explicitly for free closed-alpha access only. Its URL is the waitlist anchor.
[LimitedAvailability](https://schema.org/LimitedAvailability) describes the existing invite-only waves.
[PreOrder](https://schema.org/PreOrder) describes advance ordering; this form takes no order and guarantees no seat.
No ratings, reviews, release date, invented legal entity name or future pricing claims were added.

## Caddy changes

- App `SITE_DOMAIN`: deferred `X-Robots-Tag: noindex, nofollow` covers app responses, including auth redirects.
  `/robots.txt` returns 200 plain text directly from Caddy, with two lines: `User-agent: *` and `Disallow: /`.
  **This intentionally changes the current production app host even before domain cutover.**
- Marketing: HSTS `max-age=31536000` only; CSP restricts executable scripts and connections to self, images to
  self/data, frames to none, base/form actions to self. Inline styles remain necessary for existing SVG attributes
  and dust styles; no executable inline script remains. Google stylesheet/font origins are temporarily permitted
  until downloads succeed. The font helper removes those exceptions. No app CSP was added.
- Fonts under `/fonts/*.woff2`: one-year cache. Manifest: explicit `application/manifest+json`.
  Other cache behavior stays at five minutes with revalidation for documents/CSS/JS and one day for media;
  missing assets/pages use no-store. `/privacy`, sitemap and manifest are ordinary static files.
- Legacy host: all existing 308 behavior preserved, including `/robots.txt`.
- Routing harness: added these assertions and 21 baseline comparisons; only the app noindex header and robots
  response/body length are allowed to change. Real manifests/sitemaps/robots are copied into temporary fixtures.

## Verification obtained here

`python3 site/src/verify-static.py` exited 0:

```text
PASS privacy.html: structure, unique IDs, one h1, metadata, links, image dimensions, footer
PASS index.html: structure, unique IDs, one h1, metadata, links, image dimensions, footer
PASS 404.html: structure, unique IDs, one h1, metadata, links, image dimensions, footer
PASS no-JS source: h1/intro, five feature descriptions, trailer, three steps, two forms, two packs
FALLBACK: Google Fonts retained after sandbox DNS failure. Run self-host-fonts.py before launch.
PASS JSON-LD, sitemap, manifest, CSS URLs, consent persistence, IP text rules
```

JS syntax (`app.js`, both asset builders, browser harness), Python AST checks (font/static/routing scripts) and
`git diff --check` passed. Mark-only and poster builds succeeded. A separate test using synthetic downloads in a
`/tmp` copy verified the font activation edits and repeat-run idempotence; it does not verify actual font binaries
or upstream availability. Caddy's original app prefix matches after removing only the intentional SEO stanza.

The executable routing script was attempted and failed at Docker access:

```text
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

Chromium was attempted and failed during startup with `setsockopt: Operation not permitted` / SIGTRAP.
Font downloads failed with `Could not resolve host: fonts.googleapis.com`; the Python helper also reports
`Temporary failure in name resolution`. **No live routing, browser, screenshot, CSP-runtime, font-download or
Core Web Vitals pass is claimed.** The local HTML checks are structural sanity checks, not full HTML validation.

## Exact remaining commands and visual checks

On a machine with network, Docker and Chromium, from the repo root:

```bash
python3 site/src/self-host-fonts.py
python3 site/src/verify-static.py
node site/src/build-icons.mjs --marks-only
CHROMIUM=/path/to/chromium node site/src/build-icons.mjs
docker pull caddy:2-alpine
python3 scripts/deployment/verify-domain-routing.py
# Start/recreate local Caddy using the deployment guide, serving the actual site:
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium node site/src/verify-browser.mjs
```

The font command downloads five Latin WOFF2 faces plus both OFL licenses, prints their byte sizes, installs
font faces/preloads, and switches pages, OG source, privacy disclosure and CSP in one run. Review that diff;
then rerun routing/browser checks with the final local-font CSP. `README.md` describes its download sources.

Review these screenshots at **320, 390, 768, 1024, 1440 and 1920 pixels**:

| Page/state | Exact review |
| --- | --- |
| `/` idle, with JS | Whole page, header/footer, static packs, five feature cards, new poster, three alpha steps. |
| Both hero/footer forms: idle, sending, joined, exists, invalid, limited, error | Consent remains visible and linked; one line at 1440, clean wrapping at 390/320; no overlaps or clipped messages/buttons. |
| Empty email and server invalid email | Correct inline error; no layout break, input stays accessible. |
| “Use a different email” after joined/exists | Both forms reset and consent persists; keyboard focus returns to the input. |
| `/?waitlist=joined#join`, `exists`, `invalid`, `limited` | Both copies show the correct return state, query cleanup works. |
| `/` with JS disabled | Two packs, all five feature descriptions, three face-up steps, heading/intro, trailer heading and both native forms are visible. |
| `/privacy` | Shared header/footer, readable ~65ch measure, all h2s/date/mail links, no horizontal scroll. |
| `/missing/deep/path` (actual 404) | Correct status, absolute asset URLs, shared footer/disclaimer and home/privacy links. |
| `/` at 390 and 1440, normal motion | Pack click/keyboard activation, rip/deal, SVG marks/glint/dust/tilt, feature swipe/hover, step flips and trailer “coming soon” feedback. |
| All pages with reduced motion | No animated effects; steps remain readable and form states work. |

The browser harness covers the main matrix and screenshots under `/tmp/dd-privacy-seo-shots`, asserts page width,
consent placement and CSP violations, and mocks all waitlist POSTs. Also inspect offline/network failure, the
15-second timeout and malformed success responses (all should use `error`), keyboard-only navigation and 200%
zoom. Use one controlled real submission plus a native no-JS POST behind the final API to verify persistence/303s;
the harness deliberately does not create signups. A no-JS 303 return still displays a plain form, as before.

## Owner confirmations and open risks

All three HTML `OWNER:` comments are in `public/privacy.html`:

1. Confirm the operator's legal name and add it as the person/entity responsible for this information.
2. Confirmed: Hetzner; Nuremberg, Germany (EU); server logs rotate automatically by size and age, with no fixed day count.
3. `support@duelingdomain.com` is live on Private Email and forwards to the owner; it is the only public contact address.
   No home address or personal email is published.

Outstanding: actual local-font download/measurement; Docker routing/CSP/browser/layout verification; owner
privacy identity/contact/retention confirmations; an operational unsubscribe/deletion process; final Clerk
integration/production DNS; real invite delivery; and post-deploy indexing/performance checks. The published
consent/privacy notice allows alpha invites and alpha news only. The mailbox-based withdrawal route must work
before collecting real signups. This task adds no analytics, cookie banner, auth code or account-cookie changes.
