# Effect search foundation contract

Cube batch addition, phrase seed preview/confirmation, cube description
resolution and draft pool-health fields are specified in
[the cube backend contract](effect-search-cube-contract.md).

The stable shared exports are `@yugidraft/shared/cards/effects`,
`@yugidraft/shared/cards/effects/capability` and `@yugidraft/shared/services`.
The capability subpath is safe for client attribution imports and does not pull
the schema, database, artifact loader or scoring code into the browser.
`@yugidraft/shared/cards/effects/name-match` supplies the lightweight name helpers
to immediate draft-pool search without importing the full effect module.

## Pure reader, matcher and synergy

```ts
effectSearchEnabled(env?: Record<string, string | undefined>): boolean;
mayReadEffect(text: string): boolean;
resolveEffectName<T extends { name: string }>(entries: readonly T[], text: string): T | undefined;
compactEffectName(name: string): string;
buildArchetypeMatcher(names: Iterable<string>): (text: string) => { name: string; start: number; end: number }[];
interpret(input: string, findArchetypes?: ReturnType<typeof buildArchetypeMatcher>): Interpretation | null;
omitReadingChips(reading: Interpretation, omitted?: readonly string[]): Interpretation | null;
describe(query: EffectQuery): string[];
matchCard(card: Card, tags: MatchTags | undefined, query: EffectQuery): number | null;
engineInsightCard(card: DeckCardInfo, archetypes?: ReadonlyMap<number, string>, popularity?: number): Card;
filterReachesCard(filter: CardFilter, card: Card): boolean;
cardSynergy(anchor: Candidate, candidate: Candidate): CardLink;
scoreForDeck(candidate: Candidate, deck: readonly Candidate[], profiles?: ReadonlyMap<string, ArchetypeProfile>): RankedInsightCard;
rankForDeck(deck: readonly Candidate[], candidates: Iterable<Candidate>, options?: { limit?: number; profiles?: ReadonlyMap<string, ArchetypeProfile>; deckMaster?: Candidate }): RankedInsightCard[];
findPartners(profile: ArchetypeProfile, archetype: string, candidates: readonly Candidate[]): { hooks: HookResult[]; partners: Partner[] };
```

`Candidate = {card: Card; tags?: CardTags}`. The normalized `Card` describes the
engine/catalog metadata; it is not a second external catalog.
`CardLink = {score: number; reason: string; reasons: string[]}`.
`RankedInsightCard = {passcode: number; name: string; score: number;
linkedCards: number; reason: string; deckMasterFit?: boolean}`.
`Interpretation = {query: EffectQuery; chips: string[]}`. An effect match returns
`null` for rejection and a specificity score otherwise. Deck ranking counts
distinct canonical anchors before score and snapshot popularity. Reasons
describe mechanical links rather than estimated win rates.

Copied schema exports retain the upstream vocabulary: `CardTags`, `CardFilter`,
`GameEvent`, `Effect`, `ArchetypeProfile`, `Hook`, `fillDefaults`, `dropDefaults`,
`readHook`, `readProfile`, `hookQuery`, and the card/vocabulary enums. Stored
fields remain compatible with the credited artifact.

## Artifact and storage

```ts
verifyCardEffectArtifact(directory?: string): { version: string; tags: number; profiles: number };
normalizeCardEffectSourceText(card: { text: string; pendulumText?: string }): string;
hashCardEffectSourceText(card: { text: string; pendulumText?: string }): string | null;
importCardEffectArtifact(db: Database.Database, options?: {
  directory?: string;
  remaps?: ReadonlyMap<number, number>;
  canonicalize?: (passcode: number, name?: string) => number;
  textFor?: (passcode: number) => string | undefined;
}): CardEffectArtifactImportReport;
```

`textFor` is retained for compatibility and does not manufacture tag freshness.
`text_hash` always comes from the pinned tagged-input sidecar, with `null` for
unknown input. The report is `{version, skipped, tags, profiles, preservedTags,
preservedProfiles, coverage}`. Coverage fields are `{catalogCards, taggedCards,
missingCards, percent, missing: {passcode, name}[], artifactOnlyPasscodes}`.

