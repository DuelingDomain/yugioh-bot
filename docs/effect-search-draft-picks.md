# Smart draft picks

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
geometry fixed on hover. The optional card type field is available to the UI;
the draft room currently leaves fit reasons unrendered.

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
human-facing reasons and attribution.
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

Integration coverage includes fixed-seed eight-seat drafts, supported Extra Deck
picks in mixed booster cubes, theme material requirements, copy limits, timeout
fallbacks and database-busy propagation. A performance fixture expires eight
seats with fifteen Synchros in each pool and requires the step to finish in less
than 1.5 seconds, for both matching and unusable pack options. Ranking opens one
catalog; draft response coverage checks that reasons do not invoke ranking.

Run the targeted integration slice on Node 22 after building shared:

```bash
npm run build --workspace=packages/shared
prlimit --core=0 -- npx vitest run \
  packages/shared/tests/draft-smart-picks.integration.test.ts \
  packages/shared/tests/card-insights.integration.test.ts \
  --exclude '**/.next/**' --maxWorkers=1
prlimit --core=0 -- npx vitest run \
  packages/web/tests/draft-smart-picks-route.integration.test.ts \
  packages/web/tests/drafts-pick-terminal-race.test.ts \
  -c packages/web/vitest.config.ts --maxWorkers=1
```

The isolated browser stack runs `draft-smart-picks.spec.ts` at 1920×1080,
2560×1440, 1366×768 and 390×844. It checks the live pick response, stationary
hover geometry and horizontal overflow, then deletes its draft, bot identity
and fixture catalog rows. See `packages/e2e/README.md` for stack setup.
