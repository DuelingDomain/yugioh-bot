# Release month fill verification

Source branch: feat/effect-search at 9c8367efa.
Code commit: cac7c2279. Node 22.23.3; core files disabled.

The real free bulk API fill on 2026-10-20 UTC added dates for 157
cards: 184 region months and 156 new IDs.
Records: 14,383 → 14539. Existing valid months changed: 0.
One existing record received a missing month. All other old fields stayed intact.
No AI or paid calls were used for release dates.

Ten newest filled cards, using TCG with OCG fallback:

| Card | TCG month | OCG month |
|---|---|---|
| Gandora-X the Blackmetal Rampaging Dragon | — | 2026-12 |
| Time Chain | — | 2026-12 |
| Warrior's Devotion | — | 2026-12 |
| Ancient Ruler Rises | 2023-03 | — |
| Archfiend's Conscription | 2023-03 | — |
| Archfiend's Promotion | 2023-03 | — |
| Cloudy Skies of Grey | 2023-03 | — |
| Cold-Blooded Tactician | 2023-03 | — |
| Dark Creation | 2023-03 | — |
| Dark Unity | 2023-03 | — |

Limits: month precision; TCG year >=2002; OCG year >=1999.
Future months are retained as upcoming. Unknown months remain unknown:
7 records have neither date.
A 24-hour disk cache avoids repeated bulk calls. There are at most three
attempts, a 30-second timeout per attempt, and backoff of 1 then 2 seconds.
Retry-After can extend each wait to at most 60 seconds. Failure skips the
release step and keeps tagging usable. The engine catalog must also contain
a card before search can return it.

The existing HTTP integration suite covers fills, preserved dates, invalid
placeholders, cache reuse, API failure with publication, and refused date,
record, deletion, duplicate, or artwork-family changes. Search integration
checks both new cards and newest queries: month descending, score, popularity.
