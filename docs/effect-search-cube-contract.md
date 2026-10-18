# Cube effect search contract

This adds to [the foundation contract](effect-search-contract.md). All routes
require an authenticated application user and the configured community. Cube
library routes conceal another user's or community's cube with HTTP 404.
Callers must not send a user or community ID. Existing name search requests are
unchanged; description search is explicit.

## Batch add

`POST /api/cubes/:id/cards`

```json
{"op":"addBatch","entries":[{"id":46986414,"copies":3,"pool":"main"}]}
```

- `entries`: 0–1,000 rows. `id` is a positive uint32 passcode; `copies` is an
  integer from 1 to 99, stored as that row's `maxCopies`. `pool` is optional
  `main | extra`. The engine type overrides a supplied pool; catalog type is
  the fallback when no engine row is available.
- Existing canonical identities, including artworks and legacy config-backed
  cards, are skipped. Existing copy totals and artwork choices stay intact.
  Repeated identities in the request use the first row's copies and artwork.
- The response is `{pools, cards, added, copies, duplicates, moves?, messages?}`.
  `added` counts new distinct rows; `copies` counts their authored copies;
  `duplicates: number[]` contains distinct skipped **requested passcodes** in
  encounter order. Repeating an identical request adds zero cards.
- Missing display catalog entries are resolved before the cube transaction.
  Unresolved IDs return HTTP 400 `{error, unknownIds}` with no cube change.
  Lookup/network failures use the existing 429/503 card-fetch responses.
- Validation and insertion are atomic. A failed insertion rolls back every
  row and the cube timestamp. This operation is available with the effect flag
  off, as ordinary cube editing is.

`pools` and `cards` use the existing cube-detail shape:

```ts
type Pools = { main: CubeCard[]; extra: CubeCard[] };
type CubeCard = { catalogCardId: number; pool: "main" | "extra";
  maxCopies: number; source?: string };
type CardSummary = { id: number; name: string; type: string; frameType: string;
  effectText: string; imageUrl: string; imageUrlSmall: string;
  attribute?: string; level?: number; atk?: number; def?: number };
type Move = { code: number; name: string; from: "main" | "extra";
  to: "main" | "extra" };
```

## Seed preview

`POST /api/cubes/:id/seed/preview`

```json
{"phrase":"dark magician","targetCount":180,"maxCopies":3}
```

- `phrase`: required nonblank text, at most 512 characters.
- `targetCount`: optional integer 1–500; default 180. This is the number of
  **new distinct rows**, not copies or the cube's final size.
- `maxCopies`: optional integer 1–99; default 3. Applied to each preview row.
- The body has a 64 KiB limit. Unknown top-level fields are rejected.
- Preview reads the cached public catalog and pinned tags/profiles. It neither
  writes cube data nor fetches cards. A cold cache can produce a short preview.
- Selection reserves initial space for phrase/archetype members and mechanical
  partners while reserving room for unmet role quotas. It then fills those
  quotas from remaining relevant members/partners and generic staples. Unused
  category space goes to remaining relevant cards, then role staples. Ranking
  uses mechanical links, specificity, snapshot popularity and a passcode tie
  break. Up to 32 phrase matches serve as synergy anchors.
- Role quotas are searcher 12%, extender 18%, removal 12%, hand trap 8%, rounded
  down, with a minimum of one of each for targets of at least four. They count
  selected distinct cards, including members and partners. Quotas are goals;
  missing roles and catalog shortages produce warnings.

Response:

```ts
{
  effectSearchEnabled: true;
  attribution: "Effect search powered by searchygo";
  phrase: string; targetCount: number; maxCopies: number;
  reading: Interpretation | null; // foundation query/chips shape
  rows: Array<{ id: number; name: string; copies: number; pool: "main" | "extra";
    category: "archetype" | "phrase" | "partner" | "staple";
    reason: string; roles: string[] }>;
  cards: CardSummary[]; // join to rows by id
  roleQuotas: Record<"searcher" | "extender" | "removal" | "hand_trap",
    { target: number; selected: number }>;
  warnings: string[];
}
```

