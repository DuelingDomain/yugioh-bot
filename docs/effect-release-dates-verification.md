# Release month fill and search verification

Verified on 2026-10-20 UTC. Source: `feat/effect-release-dates`, based on
`feat/effect-search` at `9c8367efa`. Local site: `http://localhost:3000`.
Nothing was pushed. Both worktrees are kept.

The daily job and the manual command fill missing months. They keep every good
month. Unqualified date searches now use the newest known TCG or OCG month.
“New cards” includes future months. Undated engine pre-release cards use a known
current/future set month. If none is known, they sort first as Upcoming.

## Exact cause in the real catalog

The new Sun God cards already had OCG `2026-10`, with no TCG month. Their API
OCG date is `2026-10-31`. The pre-release IDs resolve to their own families;
these cards did not lose a release record through a remap. They shared October
with many popular cards. Month ties used score, then popularity. This put
Helpoemer at position 43 and The Immortal Sun God at position 56.
The old TCG-first selector did not select an old TCG date for these cards.

Two other faults affected the full result order: the default selector preferred
TCG even when OCG was newer, and the “new cards” window ended at the current
month. Six engine pre-release artwork IDs also had no usable release month.
YGOPRODeck has no date for those IDs, and the local set cache has no release
month for them. They now show Upcoming and sort first. No date is invented.

The card named “The Winged Dragon of Ra - Immortal Phoenix” is a different,
released card: TCG `2016-04`, OCG `2015-12`. “Immortal Phoenix Gearfried” has
TCG `2020-06`, OCG `2019-09`. No new unreleased Phoenix entry was found in the
real engine/API data. The new card in this family is “The Immortal Sun God”.

The Sun God cards remain in the October group under the owner's month/score/
popularity rule. They cannot lead cards dated November 2026 or 2027. Their
current-month engine pre-release status now supplies Upcoming, plus OCG.

| Card | Month | Before position | After position | After marks |
| --- | --- | ---: | ---: | --- |
| The Sun God's Poet - Helpoemer | 2026-10 | 43 | 75 | Upcoming, OCG |
| The Sun God's Destructor - Makyura | 2026-10 | 47 | 79 | Upcoming, OCG |
| The Immortal Sun God | 2026-10 | 56 | 88 | Upcoming, OCG |
| The Sun God's Steelcage - Lava Golem | 2026-10 | 63 | 95 | Upcoming, OCG |
| The Sun God of Darkness - The Winged Dragon of Ra | 2026-10 | 65 | 97 | Upcoming, OCG |
| The Sun God's Terror Machine - Gil Garth | 2026-10 | 66 | 98 | Upcoming, OCG |
| The Sun God Leading Down into Darkness | 2026-10 | 73 | 105 | Upcoming, OCG |
| The Sun God's Torture Device - Viser Des Shock | 2026-10 | 79 | 111 | Upcoming, OCG |
| The Sun God's Protector - Egyptian God Slime | 2026-10 | 82 | 114 | Upcoming, OCG |
| Sun God Domination | 2026-10 | 85 | 117 | Upcoming, OCG |

## First 15 real results before the change

The authenticated web API returned 365 cards. The table lists release marks.

| Position | Card | Month | Marks |
| ---: | --- | --- | --- |
| 1 | Verre, the Maid of Endymion | 2026-10 | None |
| 2 | The Great Gallant Bandit | 2026-10 | None |
| 3 | Ars Magna of Infinity and Finity | 2026-10 | None |
| 4 | Clown Crew Cappello | 2026-10 | None |
| 5 | Mikumari the Sealing Deity Ashtra | 2026-10 | None |
| 6 | Theorealize Medius | 2026-10 | None |
| 7 | Ars Magna of Purification and Corruption | 2026-10 | None |
| 8 | Akasuna the Battle Ashtra | 2026-10 | None |
| 9 | Medicurius the Power Patron of Illusions | 2026-10 | None |
| 10 | Yoa the Plague Deity Ashtra | 2026-10 | None |
| 11 | Ars Magna of Unification and Separation | 2026-10 | None |
| 12 | Ars Magna - "Citrinitas" | 2026-10 | None |
| 13 | Red-Eyes Black Dragon Exceed | 2026-10 | None |
| 14 | Dark Time Wizard | 2026-10 | None |
| 15 | Ashtraya Mikumari-no-Mikoto | 2026-10 | None |

## First 15 real results after the change

The same authenticated web API returned 399 cards. Every result page was read.
All 399 cards passed month order, then score, then popularity checks. Undated
Upcoming cards precede known months. Existing structural filters still apply.

| Position | Card | Month | Marks |
| ---: | --- | --- | --- |
| 1 | Field Power Bonus | Unknown | Upcoming |
| 2 | Buster Blader, the One Who Surpasses the Limits | Unknown | Upcoming |
| 3 | The King of Beasts that Rises from the Valley of Flames | Unknown | Upcoming |
| 4 | Salamangreat Shrine | Unknown | Upcoming |
| 5 | The King of Beasts that Rises from the Valley of Flames | Unknown | Upcoming |
| 6 | Crocodile | Unknown | Upcoming |
| 7 | Diabellstar, the Seeker of Sinful Spoils | 2027-03 | Upcoming, OCG |
| 8 | Hope for the Future | 2027-02 | Upcoming |
| 9 | Wicked Canon | 2027-02 | Upcoming |
| 10 | Deep-Eyes White Dragon, the Blue Abyss | 2026-11 | Upcoming |
| 11 | Blue-Eyes White Dragon, the White Phantom Beast | 2026-11 | Upcoming |
| 12 | Starving Venom Fusion Dragon of the Four Heavenly Dragons | 2026-11 | Upcoming |
| 13 | Revolution Cyber Dragon | 2026-11 | Upcoming |
| 14 | Dark Rebellion Xyz Dragon of the Four Heavenly Dragons | 2026-11 | Upcoming |
| 15 | Red Nova Dragon - Burning Soul | 2026-11 | Upcoming |

