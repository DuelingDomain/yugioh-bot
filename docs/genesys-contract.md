# Genesys shared contract

Genesys rules/settings helpers and types are exported from `@yugidraft/shared/duels`.
Service contracts use `/services`; catalog `Card` uses `/types`.
Engine mode remains `normal | domain`; table formats remain `1v1 | tag | ffa3 | ffa4`.
Genesys + normal displays as **Genesys**; Genesys + domain as **Genesys Domain**.

## Settings and saved decks

```ts
interface GenesysSettings { pointCap: number }
// Added to DuelSettings and SavedDeck (top-level, beside mode/deck):
genesys?: GenesysSettings | null;
```

- Missing/null means off, including old duels, series, replays and saved decks.
  Normalizers and saved-deck reads return explicit `null` for off.
- `normalizeGenesysSettings(unknown)` accepts null/undefined or `{ pointCap }`.
  `{}` enables `DEFAULT_GENESYS_POINT_CAP = 100`. Cap must be an integer in
  `0..MAX_GENESYS_POINT_CAP` (1000), inclusive. Unknown keys and invalid values throw `DuelSettingsError`.
- `normalizeDuelSettings` and `parseStoredDuelSettings` force `banlist: "none"`
  whenever Genesys is enabled. Duel/series `settings_json` and tournament
  `duel_rules_json.settings` carry this shape unchanged. Draft tournaments retain their fixed rules, Genesys off.
  Invalid Genesys settings in parseable stored tournament rules fail rather than
  disabling the format; unparseable tournament JSON keeps its existing default fallback.
- `SavedDeckWrite.genesys?: unknown` uses the same parser. Create omission means
  off; update omission preserves the tag; null clears it. Stored separately in
  nullable `saved_decks.genesys_json` as `{"pointCap":100}`. `deck_json` and `DuelDeck`
  stay unchanged. Tagging does not check deck legality; incomplete library saves remain allowed.

## Points storage and card transport

`migrate()` adds nullable `card_catalog.genesys_points` (nonnegative integer)
and `card_catalog.genesys_revision` (text). Old rows remain unknown (`NULL`).
`Card` / `CardCatalogCard` expose `genesysPoints?: number | null` and
`genesysRevision?: string | null`; catalog query results supply explicit values/nulls
and artwork lookups use the canonical card's values. `DuelCardInfo` exposes
`genesysPoints?: number | null`, inherited by `DeckCardInfo` / `CardQueryResult.cards`.
Optional fields preserve older transports; absence always means unknown.

`genesys_points_meta` has zero rows before sync, then one row with `id = 1`:

| SQL column | `GenesysPointsList` field | Meaning |
| --- | --- | --- |
| `revision` | `revision` | Stable list ID, e.g. `tcg-2026-10-05` |
| `effective_date` | `effectiveDate` | Official TCG list date, `YYYY-MM-DD` |
| `source_url` | `sourceUrl` | Actual source URL |
| `synced_at` | `syncedAt` | Last successful snapshot timestamp, UTC ISO |

Sync worker contract: use only the TCG source
`https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes`.
Within a successful, validated response, missing `misc_info[0].genesys_points`
means **known zero**. Commit all values, per-card revision and metadata atomically;
invalidate cards absent from the new snapshot to NULL. Failed sync leaves the last
successful snapshot unchanged; never fill unknown cards with zero. Readers must use
only values matching the active metadata revision, otherwise pass null to the rules helper.
Ordinary catalog refreshes preserve the Genesys columns. Sync/startup/cron are a separate step.

## Pure rules (`packages/shared/src/duels/genesys.ts`)

- `isGenesysForbiddenType(card)` accepts engine numeric types or catalog string
  types and detects Link/Pendulum, including hybrid Pendulums.
- `GenesysCard = { name: string; type: number; alias?: number; genesysPoints?: number | null }`;
  `GenesysCardCatalog = ReadonlyMap<number, GenesysCard>`. Supply engine identity/type
  data with points attached. Artwork normalization uses `canonicalCardCode` from `pool.ts`:
  aliases merge only when name and type match; unrelated aliases/cycles stay distinct.
- `genesysDeckPoints(deck, catalog): GenesysDeckPoints` returns
  `{ totalPoints: number | null, knownPoints: number, unknownCards: DuelDeckCardRef[] }`.
  Sum every copy in Main + Extra + Side + supplied Deck Master; never aggregate players/teams.
  Missing/null/noninteger/negative points are unknown. Unknown canonical points cannot
  be replaced by an artwork's stale points. Any unknown makes `totalPoints` null.
- `checkGenesysDeck(deck, catalog, settings: GenesysSettings): GenesysDeckResult`
  returns `{ valid, pointCap, totalPoints, knownPoints, problems: GenesysProblem[] }`.
  `kind` discriminates `forbidden-type` and `unknown-points` (each has `message`
  and `cards: DuelDeckCardRef[]`) or `over-cap` (`message`, `pointCap`, `totalPoints`).
  Problems appear in that order. An over-cap problem uses the known subtotal as
  a lower bound when the full total is unknown; `valid` is false for any problem.

Admission should run Genesys checks whenever `settings.genesys` is enabled,
including when `validateDeck` is false. The helper does not enforce base-mode
sizes/copies/Domain membership, wire admission, remove engine zones, or render UI.
