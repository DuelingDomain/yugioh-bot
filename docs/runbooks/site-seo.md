# Site checks and IndexNow

Static checks for the marketing site (`site/public`), and a best-effort ping that tells search engines which pages changed.

## Purpose

Keep every public page valid for search (title, description, canonical, JSON-LD, sitemap, `llms.txt`) and tell IndexNow engines (Bing, Yandex and others) about changes after a deploy.

## Schedule & triggers

| Job | Trigger |
|---|---|
| Site checks (`.github/workflows/site-checks.yml`) | Pull requests and pushes to `main` that change `site/**` |
| IndexNow ping (`indexnow` job in `.github/workflows/deploy.yml`) | After a healthy Deploy that is not a rollback |

## What it changes

Site checks change nothing. The ping sends one HTTPS POST to `https://api.indexnow.org/indexnow` with the host, the key and the changed URLs. It sends the URLs of changed `site/public/*.html` pages. A change to `style.css`, `app.js`, `sitemap.xml` or `llms.txt` sends every URL in the sitemap. Only the changes in the deployed commit are compared (`<commit>^1..<commit>`). Changes from an earlier Deploy that was skipped are not resent: run the ping by hand with `--all`.

## Depends on

- The key file `site/public/<key>.txt`. It holds its own name as text. It is public by design and proves we own the host. To rotate it, add a new 32-hex file, delete the old one and deploy. `verify-static.py` fails unless exactly one key file exists.
- Outbound HTTPS from the GitHub runner. No secret is needed.

## Run it by hand

```bash
python3 site/src/sync-chrome.py --check      # shared header and footer match
python3 site/src/verify-static.py            # all page checks
python3 site/src/indexnow.py --all --dry-run # print the ping body, send nothing
python3 site/src/indexnow.py --all           # ping every sitemap URL
```

## Refresh the page screenshots

The guide pages use real game screenshots (`site/public/assets/shot-*.webp`). Retake them after a visible UI change with `scripts/site-screenshots.sh`. It runs only on a local isolated e2e stack with the offline test sign-in and seeded test players, and it refuses `NODE_ENV=production`. Details: [packages/e2e/screenshots/README.md](../../packages/e2e/screenshots/README.md). The boards come from dev-only `marketing-*` scenario presets (gated by `DUEL_SCENARIOS=1`) and the art is real card art from the normal image route (`E2E_REAL_CARD_ART=1`). One run writes all 5 WebP files (1600x900, 80 KB or less). Check every shot for real names, emails, avatars and debug labels before you commit it.

## Failure modes

- **Site checks red:** the assertion names the page and the rule. For a header or footer difference run `python3 site/src/sync-chrome.py`, then commit.
- **IndexNow warning in the Deploy log:** the ping failed or the engine answered with an error. The deploy is not affected (`continue-on-error`, and the script exits 0). Run the ping by hand. A 403 usually means the key file is not live yet; open `https://duelingdomain.com/<key>.txt`.
- **Browser layout checks** (`site/src/verify-browser.mjs`) are not in CI. They need Playwright, Chromium and local Caddy. See [site/README.md](../../site/README.md).
