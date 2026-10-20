# First-print dates and new-card order

Verified at 2026-10-20T03:56:46.979Z. Branch: `feat/effect-release-dates`.
Local port: `test/local-all`. Site: http://localhost:3000.
This report replaces the earlier month-fill report. Nothing was pushed.

## Result

All 393 live “new cards” results were read. All pages pass the order
check. There are zero unknown months and zero non-TCG/OCG engine entries.
The ten Sun God cards are at positions 9–18. The Immortal Sun God is at 11.
The six undated entries from the old report are absent. This includes Field
Power Bonus, Crocodile and both undated King of Beasts entries.

## Date and order rules

- Keep the earliest known TCG month and the earliest known OCG month.
  Later source dates cannot replace an earlier known print.
- Compare misc_info with the card's first dated set appearance. Match the
  product name. A reused product code is not a product identity.
- Read legacy codes such as MFC-077 and lettered codes such as NECH-ENS10.
  The set endpoint supplies TCG dates. Do not assign those dates to OCG.
- Flag source or stored dates later than the first known set appearance.
  Publication permits an earlier correction only with matching source evidence.
- Unknown months are never Upcoming. They fail a bounded date search and sort
  last in newest searches. Engine pre-release status does not supply a month.
- Pending first prints lead released cards. A known future first print in all
  known regions qualifies. In the current month, the engine pre-release bit
  must also be present. Old pre-release bits lose this priority after the month.
- In each group, use the newest regional first-print month, then the original
  engine set number, then popularity. The month is the newer of the earliest
  TCG and OCG months. A named region selects only that region.
- Use engine set order for the month tie. The catalog has no stable insertion
  time. cached_at changes during sync. Preserve the original set number through
  verified passcode remaps. Use the earliest source set if several IDs map to
  one card. Cards without set provenance use popularity for this tie.
- A future first TCG release can still show Upcoming after an earlier OCG
  release. In an unqualified search, that card remains in the released group.
- Date searches exclude anime, Rush, video-game-only and skill cards. Existing
  filters still apply. The effect-off path still needs no effect index.

## Diabellstar source check

