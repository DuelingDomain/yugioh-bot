# Dueling Domain marketing site

Static HTML, CSS and JavaScript for the closed-alpha waitlist; no build step.

## Contents

- `public/`: served pages (`index.html`, `privacy.html`, `terms.html`, `404.html`), `style.css`, `app.js`, icons, sitemap, robots and manifest.
- `public/assets/`: card backs and trailer poster; `public/fonts/`: self-hosted WOFF2 files and licenses.
- `src/`: icon/poster/OG sources, asset builders, font installer and verification scripts.

## Local preview

```bash
python3 -m http.server 8080 --directory site/public
```
Open `http://localhost:8080`. This previews static content; waitlist POSTs and clean legal URLs need local Caddy configured as described in the [domains reference](../docs/deployment/domains.md).

## Editing

Edit copy in `public/*.html`, styles in `public/style.css` and interactions in `public/app.js`. Keep sitemap `lastmod` dates aligned with content changes.
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
Routing checks need Docker. Browser checks run against local Caddy, mock waitlist POSTs and write screenshots to `SHOTS_DIR`.
See [domains.md](../docs/deployment/domains.md) for live hosts, production checks and waitlist operations.
