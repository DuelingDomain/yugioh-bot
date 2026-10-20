# Format staples and search follow-up

PR: https://github.com/DuelingDomain/yugioh-bot/pull/421. Do not merge.

## Recruiter cause and scope

The current source does not reproduce the owner's empty `recruiters` result.
The web route forwards Name + text queries to the signed `card-query` host.
The capability gate already accepts recruiters. Both installed flag drop-ins
set `EFFECT_SEARCH=1`. The UI keeps effect hits when name hits are zero.
A real-artifact signed-host UI integration test now covers that complete result path.
The HTTP connection is replaced by an in-memory signed request in this test.

The earlier `staples` failure had a clear cause: it was only an archetype suffix,
so plain `staples` went to fuzzy name search and selected Morphtronic Staplen.
The format-staples intent fixes it. Semantic queries now bypass fuzzy name
replacement. Complete exact card names retain name search.

Separate recruiter defects are fixed: the old expansion required battle
destruction, and `destroyed and sent to the GY` could select the GY action
instead of the summon. Recruiters now require an own-destruction trigger and
another monster summoned from Deck in the same tagged effect. Any destruction
includes battle destruction. Classic 1500-ATK recruiters receive a rank boost.
Explicit recruiter/date/format readings take precedence over cached model readings.

The owner's original empty-result state was not reproduced. Before this publish,
the authenticated live route returned 91 recruiter effect hits and zero name hits.
Both running flags were `1`. This rules out a disabled flag or a zero-name-hit
UI gate in the observed runtime. The old battle-only expansion was confirmed in
that response. After the fix, the same live route returns 178 hits and puts the
four classic recruiters first. The web response matches the signed host response.

## Requested query results

These counts were also verified through the live authenticated web route on
2026-10-20. They use the real engine catalog and effect artifact. Genesys uses
the same point cache as the running deck checks. Domain uses a
Blue-Eyes White Dragon Deck Master and the same scope as deck checks.

| Query | Effect hits | Result |
| --- | ---: | --- |
| `recruiters` | 178 | Mystic Tomato, Shining Angel |
| `water recruiter` | 18 | Mother Grizzly, Jigabyte |
| `recruiters 1500 atk or less` | 114 | Mystic Tomato, Shining Angel |
| `released 2024` | 537 | Mulcharmy Fuwalos, Mulcharmy Purulia |
| `before 2010` | 3669 | Terraforming, Super Polymerization |
| `newest` | 14357 | Diabellstar, the Seeker of Sinful Spoils, Hope for the Future |
| `from 2023 to 2024` | 1171 | Mulcharmy Fuwalos, S:P Little Knight |
| `legal in Genesys` | 13024 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `Genesys` | 13024 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `Domain legal` | 7553 | Infinite Impermanence, Called by the Grave |
| `TCG only` | 13863 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `OCG only` | 14317 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `banned in TCG` | 156 | Called by the Grave, Triple Tactics Talent |
| `limited` | 92 | Droll & Lock Bird, Terraforming |
| `semi-limited` | 7 | Sky Striker Mobilize - Engage!, Ice Ryzeal |
| `unlimited` | 14102 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `at 3 in Genesys` | 12828 | Ash Blossom & Joyous Spring, Infinite Impermanence |
| `Genesys under 10 points` | 12547 | Infinite Impermanence, Effect Veiler |
| `staples` | 16 | Ash Blossom & Joyous Spring, Droll & Lock Bird |

`recruiters` and `recruiters 1500 atk or less` put Mystic Tomato, Shining Angel,
Giant Rat and Mother Grizzly first. `water recruiter` puts Mother Grizzly first.
Baobaboon verifies the any-destruction path. The full destruction/GY phrase also
returns the four classic recruiters.

Release chips enforce complete month bounds. `released 2024` means January to
December 2024; `before 2010` ends in December 2009; the 2023–2024 range is inclusive.
`newest` puts pending first prints first, then released cards. Known months
sort newest first; unknown months stay last. Without a region, date search uses
the later known TCG/OCG month. Announced future dates
remain visible and carry the existing upcoming marker. Release limits also apply
before usage ranking.