| Table | Fields |
| --- | --- |
| `card_tags` | `passcode` integer PK, `summary`, `roles_json`, `tags_json`, `popularity`, nullable `text_hash`, `source`, `tagged_at`, `schema_version` |
| `card_tag_profiles` | `archetype` text PK, `plan`, `hooks_json`, `source`, `profiled_at`, `schema_version`, `cards` |
| `card_tag_artifact_imports` | `artifact_version` text PK, `manifest_hash`, `schema_version`, `source_commit`, `tags`, `profiles`, `imported_at`, nullable `passcodes_json`, nullable `archetypes_json` |

Import writes each artifact version once to the shared disk database. It streams
the pinned files through bounded temporary storage. Publication verification
checks the full normalized schemas. Startup checks the exact pinned hashes and
counts, and stores original passcodes and names in `passcodes_json`. This lets
later reads apply current identity rules without parsing tag bodies again.
Older import receipts acquire these memberships on their first read.

`applyEngineCardRemaps` carries every tag field, retaining an existing official
row on collision. Profiles have no passcode key to remap. Startup folds known
artworks and verified remaps; absent upstream artwork IDs can bridge by one
unambiguous canonical printed engine name. Ambiguous names remain separate.

## SQL insight service

```ts
createCardInsightService(db: Database.Database, options?: { dataDirectory?: string }): CardInsightService;
service.summary(passcode: number): CardInsightSummary | null;
service.readQuery(text: string): Interpretation | null;
service.effectSearch(text: string, pool?: readonly number[], options?: CardInsightOptions): CardEffectSearchResult;
service.worksWith(passcode: number, pool?: readonly number[], options?: CardInsightOptions): RankedInsightCard[];
service.suggestForDeck(deck: DuelDeck | readonly number[], options: CardInsightOptions & { pool?: readonly number[]; format: CardInsightFormat }): RankedInsightCard[];
service.poolHealth(cards: readonly number[], options?: { era?: CardEra }): CardPoolHealth;
service.pickScore(candidate: number, pickedPool: readonly number[]): number;
service.pickScores(passcodes: readonly number[], pickedPool: readonly number[]): CardPickInsight[];
service.packFits(passcodes: readonly number[], pickedPool: readonly number[]): Map<number, string>;
```

`CardPickInsight = {passcode: number; score: number; reason?: string}`.
Pack fit reasons and automatic picks share the same mechanical-link and
missing-role policy. Pack reads share one catalog/profile snapshot; the web
caches reasons by viewer, exact pack and picked pool. Blocked choices receive
no displayed reason. See [smart draft picks](effect-search-draft-picks.md).

`CardInsightFormat = "normal" | "domain" | "genesys" | "genesys-domain"`.
`CardInsightOptions = {limit?: number; format?: CardInsightFormat;
genesysRemaining?: number; exact?: boolean; omittedChips?: readonly string[];
deckMaster?: number; released?: ReleasedRange; sort?: "match" | "newest";
era?: CardEra}`. Release range and era types are in
[the date contract](effect-search-dates.md). Default limit is 30; maximum is 120. `[]` means an empty
pool; an absent pool means the cached public catalog. Candidates stream from
SQLite, with only anchors, relevant profiles and the retained page in memory.
The optional engine handle is read-only and queried by passcode. Explicit pools
and anchors can use engine metadata when that passcode has not entered the
application catalog cache. Such cards retain unknown Genesys points and remain
excluded from Genesys recommendations until current points are available.

Summary fields are `{passcode, summary, roles, source, textHash, taggedAt}`.
Effect results are `{reading, cards, total}`. Pool health fields are `{cards,
roles: {searchers, extenders, removal, handTraps}, extraDeck: {synchro, tuners,
nonTuners, fusion, xyz, link, fusionEnablers, linkMaterialMonsters, xyzLevels},
unlinkedPasscodes, untaggedPasscodes, era?, warnings}`. Counts describe distinct cards,
not copies. Supply warnings are observations and do not replace deck legality.
Genesys uses current-revision points, excludes Link/Pendulum and unknown points,
and respects the remaining budget. Domain fit records a positive mechanical
link to the Deck Master. The separately stored Deck Master is excluded from
recommendations.