## Real API fill

The real bulk response was fetched at `2026-10-20T03:19:30.264Z`. It contained
14,618 card records. Its source hash matches the release descriptor in the
published local artifact. The interrupted run had already applied it; this run
kept that work. A repeat manual fill used the cache and added zero more dates.

- Cards given dates: **157**.
- Region months added: **184**.
- New release IDs: **156**.
- Existing records filled: **1**.
- Existing good months changed: **0**.
- Release records: **14,383 → 14,539**.
- Release records with neither month: **7**.
- AI or paid calls for release dates: **0**.

Ten newest filled cards, using the newest known region month:

| Card | TCG month | OCG month |
| --- | --- | --- |
| Gandora-X the Blackmetal Rampaging Dragon | Unknown | 2026-12 |
| Time Chain | Unknown | 2026-12 |
| Warrior's Devotion | Unknown | 2026-12 |
| Ancient Ruler Rises | 2023-03 | Unknown |
| Archfiend's Conscription | 2023-03 | Unknown |
| Archfiend's Promotion | 2023-03 | Unknown |
| Cloudy Skies of Grey | 2023-03 | Unknown |
| Cold-Blooded Tactician | 2023-03 | Unknown |
| Dark Creation | 2023-03 | Unknown |
| Dark Unity | 2023-03 | Unknown |

The three December fills are absent from the current engine catalog. A release
record alone cannot make an absent engine card appear in search results.

## Checks

- Existing mocked HTTP integration covers a missing card fill, preserved good
  dates, bad placeholders, artwork families, cache reuse, retry, API failure
  while tagging still publishes, and refusal of non-additive publication.
- The source publication/artifact/search batch passed 199 tests. The final
  search/insight batch passed 163 tests. These batches overlap.
- Source web routes and components passed 43 tests. The browser-safe import
  correction passed its five route checks. No new unit test file was added.
- Local search evaluation passed all 111 queries: 158 labelled matches,
  145 labelled exclusions, zero false positives or false negatives.
- Local engine search passed 118 tests. Local SQL insights passed 21 tests,
  including optimized streaming and snapshot checks. Local web checks passed
  49 tests. Script TypeScript checks passed.
- Shared, duel-server, and web were built in that order on Node 22.23.3.
  Next webpack compilation, TypeScript, static generation, and standalone
  packaging passed. The new browser import uses the narrow release export.
- Standalone web and its effect assets were copied with rsync to `web-live`.
  Both `yugidraft-duel-server` and `yugidraft-web-local` were restarted directly
  and are active. Both have `LimitCORE=0`.
- The new artifact version is
  `5b8577e3697803fbabce723eef66ee701830cdaef84ef74c308bcd126c1c176b`.
  Its import is present in the live shared database.
- Authenticated live checks also confirmed newest order for “newest spells”,
  “newest OCG spells”, and “new cards TCG”. Explicit regions select only their
  own months. Desktop 1920×1080 and mobile 390×844 showed Upcoming and OCG;
  neither browser had a page error.

The port keeps the local catalog's optimized object, tuple and attached-database
read paths. Each path retains the engine's pre-release bit. Older test fixtures
without that column use zero. The port also keeps existing pre-release labels
where the Upcoming mark does not apply.

## Commands and limits

Run the same free fill by hand, then rebuild consumers and restart them:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npm run effects:fill-releases -- --apply
```

The script uses one bulk GET per refresh, a 24-hour disk cache, at most three
attempts, and a 30-second timeout per attempt. Backoff starts at one and two
seconds. Retry-After can extend a wait to at most 60 seconds. API or validation
failure skips only the release step. Tag publication remains usable. This is
below the documented API request limit. See the
[YGOPRODeck API guide](https://ygoprodeck.com/api-guide/).

Dates have month precision. TCG years start at 2002; OCG years start at 1999.
Good dates stay fixed. Bad old dates that still pass those rules are not
corrected. No region means the latest known month. A named region is strict.
“Last N months” retains its upper bound; “new cards” has no future upper bound.
Current-month Upcoming also uses the engine pre-release flag; month data alone
cannot tell which day a card will be released. A set fallback is a display/search
month, not an invented TCG/OCG fact. Both date caches refresh after a catalog
update or a UTC month change.

All Node commands used `prlimit --core=0`. Environment-file reads were disabled
with the existing preload. No environment file was inspected. No
`data/duel-engine*` path was written. Duel-server dist was kept during builds.
The preload directory was kept. Its file hash is unchanged:
`aabcf55ab65ce842da9cf0d0b15121371d1e7f615138267fefa3e790953fcb95`.
No process was killed by name. No stash, hard reset, push or remote message was
used.

## Commits

All commits have the owner-requested co-author and session trailers.

| Step | Feature branch | test/local-all |
| --- | --- | --- |
| Approved plan | `8695fa558` | `5045031a4` |
| Daily/manual additive fill | `cac7c2279` | `2e51ebbcc` |
| Real API dates | `4ea6bb2da` | `13f369ff9` |
| Newest region and Upcoming rules | `d2ec332ec` | `23668273a` |
| Month-change cache | `da6d8d6b4` | `1dcb92071` |
| Browser-safe helpers | `5476f2f0c` | `9b6f22405` |

Live evidence is in `local-all/.status/effect-releases/`: before/after JSON,
`live-query-checks.json`, two screenshots, and the verification scripts.