Format chips use the current pinned region list by default, or the selected
list for that region. `TCG only` and `OCG only` select the card pool; cards printed
in both pools remain eligible. Bare limits use the selected ban list, with current
TCG as the no-list default. Genesys rejects Link/Pendulum, unknown points and cards
over the default 100-point cap. `at 3 in Genesys` requires three copies to fit that
cap; `Genesys under 10 points` requires fewer than ten points per copy.
`Domain legal` requires a Deck Master. Without one it returns no candidates.
The web insight and resolve routes use the same signed host admission path.

Combining Outside with interpreted format/date words currently returns no rows;
it cannot display rows from a different scope as legal.

Chips can be removed. Removing the point ceiling retains Genesys admission.
Removing a role retains native archetype membership. Format relaxation hints
are omitted because they cannot reuse the original admission predicate safely.

## Archetype roles

One list shows native role cards first, with `<archetype> card` as the reason.
Generic cards follow. Their rank uses labeled archetype deck shares
when at least three decks are available, then format play share. Equal archetype
shares use format play share as the next rank. No deck-conflict or era score
changes this order. The reason is
`Run in N% of <archetype> decks` or `Format staple`. The chip reads
`For <archetype> decks`, and the How it plays panel remains available.

All four archetypes pass for hand traps, removal, extenders, board breakers and
staples. Representative first results:

| Archetype | Hand traps | Removal |
| --- | --- | --- |
| Blue-Eyes | Ash Blossom & Joyous Spring | Blue-Eyes Alternative White Dragon |
| Branded | Ash Blossom & Joyous Spring | The Fallen & The Virtuous |
| Snake-Eye | Ash Blossom & Joyous Spring | Snake-Eyes Vengeance Dragon |
| Tenpai | Ash Blossom & Joyous Spring | Ghost Ogre & Snow Rabbit |

Branded has three labeled TCG decks: Ash Blossom and Droll & Lock Bird each run
in 100%, Effect Veiler in 33%, and Super Polymerization in 67%. The other requested TCG archetypes lack a
three-deck cohort, so their generic rows use format shares. Droll ranks second for all four requested archetypes. Branded uses its measured
100% archetype share; Blue-Eyes, Snake-Eye and Tenpai use format share. The real
Genesys sample also puts Effect Veiler (6/80) above Ghost Belle (4/80), although
neither passes the global staple threshold. These small recent samples are estimates. They are not a claim about every deck in the format.

The owner correction removes all own-deck conflict checks. Droll remains eligible
for Blue-Eyes, Branded, Snake-Eye and Tenpai. Search-heavy and GY-based plans
neither drop nor demote cards. Real play share sets the generic rank.

Schema version 3 keeps exact archetype denominators, up to 40 generic card
counts per archetype, and all generic format counts. The format counts are
independent of the global staple threshold, so a played role card below that
threshold still has a real format share. There are 109 TCG, 792 Domain and 405
Genesys generic card counts. The artifact is 342,322 bytes, below 500 KB and uses the existing bounded,
additive daily refresh. Public global card shares and average copies are unchanged.
Private saved-deck aggregates still need 20 distinct complete decks. They publish
no owner IDs. A private cohort uses its own format share fallback; public archetype
percentages are not mixed into it.

## Top ten measured staples

These are shares of accepted source decks. Existing legality filters decide
which cards the Suggestions row admits. Main, Extra and Side all count. Average
copies are stored in the artifact as copies per deck that runs the card.

| Rank | TCG: 79 decks | Domain: 75 decks | Genesys: 80 decks |
| ---: | --- | --- | --- |
| 1 | Ash Blossom & Joyous Spring (100.00%) | Graceful Charity (72.00%) | Lava Golem (30.00%) |
| 2 | Droll & Lock Bird (98.73%) | Raigeki (58.67%) | Skull Meister (28.75%) |
| 3 | Ghost Ogre & Snow Rabbit (83.54%) | Heavy Storm (44.00%) | Twin Twisters (21.25%) |
| 4 | Called by the Grave (79.75%) | Infinite Impermanence (42.67%) | Ghost Ogre & Snow Rabbit (21.25%) |
| 5 | S:P Little Knight (58.23%) | Monster Reborn (38.67%) | Cosmic Cyclone (18.75%) |
| 6 | Triple Tactics Talent (48.10%) | Polymerization (25.33%) | Mystical Space Typhoon (18.75%) |
| 7 | Effect Veiler (41.77%) | Foolish Burial (25.33%) | Typhoon (16.25%) |
| 8 | Typhoon (39.24%) | Painful Choice (24.00%) | Infinite Impermanence (16.25%) |
| 9 | Infinite Impermanence (27.85%) | Terraforming (21.33%) | Gordian Slicer (10.00%) |
| 10 | The Great Gallant Bandit (25.32%) | Giant Trunade (16.00%) | Ash Blossom & Joyous Spring (10.00%) |

