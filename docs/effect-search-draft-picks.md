# Smart draft picks

Implement the approved phase 3 plan on the effect-search foundation.

1. Add SQLite integration coverage for a fixed-seed eight-seat draft and a
   random-policy draft with the same deal. Compare every seat's mechanical links.
2. Add one shared scorer for popularity, `pickScore`, Main/Extra balance and
   material supply. Keep seeded variation small and stable across service restarts.
   Use only legal options, retaining copy caps, forced picks and theme phases.
3. Use that scorer in the web bot loop and timeout expiry. Add private,
   flag-controlled fit reasons to the current human pack in draft responses.
4. Run targeted integration/regression checks, consumer type checks and the four
   required browser viewports. Keep all work and commits in this worktree.

This task supplies the draft UI contract; it does not change draft-room presentation.

## Contract

Both `GET /api/drafts/[slug]` and `POST /api/drafts/[slug]/pick` return the same
additive fields. Existing card order, instance IDs, artwork passcodes and pick
requests are unchanged.

| Field | Type | UI use |
| --- | --- | --- |
| `effectSearchEnabled` | `boolean` | Capability from server-side `EFFECT_SEARCH` |
| `attribution` | optional `string` | Exact line: `Effect search powered by searchygo`; present when enabled |
| `currentPack[].fitsYourPool` | optional `string` | A short pool link or missing-role reason; UI may prefix it with “Fits your pool” |
| `currentPack[].id` | existing `number` | Draft card instance to send as `cardId` when picking |
| `currentPack[].passcode` | existing `number` | Card identity/artwork; do not use as the pick instance ID |

Reasons are calculated against the authenticated participant's own picked pool
with the same logic as `pickScore`. They are absent for zero scores, blocked
choices, empty pools and disabled capability. A viewer without a seat receives
no pack or pool. No numeric bot score, other seat's pool or private cube is added
to this response. Render reasons outside existing corner badges and keep card
geometry fixed on hover. This branch adds the optional card type field for the
UI; it does not render a new draft-room badge or reason line.

## Shared policy

`createDraftService(db, { pickSeed? }).rankPickOptions(draftId, playerId)` returns
legal current-pack `DraftCard`s with internal `score`, numeric `pickScore` and
optional `fitsYourPool`, highest score first. Both web bots and
`expireCurrentPickStep` use the first choice. These scores are internal service
fields, not new web response fields. `pickOptions` remains unsorted and unchanged.

The score combines logarithmic snapshot popularity (up to 2), logarithmic
`pickScore` pool fit (up to 8), Main/Extra target balance, material supply (+4 or
−4), and Main Deck additions that enable an already picked Extra monster (up to
3). A deterministic SHA-256 draw contributes less than ±0.3. It uses draft,
player, round, step and draft-card IDs, plus the optional test seed. Request and
worker restarts retain the same ordering. Pick variation never consumes the
secret deal RNG. Dedicated Main/Extra phases, quotas, copy limits, forced picks,
and theme pool/burn rules remain authoritative.

The insight service adds `pickScores(passcodes, pickedPool): CardPickInsight[]`,
where each item is `{passcode, score, reason?}`. Its scalar `pickScore` delegates
to the same operation. One pack shares a pool/profile snapshot instead of opening
the read-only engine for each choice. Name search does not use this path.

Smart automatic choices apply regardless of `EFFECT_SEARCH`. The flag controls
human-facing reasons and attribution, consistent with the requested API gate.
No paid model call, tag-generation change or schema migration is added.

## Material limits

Material estimates use picked copies, separate requirement slots and known card
metadata. Synchros check Level totals and printed Tuner/non-Tuner counts;
Xyz monsters check matching Levels; Links check body supply and different names;
Fusions check their materials and a tagged Fusion enabler or self-summon
procedure. Real-tag regressions cover Trishula, Tyrant Red Dragon Archfiend,
Stardust Dragon, Knightmare Phoenix and ABC-Dragon Buster.

This is a draft heuristic, not a summon-legality solver. Conditional effects,
alternate summon methods, access to materials during play, summon locks and
multi-step Extra Deck climbing remain outside this estimate. Missing or
incomplete tags can reduce ranking quality. The eight-seat quality comparison
uses controlled linked families, not a measured win rate over arbitrary cubes.

## Verification

Node 22.23.3; heavy commands used `prlimit --core=0`. Targeted Vitest runs used
one worker. All new tests are integration or browser e2e tests.

| Check | Result |
| --- | --- |
| Shared scoring, pinned artifact, draft phases/caps, concurrency, bot/worker timers | 203 tests passed, 10 files |
| Web bot picks, fit reasons, flags/privacy, terminal races, caps and resilience | 70 tests passed, 8 files |
| Shared and web TypeScript checks | Passed |
| Shared, WS, duel-server, worker and production standalone web builds | Passed |
| Playwright draft + effect-search viewport flows | 8 cases + 5 auth setup cases passed |

The complete eight-seat draft uses a fixed shuffle seed and pick seed. Every
40-card smart pool has a higher total mechanical link score than the same
seat's pool under seeded random picks. Timeout-only play produces exactly the
same eight pools as the smart bot policy. Repeating the draft reproduces all
pools. The scalar/batch `pickScore` parity check uses the real pinned artifact.

Browser checks ran at 1920×1080, 2560×1440, 1366×768 and 390×844. They cover the
live pick response and draft layout, and the foundation's brand, credit,
summary, stationary-hover and nonoverlapping-badge checks. Draft screenshots
at all four sizes were visually inspected. Evidence remains in
`packages/e2e/test-results/` and `.status/e2e-results.json`.

Only isolated ports 3387/3388/4388/4389 were used. The prepared engine snapshot
was read-only. Its wrapper pin differs from this branch's installed checked-in
patch, so the existing `prepareManualData` helper verified the installed patch
and created an isolated manifest in `.status/draft-picks-engine-runtime` with
symlinks to the unchanged engine resources. No engine preparation ran.

The E2E worker's unrelated startup Genesys sync logged a SQLite lock while the
duel host imported tags; all requested flows passed. This startup contention
remains outside the draft change. The web build also retains its existing
dynamic-path tracing warning. Root Vitest commands exclude `**/.next/**` so
standalone source copies are not counted as additional tests.

Reproduce the main integration slice after building shared:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/draft-smart-picks.integration.test.ts \
  packages/shared/tests/card-insights.integration.test.ts \
  --exclude '**/.next/**' --maxWorkers=1
prlimit --core=0 -- npx vitest run \
  packages/web/tests/draft-smart-picks-route.integration.test.ts \
  packages/web/tests/drafts-pick-terminal-race.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
```

The reviewer reproduced and verified the material edge cases; no findings
remain from that review. Build outputs are removed after validation;
`node_modules`, browser evidence and this local branch are retained. Nothing is
pushed.
