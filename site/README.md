# Dueling Domain marketing site

Static HTML, CSS and JavaScript for the closed-alpha waitlist; no build step.

## Contents

- `public/`: served pages (`index.html`, `privacy.html`, `terms.html`, `404.html`), `style.css`, `app.js`, icons, sitemap, robots, manifest and `llms.txt`.
- `public/assets/`: card backs and trailer poster; `public/fonts/`: self-hosted WOFF2 files and licenses.
- `src/`: icon/poster/OG sources, asset builders, font installer and verification scripts.

## Local preview

```bash
python3 -m http.server 8080 --directory site/public
```
Open `http://localhost:8080`. This previews static content; waitlist POSTs and clean legal URLs need local Caddy configured as described in the [domains reference](../docs/deployment/domains.md).

## Editing

Edit copy in `public/*.html`, styles in `public/style.css` and interactions in `public/app.js`. Keep sitemap `lastmod` dates aligned with content changes.
The launch trailer is a click-to-load YouTube embed (youtube-nocookie.com). Set its 11-character video ID in `data-youtube-id` on `#case` in `public/index.html`; while the value is `VIDEO_ID`, the button keeps the "coming soon" behavior. Nothing loads from YouTube before the click. The marketing CSP allows only `frame-src https://www.youtube-nocookie.com`. The `<noscript>` watch link repeats the ID; change both places together (the link stays hidden while it is `VIDEO_ID`, and `verify-static.py` checks they match). On iOS Safari, autoplay with sound from a cross-origin frame often fails, so viewers may need a second tap on YouTube's play button; that is expected, not a bug.
Keep the homepage JSON-LD, manifest description and `llms.txt` consistent with visible product copy. `llms.txt` is required for this site. It provides public product context and links to the home, app sign-in, privacy and terms pages; it is not a Google indexing requirement or a promise of AI citations. Keep private app content out of it.
Do not name the game on public pages (verify-static.py enforces this). Retain the fan-project disclaimer, support email and legal links. Only advertise features verified in the code and available in the alpha; new theme drafts currently default off in production.
Edit asset sources in `src/`, then regenerate from the repository root using the existing sharp and Playwright packages:
```bash
NODE_PATH=/path/to/node_modules CHROMIUM=/path/to/chromium node site/src/build-icons.mjs
node site/src/build-icons.mjs --marks-only
node site/src/build-poster.mjs
```
Fonts are self-hosted. `python3 site/src/self-host-fonts.py` refreshes the five Latin WOFF2 faces, licenses, page preloads, OG source, privacy disclosure and Caddy CSP; it needs outbound HTTPS.
Use new font filenames when replacing installed files because `/fonts/` caches for one year. Motion follows `prefers-reduced-motion`.

## Verify

```bash
python3 site/src/verify-static.py
python3 scripts/deployment/verify-domain-routing.py
MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium SHOTS_DIR=/tmp/dd-site-shots node site/src/verify-browser.mjs
```
Static checks use Python's standard library and cover heading order, canonical URLs, social image dimensions, JSON-LD and `llms.txt` links. Routing checks need a running Docker daemon and a cached `caddy:2-alpine` image. Browser checks need Playwright, Chromium and local Caddy; they run headless, mock waitlist POSTs and write screenshots to `SHOTS_DIR`.
See [domains.md](../docs/deployment/domains.md) for live hosts, production checks and waitlist operations.
