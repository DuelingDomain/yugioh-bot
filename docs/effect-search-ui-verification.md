# Effect search UI verification

Verified on 2026-10-18 with Node 22.23.3, Chromium, and the working tree based on
`3e6e2f4b0`, including the effect-search performance changes.

All 24 existing browser cases passed in 165.7 seconds, with no retries, skips,
or failures. Every spec covered 1920×1080, 2560×1440, 1366×768, and 390×844.

| Existing spec | Passing cases | Coverage |
| --- | ---: | --- |
| `effect-search.spec.ts` | 4 | Reading chips, exact text, name search, attribution, summaries, stationary hover, separated badges, and no horizontal overflow |
| `effect-search-cube-ui.spec.ts` | 8 | Describe results, batch selection/add/remove, tooltip geometry, primary-action clearance, phrase preview/remove/confirm, and name search |
| `effect-search-deck-ui.spec.ts` | 4 | Works-with icon/chip/keyboard action, suggestions, add-to-deck state, attribution, and no horizontal overflow |
| `effect-search-draft-ui.spec.ts` | 8 | Removable pool batches, theme preview without writes, confirmation, pool health, and no horizontal overflow |

Search and cube screenshots were visually inspected at all four sizes. Phone
suggestions, phrase preview, and theme health were also inspected. Dueling Domain
branding and summaries without an AI label
remain present; no searchygo text shows. Card art uses the existing E2E image stub. The existing deck spec
supplies suggestion/partner rows; it checks their UI rather than ranking quality.

## Isolated runtime

The run used an authenticated Next.js development server with webpack on port
3371 and a small HTTP adapter around the real `createDuelHost` on port 4331.
The web sent signed requests through its normal duel-host transport. The host
accepted 33 `card-query`, 8 `card-facets`, and 12 `card-details` requests, all with
HTTP 200. Search results used the real artifact and engine catalog.

The original application database was opened read-only and backed up before use.
Only card catalog/artwork rows were copied from that backup into a fresh fixture
with E2E users. Startup loaded 2,047 catalog rows, 13,694 imported tag records,
and 14,845 engine records. Engine resources were read-only and unchanged.

All Node services used a filesystem preload that rejected `.env*` existence and
read operations. Next's four environment-file probes were denied before reads;
service settings and throwaway secrets were supplied explicitly. Port 3000 was
untouched. The temporary processes were stopped by explicit PID, and their ports
were checked closed. The database copies, throwaway secrets, generated Next build,
and generated type-reference changes were removed after the run.

This reduced stack verifies effect-search UI and authenticated signed card APIs.
It does not validate WebSocket delivery, worker jobs, standalone production
packaging, or duel-core gameplay. The draft page's expected missing-WebSocket
warnings did not prevent its HTTP-based checks from passing.

## Evidence and reproduction

Evidence is under `.status/effect-search/perf-browser/`:

- `results.json`: final Playwright report, 24 expected and zero unexpected results.
- `verification.json`: concise run metadata and inspected screenshot paths.
- `http-operations.json`: accepted signed host operation counts.
- `env-guard.jsonl`: rejected environment-file probes, without file contents.
- `cube/`, `deck/`, `draft/`, and `results/`: 48 screenshots.
- `web.log`: final isolated web log.

The disposable `start.mjs`, `no-env.cjs`, and `playwright.config.ts` retain the
setup. After building shared, start the harness from the repository root with
Node 22 and `prlimit --core=0`, preloading `no-env.cjs` and `tsx`, with
`EFFECT_SEARCH=1` and `THEME_DRAFTS=1`. Then run:

```sh
prlimit --core=0 node node_modules/@playwright/test/cli.js test \
  --config .status/effect-search/perf-browser/playwright.config.ts
```

Initial Next route compilation exposed a directory-asset resolution failure in
the artifact's static `new URL` expression under both Turbopack and webpack.
The shared artifact now uses path resolution; the successful run includes that
fix. Initial failure reports and `webpack-path-failure.log` are retained separately.