## Host and web routes

```ts
createCanonicalEffectResolver(cards: CardDatabase): (passcode: number, name?: string) => number;
createCardEffectIndex(db: Database.Database, cards: CardDatabase): CardEffectIndex;
initializeCardEffectIndex(db: Database.Database, cards: CardDatabase): Promise<CardEffectIndex>;
cardEffectIndex(cards: CardDatabase): CardEffectIndex | undefined;
queryCards(cards: CardDatabase, query: CardQuery, entries?: readonly CardBlockEntry[],
  genesysPoints?: ReadonlyMap<number, number | null>,
  options?: { effects?: CardEffectIndex; releases?: ReadonlyMap<number, ReleaseDates>; effectSearchEnabled?: boolean }): CardQueryResult;
```

`CardEffectIndex` has `size`, `release(code)`, `readQuery(text, omitted?)`,
`match(code, reading)` and `popularity(code)`. It keeps summary-free facets,
interned arrays/filters and shared printed-type fragments. Startup imports once
per artifact version. It awaits the asynchronous initializer before it accepts
requests when enabled. The synchronous API remains for in-memory callers.
The signed host `card-query` operation remains on
`POST /internal/duel`, with trusted `guildId`, `playerId`, `cardQuery` and the
existing admission context.

`POST /api/decks/cards` uses the existing authenticated, configured-guild actor.
Its flat request is the existing validated `CardQuery` plus `mode`, `format`
and optional session `slug`. Added query fields are:

| Field | Meaning |
| --- | --- |
| `exact?: boolean` | Disable the reader and retain legacy name/text token matching |
| `effectOmit?: string[]` | Remove whole facets by display label; max 24 labels, each max 200 characters |
| `effectOffset?: number` | Independently page effect hits; defaults to name offset |
| `passcodes?: number[]` | Restrict both groups to a canonical pool; max 5,000 IDs, artworks folded; `[]` is empty |

Response fields are `{cards, total, offset, effectSearchEnabled,
reading?, effectHits?, effectTotal?, effectOffset?}`. `cards` remains the first
group. Each card is `DeckCardInfo` with `altArtCount`, current `genesysPoints`
and optional `unavailableReason`. Effect hits also have `score` and `reason`;
their page is capped at 30. Reading is `{query, chips}` or `null` when enabled.
Disabled responses omit the additional group and report the capability false.
All existing kind, subtype, Type/Attribute/stat, archetype, banlist, pool,
Genesys and admission checks apply before effect matching. Successful ordinary
name queries retain their scan; compact/typo fallback runs only on no hits.

`POST /api/cards/insights` requires `requireWebAccess()` and configured
`DISCORD_GUILD_ID`. It accepts public passcodes, rejects caller `guildId`, private
cube/draft references and unknown fields, and never reads a private saved pool.

| `op` | Required request fields | Optional request fields | Response fields |
| --- | --- | --- | --- |
| `summary` | `passcode` | none | `summary` or `null` |
| `read` | `text` | none | `reading` or `null` |
| `effectSearch` | `text` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster`, `exact`, `omittedChips`, `released`, `sort`, `era` | `reading`, `cards`, `total` |
| `worksWith` | `passcode` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster`, `released`, `sort`, `era` | `cards` |
| `suggest` | `deck` | `pool`, `limit`, `format`, `genesysRemaining`, `deckMaster`, `released`, `sort`, `era` | `cards` |
| `poolHealth` | `cards` | `era` | `health` |
| `pickScore` | `candidate`, `pickedPool` | none | `score` |

Enabled responses include `{effectSearchEnabled: true, attribution}` and use
private/no-store caching. Disabled: HTTP 404 `{effectSearchEnabled: false,
error: "effect_search_disabled"}`. Missing community: 503; unauthenticated: 401;
malformed fields: 400; body over 64 KiB: 413. Text max 512 characters, suggestion
deck max 100 entries, health/picked pools max 500, search pool max 5,000.
Detailed shapes and bounds also appear in `effect-search-insights.md`.

