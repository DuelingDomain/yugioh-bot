# Effect search: release dates and cube era contract

Date: 2026-10-17. Branch: `feat/effect-search-dates`. Base: `b096596c70693aa9aed66c4c78fe9905c066cac9`.

The backend stores 14,383 release records in `releases.json.gz`, in the existing pinned effect artifact. The import writes `card_release` with canonical passcodes, TCG and OCG months, quality, and source version. It removes TCG dates before 2002 and OCG dates before 1999. The clean data has 13,983 TCG dates, 14,018 OCG dates, two records with placeholders, and eight records with no usable date. Artwork families and pre-release remaps keep the same date.

Use these fields in the UI:

| API | New fields |
| --- | --- |
| Deck card query (`POST /api/decks/cards`, forwarded to the duel host) | `released?: { from?: "YYYY-MM", to?: "YYYY-MM", region?: "tcg" \| "ocg" }`; `sort: "newest"` is added to the existing sort values. |
| `POST /api/cards/insights`: `effectSearch`, `worksWith`, `suggest` | The same `released` object; `sort?: "match" \| "newest"`; `era?: { medianYear: number, spread: number }`. Keep the existing pool, limit, format, Genesys, and Deck Master options. |
| `POST /api/cards/insights`: `poolHealth` | `{ op: "poolHealth", cards: number[], era?: { medianYear: number, spread: number } }`. The result adds `health.era` when dates are known. |
| Returned deck cards and ranked insight cards | `release: { tcgDate?: "YYYY-MM", ocgDate?: "YYYY-MM", date?: "YYYY-MM", region?: "tcg" \| "ocg", upcoming: boolean }`. |

Both range bounds are inclusive. Omit a bound to leave that end open. Omit `region` to use the newest known TCG or OCG month (owner update 2026-10-20). An explicit region uses only that region. An undated engine pre-release card uses its earliest known set month without claiming a region. All cards with no known month fail bounded date filters, sort last, and have no Upcoming mark. Future months remain in the data and in search results. `upcoming` is true when the selected month is after the current UTC month, or the engine marks a card as pre-release and its first known month is current. Show “Upcoming” when this field is true, and “OCG” when only an OCG date is known. The data has month precision; it cannot separate past and future days within the current month.

`sort: "newest"` sorts by selected release month before score and popularity. In a deck card query, this sort always means newest first; `order` does not reverse it. The foundation keeps name and effect groups separate. Date searches admit standard TCG/OCG cards and announced engine prerelease cards, including rows carrying only `ot & 0x100`; Rush, Legend, anime, and game-only rows stay excluded. All existing structural filters still apply. In SQL insights, an explicit `sort` option takes priority over a sort read from the text.

The reader adds `query.released`, `query.releaseLabel`, and `query.sort`. Display the supplied `reading.chips`. Examples are `Released: before 2010`, `Released: GX era (2004-2007)`, and `Sort: newest first`. To remove a chip, send its exact label in deck query `effectOmit` or insight option `omittedChips`. Exact-text mode stops text interpretation. An explicit `released` range still applies in exact-text mode. A range sent as a field is a filter; it does not create a text-reading chip.

| Search text | Reading |
| --- | --- |
| `before 2010` | Through `2009-12`. |
| `since 2015`, `after 2015`, `from 2015` | From `2015-01`, inclusive, as specified in the date study. |
| `2008-2010`, `2008 to 2010`, `between 2008 and 2010` | `2008-01` through `2010-12`. The reader also accepts `released from 2008 to 2010`. |
| `in 2012` | `2012-01` through `2012-12`. |
| `last 3 months` | From the UTC month three months before now through the current UTC month. On 2026-10-17 this is `2026-07` through `2026-10`. |
| `newest`, `newest spells` | Newest first. No automatic date cutoff. |
| `new cards` | From three months ago onward, including future months; cards without a known month are excluded; newest first. |
| `OCG before 2010`, `newest OCG spells` | Use OCG dates for the reading, sort, and result date. |
| `2000 atk`, `atk 2000` | Printed ATK = 2000. No date reading. Existing ATK effect phrases, such as `gain 1000 ATK`, keep their effect reading. |

An unmarked four-digit number is not a year. A marked year must be between 1999 and next year. Era words need `era`. The search uses these fixed calendar-year ranges: DM 1999–2003; GX 2004–2007; 5D's 2008–2010; ZEXAL 2011–2013; ARC-V 2014–2016; VRAINS 2017–2019; SEVENS 2020–2021; GO RUSH 2022–2025. These are search conventions. They do not define format legality.

For a cube, call `poolHealth` with its card passcodes. Pass the returned `health.era` to `worksWith`, to `effectSearch` for the seed preview, or to `suggest`. `medianYear` is the median release year of distinct known canonical cards. Cube era derivation, bonuses, and newer-card warnings keep the TCG-first date with OCG fallback; newest-date search uses the newest regional month independently. `spread` is the median absolute deviation in years. The era adds up to four score points for nearby release years. It does not remove candidates or replace the existing linked-card priority. An explicit date range or date chip remains a hard filter. Unknown dates get no era bonus.

Pool health reports cards released more than `max(5, 2 * spread)` years after the median. Example: `3 cards are much newer than the rest of this cube.` An explicit `era` replaces the derived era for that request.

The UI shows no searchygo credit (owner decision 2026-10-19); credit lives in `NOTICE`. The source is the owner-approved searchygo snapshot at `9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c`. Its dates can name a later print; first-set corrections are not in this snapshot. The artifact version is `7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f`. A repeat build produces the same bytes. The tag update pipeline preserves and verifies the release file.

Verification: shared, web, duel-server, and effect-script TypeScript checks pass. Targeted search and route tests pass: 105 tests. Artifact import tests pass: 19 tests. Tag update integration tests pass: 12 tests. The 64-query real-data evaluation has no missing or unexpected labelled cards. All Vitest runs use `--maxWorkers=1`; web runs use `-c packages/web/vitest.config.ts`. Node 22 and `prlimit --core=0` were used. No new unit test file was added.
