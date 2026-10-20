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

The owner's live empty-result cause remains unconfirmed. This session denies
local sockets, Chromium, systemd access, and writes to the requested worktrees.
It cannot check the running service or publish this follow-up on :3000.
The earlier format-staples publish and desktop/mobile proof remain recorded in
[format-staples.md](format-staples.md); those checks precede this follow-up.

## Requested query results

These counts use the real engine catalog and pinned effect artifact. Genesys
examples use the checked-in official 2026-10-05 point fixture. Domain uses a
Blue-Eyes White Dragon Deck Master and the same scope as deck checks.

| Query | Effect hits | Result |
| --- | ---: | --- |
| `recruiters` | 178 | Mystic Tomato, Shining Angel |
| `water recruiter` | 18 | Mother Grizzly, Jigabyte |
| `recruiters 1500 atk or less` | 114 | Mystic Tomato, Shining Angel |
| `released 2024` | 565 | Mulcharmy Fuwalos, Mulcharmy Purulia |
| `before 2010` | 3698 | Terraforming, Super Polymerization |
| `newest` | 14356 | Diabellstar, the Seeker of Sinful Spoils, Hope for the Future |
| `from 2023 to 2024` | 1200 | Mulcharmy Fuwalos, S:P Little Knight |
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
`newest` sorts known release dates first, newest first. Announced future dates
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
Compatible generic cards follow. Their rank uses labeled archetype deck shares
when at least three decks are available, then format play share. The reason is
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

Branded has three labeled TCG decks: Ash Blossom runs in 100%, Effect Veiler in
33%, and Super Polymerization in 67%. The other requested TCG archetypes lack a
three-deck cohort, so their generic rows use format shares. These small recent
samples are estimates. They are not a claim about every deck in the format.

Conservative tag checks exclude symmetric search locks from archetypes with
multiple searchers, including Droll from Blue-Eyes, Branded and Snake-Eye.
They also exclude detected symmetric GY banishment in GY plans. Other conflicts
are left alone when tags do not establish them.

Schema version 2 adds exact archetype denominators and up to 40 generic card
counts per archetype. The data stays below 500 KB and uses the existing bounded,
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
The original Normal/Domain row and live browser evidence is in the linked report.

## Verification and delivery

- 148 duel search integration checks pass; one existing loopback-HTTP mock test
  is excluded because this session denies sockets.
- 20 suggestion host/scope/worker integration checks pass.
- 11 targeted shared reader and sourced-deck quality integration checks pass,
  including the 19/20 saved-deck threshold and aggregate invalidation.
- 26 web route integration checks and six real-catalog UI/signed-host integration
  checks pass. The UI checks cover zero name hits, real result cards, measured
  reasons, the archetype chip and How it plays.
- Shared/duel builds and web typecheck pass. The candidate publisher validates
  schema 2; five malformed archetype artifacts are rejected.
- No new unit tests were added. Node 22 and core limits apply to all checks.
  No environment files were read and no engine data was changed.
- Main was merged after #413 landed at `7109cddf178fe0552dac563b0f3fa82ad1f3bee5`.
  No dependency PR branch was changed.

The follow-up still needs a local-all port and a live :3000 check. The session's
write scope is limited to the original domain-multiplayer worktree and `/tmp`.
The reviewed checkout is `/tmp/format-staples-followup`. Its `.status/recruiters/`
folder holds query results, role results and check logs. The local-all deployer
must wait for other builds/copies, follow the documented stop/copy/start rule,
then delete temporary build output. This report does not claim a new live publish.

GitHub publication is also blocked: the GitHub write tool requires approval,
while this session's approval policy is `never`. PR #421 still points to the
previous source head `11876dd8b2e12d34827a5f07e5f4d4efba200c47`.
A verified Git bundle, PR body and delivery notes are saved under `/tmp` for
the coordinator. No new remote commit or local-all publish is claimed.