## Seed preparation and cube era

`prepareCubeSeedIndex(db)` is the synchronous fixture API.
`initializeCubeSeedIndex(db)` returns one shared preparation promise per database.
`ensureCubeSeedIndex(db)` waits for cold or effect-data preparation. Both web
preview routes call it after access checks and the request guard. Web
`register()` does not prepare a seed snapshot.

The snapshot effect key uses `card_effect_revision`. Only tags, profiles,
releases and archetypes advance that revision. The engine key tracks
`cards.cdb`, `strings.conf`, `card-remaps.json` and `manifest.json`. Catalog,
artwork and set writes keep the current snapshot available. They start one
background refresh at a time, at most once a minute. A disposable process
builds disk snapshots. The web process loads the completed data. Preparation
for in-memory fixtures remains synchronous. Current artwork identities and
cube exclusions apply before the next preview, including during refresh.

`GET /api/cubes/[id]/era` uses the same community and owner checks as cube
previews. It returns `{effectSearchEnabled, attribution, era?, newerCount}`
with private/no-store caching. It reads the full saved cube and release dates,
with verified remaps and engine artwork identity. It does not parse tags or
run health analysis. The public insights route still rejects private cube IDs.

Describe keeps one rounded era while that mode is open. Reopening the mode
uses the latest cube era. A reserved note area keeps the results in place.
A cube edit does not cause an automatic description search.

When effect search is off, date sorting and filtering use a release-date map.
They do not build or retain effect facets. The returned cards keep their
release metadata.

The ATK reader accepts 3–5 digit values. “Or less/lower” sets a maximum;
“or more/higher” sets a minimum. A short attack count such as “attack 2 times”
does not become an ATK stat filter.

## Flag and attribution

`EFFECT_SEARCH=1` enables the feature; literal `0` disables it. Absent defaults
on outside production and off in production. Web sends the capability to its
clients; there is no public environment variable. Exact text disables reading
without changing the capability. Summaries appear as ordinary card summaries,
without an AI label. Hover changes color or outlines, with no card movement.

Copied-source headers, root `NOTICE` and data `NOTICE.md` preserve
credit to LorenzoWhite/searchygo at `9b2d952`. The UI shows no credit.


## Phrase search improvements (2026-10-19)

Unknown reader words in `query.text` only boost name/text ranking; they never
reject an effect hit. Exact text retains its existing behavior.

Deck and insights search responses (including `/api/cards/resolve`) add `relax: {chip: string, count: number}[]` (at most two).
When no results remain, each count is the result total with only that displayed
chip omitted, preserving the pool, all other chips and every outer filter.
Only positive relaxations are returned, ordered by count descending then chip
label. No useful relaxation produces `[]`. `effectOmit` / `omittedChips` accepts
the returned chip unchanged. Disabled deck responses omit `relax`.

`reading.query.intent` is optional:

```ts
{ kind: "similar", passcode: number, name: string }
{ kind: "counters", archetype: string }
```

`cards like Ash Blossom`, `similar to Effect Veiler` and `budget Ash Blossom`
resolve a canonical anchor and rank weighted overlap of roles, actions, zones
and kind, excluding the anchor. Budget means mechanical alternatives; it does
not claim a market price. `how to beat Snake-Eye`, `counters to Kashtira` and
`stop Tearlaments` derive opposing queries from the pinned archetype's reliance
hooks using the credited counter matcher. Both intents use the existing filters
and paging. Their chips are `Like: <canonical name>` / `Counters: <archetype>`.
Omitting the intent chip removes that constraint.

Existing `effectHits[].reason` (deck API) / `cards[].reason` (insights API) now
holds one deterministic string of at most 70 characters from matched mechanics
and the stored summary. Similarity and counters explain their mechanical link.
The existing `score` is a relative ordering value, not a probability. No UI
component or new request field is required. The optional hard-phrase fallback
uses these same response shapes with no model label; its operational and
budget contract is in [effect-tagging.md](effect-tagging.md#optional-runtime-phrase-reader).