“Diabellstar, the Seeker of Sinful Spoils” (100461000) is a new card. Its OCG
first-print month is 2027-03. Konami lists it as the new card in the
[Complete File product](https://www.yugioh-card.com/asia/product/complete-file-seeker-of-sinful-spoils/),
with shipping from late March 2027. The same product also has reprints.
“Diabellstar the Black Witch” (72270339) is a separate card. Its retained first
months are TCG 2023-10 and OCG 2023-07. The new card's month was kept.
Konami dates [Immortal Phoenix](https://www.yugioh-card.com/japan/products/imph/)
to 2026-10-31. The API month for the Sun God cards agrees with this date.
The [YGOPRODeck API guide](https://ygoprodeck.com/api-guide/) defines misc_info
release dates as original regional releases. Actual earlier set evidence wins.

## Counts

- Source: 14618 cards and 1035 sets.
- Follow-up data: 29 cards changed; 28 months moved earlier;
  1 missing month filled. Zero months moved later.
- Release records: 14539 → 14539. Seven records still have neither month.
- Source dates later than first set appearance: 28 flagged.
- Stored dates later than known source or first-set evidence: zero.
- Repeat fill: unchanged; zero date changes.
- Paid release calls: zero.
- Artifact: `51f616c1868b1850ef887756307759cac3f0f4a3191d9c73431e359f6d05a3f5`.
  Its import is present in the live shared database.

## First 25 live results

| Position | Card | Month | Marks |
| ---: | --- | --- | --- |
| 1 | Diabellstar, the Seeker of Sinful Spoils | 2027-03 | Upcoming, OCG |
| 2 | Hope for the Future | 2027-02 | Upcoming |
| 3 | Wicked Canon | 2027-02 | Upcoming |
| 4 | Divine Anima Infinity the Creation Cubic Overlord | 2026-11 | Upcoming, OCG |
| 5 | Alditia Hell Blaze the Burning Cubic Lord | 2026-11 | Upcoming, OCG |
| 6 | Pritima the Infinity Cubic Vessel | 2026-11 | Upcoming, OCG |
| 7 | Cubic Bodhi | 2026-11 | Upcoming, OCG |
| 8 | Abyss Vagrada the Abyssal Cubic Lord | 2026-11 | Upcoming, OCG |
| 9 | The Sun God's Poet - Helpoemer | 2026-10 | Upcoming, OCG |
| 10 | The Sun God's Destructor - Makyura | 2026-10 | Upcoming, OCG |
| 11 | The Immortal Sun God | 2026-10 | Upcoming, OCG |
| 12 | The Sun God's Steelcage - Lava Golem | 2026-10 | Upcoming, OCG |
| 13 | The Sun God of Darkness - The Winged Dragon of Ra | 2026-10 | Upcoming, OCG |
| 14 | The Sun God's Terror Machine - Gil Garth | 2026-10 | Upcoming, OCG |
| 15 | The Sun God Leading Down into Darkness | 2026-10 | Upcoming, OCG |
| 16 | The Sun God's Torture Device - Viser Des Shock | 2026-10 | Upcoming, OCG |
| 17 | The Sun God's Protector - Egyptian God Slime | 2026-10 | Upcoming, OCG |
| 18 | Sun God Domination | 2026-10 | Upcoming, OCG |
| 19 | Maluth the White Crow Knight | 2026-10 | Upcoming, OCG |
| 20 | Reindsurm Gigalovendra | 2026-10 | Upcoming, OCG |
| 21 | Fire Fiend of the White Crow Forest | 2026-10 | Upcoming, OCG |
| 22 | Bunnillin: Mocha MOD | 2026-10 | Upcoming, OCG |
| 23 | Karin the Celestial Sage of the Highest Heights | 2026-10 | Upcoming, OCG |
| 24 | Javelin Beetle of the Alliance | 2026-10 | Upcoming, OCG |
| 25 | The Secret Crane Princess Who Returns A Favor | 2026-10 | Upcoming, OCG |

## Verification and publication

- Source: 97 checks across four existing integration files and 118 engine
  search checks passed. The changed artifact then passed all 25 artifact checks.
  These batches overlap. No new unit test file was added.
- Local port: 52 shared search/SQL checks, 118 engine checks and 26 web checks
  passed. Four existing SQL tests were skipped by their existing conditions.
- The SQL port keeps its object, tuple and attached-database read paths.
- Shared, duel-server and web were built in that order with Node 22.23.3.
  Web compilation, TypeScript, static generation and standalone packaging passed.
- Standalone output and effect assets were copied to web-live with rsync.
  Both yugidraft-duel-server and yugidraft-web-local were restarted and are active.
  Each service has LimitCORE=0. The web service completed its stop timeout.
- Authenticated checks: new cards (393 results), newest spells (2894),
  newest OCG spells (2894), and new cards TCG (257). All checked pages are ordered.
  Every new-cards page was checked. The other three queries checked the first page.
- Browser checks at 1920×1080 and 390×844 show Upcoming and OCG. Zero page errors.
- Evidence: local-all/.status/first-print/live-after.json, prove-current.mjs,
  new-cards-1920.png and new-cards-390.png. The JSON has all 393 result rows.
  Source fill reports and change-counts.json are in release-dates/.status/first-print/.

## Commits

All commits have the required co-author and session trailers.

| Step | Feature branch | test/local-all |
| --- | --- | --- |
| Earliest prints and audit | e432e1a91 | 0d5f9e46b |
| Unknown marks, set ties, official pools | fb42271ef | 70934edbd |
| First 27 corrections and one fill | ea66b00e0 | 6762f1e2e |
| Product-name match | 459d9f339 | 9d05d2e64 |
| Cached skill-card exclusion | a05053792 | 4fb69acfa |
| Pending priority, retained set order, legacy codes | 849eced1e | a7aebe2b4 |
| Des Koala first print | 4bff32f6b | 5dcdb8634 |

## Limits

All Node commands used Node 22.23.3 and prlimit --core=0. No environment file
was read. The existing preload blocked environment-file reads and was kept.
Its SHA-256 is unchanged:
`aabcf55ab65ce842da9cf0d0b15121371d1e7f615138267fefa3e790953fcb95`.
No data/duel-engine* path was written. Duel-server dist was kept during builds.
Other local builds were allowed to finish first. Long jobs were kept in the
foreground and monitored. Services were restarted through systemd. No process
was killed by name. No stash, hard reset or push was used.