Normal uses TCG unless its ban list selects OCG. OCG and Genesys Domain have no
independent sample and retain the old role/popularity fallback.

`staples` returns zero name hits and 16 TCG effect hits: Ash Blossom is first;
Infinite Impermanence is included. Domain returns 24 engine-admitted cards,
Graceful Charity first. Genesys returns 11, Lava Golem first. Reasons use
`Played in N% of <format> decks`. Exact `Morphtronic Staplen` remains a name hit.
The new live proof also verifies Normal and Domain rows and desktop/mobile search.

## Verification and delivery

- 220 targeted integration checks pass on the final local-all port: 155 duel
  search, 20 suggestion host/scope/worker, 12 shared reader/sourced-deck quality,
  and 33 web route/UI checks. The full duel file includes the loopback HTTP check.
- The seven real-catalog UI/signed-host checks cover zero name hits, actual result
  cards, measured reasons, the archetype chip and How it plays.
- Shared and duel builds, Next production build, Next typecheck and standalone
  packaging pass. The source candidate publisher validates schema 3; five malformed
  generic-usage artifacts are rejected.
- No new unit tests were added. Node 22 and core limits apply to all checks.
  No environment files were read and no engine data was changed.
- Main was merged after #413 landed at `7109cddf178fe0552dac563b0f3fa82ad1f3bee5`. The later main merge
  includes #414/#417/#418 and ends at `e28e783a158dd589f7330ef68462d2e40c6a4264`.
  No dependency PR branch was changed.

## Live publish on 2026-10-20

The follow-up and owner correction are now on `test/local-all` and :3000.
The build and publish waited for other builds and copies. The documented
stop/copy/start order was used; the web gap was 0.94 seconds. Both services
are active with `LimitCORE=0`, their existing flags and sandbox settings.
The root answers 302. No environment file was read and no engine data was changed.

Live authenticated API checks match the signed host for all three format staple
queries and all four recruiter phrases. `staples` has zero name hits and 16 TCG
effect hits, led by Ash Blossom. Infinite Impermanence is present. Domain returns
24 hits, led by Graceful Charity; Genesys returns 11, led by Lava Golem.
`water recruiter` returns 18 hits with Mother Grizzly first. The 1500-ATK query
returns 114; the full destruction/GY phrase returns 178. The four classics lead
both broader recruiter lists.

All requested date and format queries pass live with removable chips and the
same counts listed above. All 20 archetype/role combinations pass live:

| Archetype | Hand traps | Removal | Extenders | Board breakers | Staples |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blue-Eyes | 10 | 42 | 25 | 9 | 61 |
| Branded | 10 | 40 | 23 | 8 | 57 |
| Snake-Eye | 10 | 39 | 28 | 7 | 53 |
| Tenpai | 10 | 34 | 22 | 7 | 48 |

Droll is second for all four hand-trap queries. No deck-conflict or era rule is
applied. The live Blue-Eyes browser also shows `For Blue-Eyes decks` and the
How it plays panel.

Chromium checks pass at 1920x1080 and 390x844 for `staples` and `recruiters`,
with zero page errors. Normal and Domain Staples rows pass with imported real
source lists. Normal shows Ash Blossom and Infinite Impermanence. Domain shows
Graceful Charity, Raigeki, Heavy Storm and Infinite Impermanence. Existing
legality checks still remove cards that the selected list does not admit.

Sanitized proof is in local-all's `.status/format-staples/`: `preflight.json`,
`results.json`, `publish.json`, targeted check logs and desktop/mobile screenshots.
No credentials, cookies, headers or environment dumps are saved. Temporary build
output was deleted after proof; installed web and duel runtime files are retained.
PR #421 is updated and remains open. It was not merged.