An unknown phrase returns an empty preview with a warning. It does not create
an unrelated staple pool. Existing cube identities are excluded. The response
uses `Cache-Control: private, no-store`.

## Seed confirmation

`POST /api/cubes/:id/seed/confirm`

```json
{"entries":[{"id":46986414,"copies":3,"pool":"main"}]}
```

Send only the chosen `{id, copies, pool?}` rows; no phrase or preview token is
required. Up to 500 rows and 64 KiB are accepted. This calls the same shared
`addBatch` operation. Confirmation rechecks access, card metadata, engine
sections and current duplicates, so a saved preview can safely be confirmed
after another edit. It returns the batch result plus `effectSearchEnabled`
and `attribution`, with private/no-store caching.

Preview and confirmation require `EFFECT_SEARCH=1` in production. A disabled
feature returns HTTP 404 `{effectSearchEnabled:false,
error:"effect_search_disabled"}`. Missing community returns 503; signed out
returns 401; invalid bodies return 400; oversized bodies return 413.

## Description search for the cube add rail

`POST /api/cards/resolve`

```json
{"op":"effectSearch","text":"hand traps that negate","limit":30}
```

Request fields match the foundation insight `effectSearch` operation:
`text`, optional `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster`,
`exact`, and `omittedChips`. Validation bounds are unchanged: text 512
characters, pool 5,000 IDs, limit 1–120. An explicit empty pool returns no cards.
Private cube/draft references and extra fields are rejected. The flag and
attribution apply only to this explicit description mode.

Response: `{cards, total, reading, unknownIds, effectSearchEnabled:true,
attribution}`. Each card is a `CardSummary` plus `score` and `reason`. Display
metadata for an explicit engine pool is resolved through the existing catalog
lookup budget. `unknownIds` lists matches whose display metadata could not be
resolved; `total` still describes the matching pool. Responses are private and
not cached. Existing `cardName`, `fuzzyName`, `archetype`, list and set/ID
requests retain their existing response shape and name path.

## Draft pool health

`GET /api/drafts/:slug/preflight`

For theme drafts, after existing access and setup checks, the response adds:

```ts
{
  errors: string[]; warnings: string[];
  effectSearchEnabled: true;
  attribution: "Effect search powered by searchygo";
  poolHealth: Array<{ cubeId: number; cubeName: string; health: CardPoolHealth | null }>;
}
```

`CardPoolHealth` is the foundation shape: `cards`, `roles`, `extraDeck`,
`unlinkedPasscodes`, `untaggedPasscodes`, `warnings`. It counts distinct
canonical identities. Extra cards are included only when Extra drafting is
enabled. The cube analysis classifies sections without repairing stored rows.
The shared `analyzeCubePools` result adds `poolHealth?: CardPoolHealth | null`
and appends health observations to its existing `warnings`.

Health never changes `ok` or adds errors. If health data is unreadable, `health`
is null and a warning explains that health is unavailable. Supply checks still
run. Health warnings also appear in top-level preflight `warnings`, prefixed
with the cube name. The UI should avoid presenting those same warnings twice.

Only eligible, attached, same-community cubes are analyzed. Deleted cubes are
skipped. Host-assigned health is returned only to the draft host, and only for
joined players' assignments. Existing hidden/setup-error early responses and
non-theme preflight responses retain their shape. With the flag off, health
fields and observations are absent. This route does not grant library access.

## UI requirements

Show `Effect search powered by searchygo` when rendering description results,
seed previews or health. Card summaries use ordinary prose with no AI label.
Keep name search on its existing request path. The cube UI worker owns browser
checks at 1920×1080, 2560×1440, 1366×768 and mobile width, including stationary
hover geometry, non-overlapping badges, active-only purple/gold accents and
visible Dueling Domain branding. This backend branch changes no UI components.
