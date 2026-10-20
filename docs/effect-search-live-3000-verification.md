# Owner deck-builder verification on port 3000

Verified on 2026-10-19 against `http://localhost:3000/decks/new`, served from
`web-live`, using Node 22.23.3. Nothing was pushed.

## Cause

The full-catalog query `hand trap` was interpreted correctly, but its empty
name-result group invoked fuzzy name correction. That selected
`The Traveler and the Burning Abyss`, cleared the reading and discarded all
effect hits. The fallback now preserves every complete effect reading, extending
the existing protection for support queries. Compact name aliases and typo
queries with remaining text retain their existing behavior.

On arrival, both running services already had `EFFECT_SEARCH=1`. Authenticated
requests through the actual web route returned `effectSearchEnabled=true`, and
the negate query already showed its controls in a fresh browser. The earlier
missing-controls state was not reproduced. Explicit literal mode (`exact:true`)
reproduced the reported counts exactly: 1,071 and 5. There is no evidence from
this run that the live index or web-to-host transport was disabled or missing.

The browser's summary also counted only literal hits, showing `0 cards` over a
populated effect group. It now includes effect hits. Pool totals and partner
counts keep their existing semantics.

The production rebuild uncovered an existing Next 16 route-type error:
`GET(request?: Request)` on `/api/decks`. The route now requires `Request`, and
its direct test callers supply one. This correction and both search corrections
are applied on `test/local-all` and `feat/effect-search`.

## Live results

| Query | Capability | Literal matches | Effect matches | Required cards |
| --- | --- | ---: | ---: | --- |
| `hand trap` | true | 0 | 183 | Ash Blossom & Joyous Spring; Effect Veiler; Droll & Lock Bird; Ghost Ogre & Snow Rabbit |
| `hand traps that negate` | true | 0 | 48 | Ash Blossom & Joyous Spring; Effect Veiler |

Droll & Lock Bird restricts adding cards; Ghost Ogre destroys cards. Neither
negates, so they are deliberately excluded by the negate filter.

Requests to `/api/decks/cards` used an authenticated owner session, signed with
the running local service's existing session settings in memory. The normal
Discord membership checks remained active. No test-login provider was enabled.
The script also called `/internal/duel` using the same shared `httpTransport`
HMAC path as the web route, with the existing owner player mapping. The web
and direct-host responses matched exactly for both queries.

Chromium verified both queries at 1920x1080 and 390x844, without response mocks:
capability true, named cards in the DOM, `Exact text` visible and off, removable
reading chips, no searchygo text, the correct summary count,
and `Cards that do this` as the first result-group heading. No page errors
occurred. The first page of the broad query contains all four requested cards.

Evidence is in `.status/effect-search/live-3000/`: `prove.mjs`, `results.json`,
and desktop/mobile screenshots for both queries. No cookies, credentials,
headers or process-environment dumps are saved there.

## Checks and deployment

- The singular full-catalog regression failed before the fallback correction;
  singular/plural regressions and all 117 duel search/evaluation tests passed
  in each checkout afterward.
- The summary-count regressions failed before the UI correction and passed
  afterward in both checkouts.
- Four web effect-route checks and seven deck-list/registration checks passed
  in each checkout. Seven local component checks passed; the source checkout
  passed both new summary-count checks.
- Shared and duel-server builds, the Next production build with webpack, and
  standalone packaging passed. The effect artifact verified unchanged at
  `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`.
- The standalone output and effect assets were copied to `web-live`. Both user
  systemd services were restarted and are active with `LimitCORE=0`.

The duel unit was transient and disappeared when stopped during deployment. It
was recreated with its original Node command, working directory, environment
file references and drop-ins. Its sandbox allowlist was restored from the
running web process using `systemd-run --setenv`, without printing or persisting
the IDs. The final check compares both allowlists and the shared database and
engine paths. Future deployments should restart transient units directly.

Commands ran with `prlimit --core=0` and the requested Node 22 PATH. A filesystem
preload prevented application/build `.env*` reads; deployment copies excluded
`.env*`. Systemd continues to load its existing configured environment files.
No environment file was inspected, no engine data was modified, and no process
was killed by name. The deployed preload and service drop-ins retain the
no-env-file-read guard and core limit.

## Publish rule for `web-live`

Never run `rsync` into `web-live` while the web unit is running. The running
Next.js process loads chunks on demand (for example the hashed
`better-sqlite3-<hash>` module). A half-copied folder gives
`Cannot find module` errors, and :3000 answered "internal server error" for
about one minute after the 2026-10-19 duel-start publish.

Use this order for every publish:

1. Build in `local-all` (`next build --webpack`, then `npm run package:standalone`).
2. Stop the web unit: `systemctl --user stop yugidraft-web-local`.
3. Copy: `rsync -a --delete --exclude '.env*' local-all/packages/web/.next/standalone/ web-live/`.
4. Start the unit: `systemctl --user start yugidraft-web-local`, then check that
   `http://localhost:3000/` answers 302.
5. Restart `yugidraft-duel-server` in the same step when the duel server changed.

The stop-to-start gap is a few seconds and is cleaner than a broken page. The
other way is also allowed: `rsync` into a new folder (for example
`web-live.next`), stop the unit, rename the folders, then start the unit. Copy
nothing into a folder that a running process serves.

## Final review publish on 2026-10-20

The four PR 412 fixes are now on `test/local-all` and :3000. The source CI
passed at `157fad4f9`. This publish used the stop/rsync/start rule above, with a
systemd reference to keep the transient web unit loaded. The gap was 0.49 s.
The duel build completed in a staging directory before replacing its dist.
The temporary sandbox allowlist was restored from the web process after duel
restart. Both services retain the existing preload and LimitCORE=0.

The live owner API and desktop/mobile browser checks passed again: 183 hits for
`hand trap`, 48 for `hand traps that negate`, correct cards/chips/counts and no
page errors. The stale visible-attribution assertion in the local harness was
changed to require no attribution. Temporary build output was then deleted.
See [the final review record](effect-search-final-review-verification.md).
