# SQL card insights and HTTP contract

The shared service reads the imported searchygo artifact from SQLite. It never
loads the JSONL artifact or the complete tag table into web memory. Catalog
candidates are streamed with `iterate()`, and only the best requested page is
retained. Deck anchors and their individual archetype profiles are loaded on
demand. Ordinary name search uses its existing path.

```ts
import { createCardInsightService } from "@yugidraft/shared/services";

createCardInsightService(
  db: Database.Database,
  options?: { dataDirectory?: string },
): CardInsightService;

type CardInsightFormat = "normal" | "domain" | "genesys" | "genesys-domain";
interface CardInsightOptions {
  limit?: number;                 // Default 30, clamped to 1–120 by the service.
  format?: CardInsightFormat;     // Default normal.
  genesysRemaining?: number;
  exact?: boolean;
  omittedChips?: readonly string[];
  deckMaster?: number;
}

service.summary(passcode: number): CardInsightSummary | null;
service.readQuery(text: string): Interpretation | null;
service.effectSearch(text: string, pool?: readonly number[], options?: CardInsightOptions): CardEffectSearchResult;
service.worksWith(passcode: number, pool?: readonly number[], options?: CardInsightOptions): RankedInsightCard[];
service.suggestForDeck(deck: DuelDeck | readonly number[], options: CardInsightOptions & { pool?: readonly number[]; format: CardInsightFormat }): RankedInsightCard[];
service.poolHealth(cards: readonly number[]): CardPoolHealth;
service.pickScore(candidate: number, pickedPool: readonly number[]): number;
```

`summary` returns `{passcode, summary, roles, source, textHash, taggedAt}`.
Summary text is displayed directly, without an AI label. An absent tag returns
`null`; it does not trigger tagging or an external API call. `textHash` is the
stored nullable hash of the normalized source text that was tagged; catalog
and engine reads do not refresh it. `source` retains importer/Batch/manual
provenance.

`effectSearch` returns `{reading, cards, total}`. `reading` is the shared
`Interpretation` with `query` and display `chips`. Each card has
`{passcode, name, score, linkedCards, reason, deckMasterFit?}`. Total is the full
matching count before the page limit. Specificity and snapshot popularity rank
effect matches; mechanical links, then score and popularity rank synergy
matches. Synergy phrases such as `works with Dark Magician` resolve a printed
card name using the existing name and typo matcher, then use the same deck
scorer as `worksWith` and `suggestForDeck`.

`exact: true` bypasses interpretation and searches the entire input as a
case-insensitive literal substring of actual printed text. Its `reading` is
`null`. Without exact mode, unused interpreted words further constrain the
printed text. `omittedChips` removes entire display facets by their stable chip
labels; raw effect query objects are never accepted by the API.

An omitted pool searches the locally cached public catalog. An explicit `[]`
always returns no candidates. Explicit passcode pools and anchors also resolve
cards directly from the read-only engine database when the lazy public catalog
has no row yet. Their metadata and canonical tags are read by passcode; no
catalog rows are inserted and no full engine catalog is loaded. Artwork families, verified engine aliases and
engine passcode remaps resolve to canonical IDs; duplicates produce one result.
The optional engine database is opened read-only for one operation and queried
by individual passcode to supplement metadata such as monster Type. Optional
engine columns that are absent retain their existing catalog metadata. Optional
packed engine setcodes and `strings.conf` labels provide archetype membership
when the cached card has none. Its default
directory follows `DUEL_DATA_DIR` and the existing shared engine-directory
resolver. No engine resources are downloaded or modified.

Genesys and Genesys Domain exclude Link/Pendulum cards and cards without a
point value in the current `genesys_points_meta` revision. An optional remaining
budget further limits candidate cost; without it, no remaining-budget cutoff is
applied. Engine-only cards with no current catalog point value remain unknown
and are excluded from Genesys; engine metadata and effect tags never imply a
zero-point cost. Domain results annotate `deckMasterFit` when a Deck Master is known;
this means a positive mechanical link and is not a new legality rule.

`poolHealth` counts distinct canonical cards, not copies. Its shape is:

```ts
{
  cards: number;
  roles: { searchers: number; extenders: number; removal: number; handTraps: number };
  extraDeck: {
    synchro: number; tuners: number; nonTuners: number;
    fusion: number; xyz: number; link: number;
    fusionEnablers: number; linkMaterialMonsters: number;
    xyzLevels: Record<string, number>;
  };
  unlinkedPasscodes: number[];
  untaggedPasscodes: number[];
  warnings: string[];
}
```

Tuners, non-Tuners, level counts and Link material counts describe Main Deck
monster supply. Warnings report missing tagged roles, incomplete tags and
observed supply gaps against tagged material requirements. They do not prove
summon feasibility or deck legality. `pickScore` uses `scoreForDeck`, with one
additional point for each new searcher/extender/removal/hand-trap role in a
nonempty picked pool. Existing picked canonical cards score zero.

## POST /api/cards/insights

Every operation requires `requireWebAccess()` and a nonempty server-configured
`DISCORD_GUILD_ID`. The request cannot supply guild authority. The route accepts
explicit public passcodes only; `guildId`, `cubeId`, `draftSlug` and all other
unknown fields are rejected. It never reads another member's private cube,
draft, saved deck or pool.

| `op` | Required fields | Optional fields | Operation response fields |
| --- | --- | --- | --- |
| `summary` | `passcode` | none | `summary` (nullable) |
| `read` | `text` | none | `reading` (nullable) |
| `effectSearch` | `text` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster`, `exact`, `omittedChips` | `reading`, `cards`, `total` |
| `worksWith` | `passcode` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster` | `cards` |
| `suggest` | `deck` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster` | `cards` |
| `poolHealth` | `cards` | none | `health` |
| `pickScore` | `candidate`, `pickedPool` | none | `score` |

Enabled responses also include:

```json
{
  "effectSearchEnabled": true
}
```

Successful responses use `Cache-Control: private, no-store`. The capability
follows shared `effectSearchEnabled`: literal `EFFECT_SEARCH=1` enables it,
literal `0` disables it, and an absent flag defaults on outside production.
Disabled requests return HTTP 404 with no insight data:

```json
{"effectSearchEnabled": false, "error": "effect_search_disabled"}
```

No session returns 401; an unavailable identity resolver returns 503; a missing
configured community returns 503 `community_not_configured`. These checks run
before reading the request body or insight data.

The body is capped at 64 KiB, including chunked bodies without trustworthy
Content-Length (413). Malformed JSON or invalid fields return 400. Passcodes
must be numeric integers in `1..4294967295`. Pool arrays allow at most 5,000
entries; health/picked arrays allow 500. Suggestion decks allow 100 entries in
a numeric array or across all deck sections combined, limiting scoring work. A deck
may be a numeric array or `{main, extra, side, deckMaster?}` with every section
present. Text must be nonblank and at most 512 characters. Limits must be
integers in `1..120`, remaining budgets in `0..1000`, `exact` a boolean, and
omitted chips at most 16 nonempty strings of at most 256 characters. Format
must be one of the four values above; omitted format defaults to normal.

The service and route integration suites use the full pinned artifact and
SQLite, covering canonical artwork IDs, engine Type metadata, summaries,
effect interpretation, literal mode, mechanical links, explicit empty pools,
current Genesys cost/budget filters, Domain fit, pool warnings, authentication,
configured-guild authority, the capability flag and request limits.
