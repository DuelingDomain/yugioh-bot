# Guaranteed outside synergy share — 2026-10-31

Base: `5318ff4e8`, branch `feat/archetype-bridges`. This supersedes the single mixed 40-card cap in [the quality correction](archetype-synergy-search-quality.md).

## Result contract

Every qualified synergy hit carries `synergyCategory: "member" | "support" | "outside"`. Members belong to any requested target (or are the exact named card anchor); support explicitly names a target or has the existing name/primary-archetype relationship; outside has neither relationship to any requested target. Engine setcode memberships determine the member flag when available; SQL-only fixtures fall back to primary catalog membership. The member flag takes precedence over support.

Retain **up to 15 member/support cards plus up to 25 outside partners**, each share independently ranked by hook strength and existing popularity tie breakers. Select before pagination, preserve the 40-card maximum, and do not fill a missing share with generic cards. Explicit newest/date, kind, pool, format, point, and omitted-chip constraints remain in force. API page limits still apply to the retained list.

Shared searches require an independently qualifying connection to every target; their weakest hook controls the score. Being a member of one target does not satisfy another. No shared matches returns separate constrained lists, with the same quotas and flags.

Cards and Describe group results as **Archetype cards** and **Works with**. Independent fallback lists include the target in their headings. Resolver and format adapters preserve categories, keyboard selection works across headings, and See bridges remains available.

## Matching quality

The existing no-Type/Attribute/Level-only and no-any-Trap rules remain. Trap partners still need positive Trap setup or a Normal Trap payoff. Opposing Trap negation/removal, generic GY reactions and generic Fusion support cannot qualify.

Opponent-Tribute hooks rank at 140 alongside extra Tribute Summons. Soul Exchange's printed substitution rule now qualifies despite the stored artifact calling it `other`. The rule requires an actual opponent-Tribute profile hook and the full printed substitution pattern. Kaiju remain within the previously approved class. Lair also retains its reusable Tribute-fodder Tokens; its cost substitution does not replace a Tribute Summon.

Restricted extra Summons do not qualify as generic Monarch Summons: Soul Crossing, Condemned Darklord and Legion the Fiend Jester are excluded in a constrained pool. Typed Deck setup checks the same send event and rejects resource restrictions the profile cannot establish. Blue-Eyes excludes Armageddon Knight and Granguignol, while Destiny HERO and other explicitly DARK-material hooks retain compatible Armageddon Knight. Rose Papillon remains eligible to grant an extra Tribute Summon for Level 8 Monarchs. Explicit Deck-send costs remain eligible; arbitrary hand/field sends do not.

## Read-only measurements

Same defaults as the previous report: `queryCards` with `emptyCardQuery()`, and SQL `effectSearch`, both requesting 120 rows. SQL: `/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`, opened with `{readonly:true,fileMustExist:true}`; printed catalog: that worktree's existing `data/duel-engine-next`. No HTTP request to :3000. All five retained totals and top 10 outside names/scores agree between entry points.

| Query | Member | Support | Outside | Total |
| --- | ---: | ---: | ---: | ---: |
| Temple of the Kings synergy | 1 | 8 | 25 | 34 |
| Monarch synergy | 5 | 10 | 25 | 40 |
| Labrynth synergy | 15 | 0 | 25 | 40 |
| Blue-Eyes synergy | 9 | 6 | 25 | 40 |
| synergy with Temple of the Kings and Blue-Eyes | 1 | 0 | 0 | 1 |

Totals describe capped recommendations, not every catalog match.

## Top 10 outside partners

### Temple of the Kings synergy

| Rank | Card | Score | Hook |
| --- | --- | ---: | --- |
| 1 | Trap Trick | 140 | Searches or Sets Traps for Temple of the Kings |
| 2 | Lord of the Heavenly Prison | 140 | Searches or Sets Traps for Temple of the Kings |
| 3 | Lady Labrynth of the Silver Castle | 140 | Searches or Sets Traps for Temple of the Kings |
| 4 | Lilith, Lady of Lament | 140 | Searches or Sets Traps for Temple of the Kings |
| 5 | Blue-Eyes Tyrant Dragon | 140 | Searches or Sets Traps for Temple of the Kings |
| 6 | Lovely Labrynth of the Silver Castle | 140 | Searches or Sets Traps for Temple of the Kings |
| 7 | Labrynth Labyrinth | 140 | Pays off Trap activations for Temple of the Kings |
| 8 | Paleozoic Anomalocaris | 140 | Searches or Sets Traps for Temple of the Kings |
| 9 | Guiding Ariadne | 140 | Searches or Sets Traps for Temple of the Kings |
| 10 | Traptrix Cularia | 140 | Pays off Trap activations for Temple of the Kings |

### Monarch synergy

| Rank | Card | Score | Hook |
| --- | --- | ---: | --- |
| 1 | Nibiru, the Primal Being | 140 | Tributes opponent's monsters for Monarch |
| 2 | Gameciel, the Sea Turtle Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 3 | Jizukiru, the Star Destroying Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 4 | Dogoran, the Mad Flame Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 5 | Radian, the Multidimensional Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 6 | Thunder King, the Lightningstrike Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 7 | Gadarla, the Mystery Dust Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 8 | Kumongous, the Sticky String Kaiju | 140 | Tributes opponent's monsters for Monarch |
| 9 | Lair of Darkness | 140 | Tributes opponent's monsters for Monarch |
| 10 | Kurikara Divincarnate | 140 | Tributes opponent's monsters for Monarch |

### Labrynth synergy

| Rank | Card | Score | Hook |
| --- | --- | ---: | --- |
| 1 | Trap Trick | 140 | Searches or Sets Traps for Labrynth |
| 2 | Lord of the Heavenly Prison | 140 | Searches or Sets Traps for Labrynth |
| 3 | Lilith, Lady of Lament | 140 | Searches or Sets Traps for Labrynth |
| 4 | Blue-Eyes Tyrant Dragon | 140 | Searches or Sets Traps for Labrynth |
| 5 | Paleozoic Anomalocaris | 140 | Searches or Sets Traps for Labrynth |
| 6 | Traptrix Cularia | 140 | Pays off Trap activations for Labrynth |
| 7 | Malice, Lady of Lament | 140 | Searches or Sets Traps for Labrynth |
| 8 | Angel of Blue Tears | 140 | Searches or Sets Traps for Labrynth |
| 9 | Trap Holic | 140 | Searches or Sets Traps for Labrynth |
| 10 | Trap Tracks | 140 | Searches or Sets Traps for Labrynth |

### Blue-Eyes synergy

| Rank | Card | Score | Hook |
| --- | --- | ---: | --- |
| 1 | Foolish Burial | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 2 | Dragon Shrine | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 3 | Reasoning | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 4 | Dragon Ravine | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 5 | Primite Dragon Ether Beryl | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 6 | Tuning | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 7 | Chaos Ruler, the Chaotic Magical Dragon | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 8 | Glow-Up Bulb | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 9 | Advanced Ritual Art | 110 | Sends your Dragons to the GY for Blue-Eyes |
| 10 | Tearlaments Scheiren | 110 | Sends your Dragons to the GY for Blue-Eyes |

### synergy with Temple of the Kings and Blue-Eyes

**No outside partner qualifies for both targets.** The sole shared hit is **Blue-Eyes Tyrant Dragon** (score 140, `member` of Blue-Eyes), which has a concrete Trap-reset hook into Temple. There are no filler ranks 1–10.

Monarch also retains **Soul Exchange at outside rank 11** and **Spell Card "Soul Exchange" at rank 23**. Temple retains **Trap Holic at outside rank 16** and **Farewelcome Labrynth at rank 17**. None are crowded out by members.

## Validation

- SQL/shared integration suites: **96 passed, 15 skipped** (20-second timeout; the first concurrent run hit the existing alias-metadata case's 5-second timeout).
- Real-engine synergy and effect-search integration: **173 passed**, including all **14 targeted synergy cases**. The final run excludes only the same **2 pre-existing failures** reproduced by the preceding full run and documented in the prior report: missing Field Power Bonus and Genesys expecting Lava Golem while the artifact ranks Skull Meister first. The 111-query evaluation still has 154 true positives, 141 true negatives, zero false positives and zero false negatives.
- Signed route, resolver/format adapter and Describe integration suites: **37 passed**.
- Real-engine Cards UI synergy/fallback cases: **6 passed**, 7 unrelated existing cases not selected.
- **312 passing integration checks** across those results. No new unit tests.
- Shared build and shared/duel-server/web typechecks pass; `git diff --check` passes.
- Independent read-only review found and verified the typed-resource restriction correction; no remaining blocker.

No paid LLM calls, live DB writes, .env reads, service restarts, process kills, bridge implementation edits or changes to `data/duel-engine`. Generated build output and evaluation scratch files are removed before committing. Only explicit owned paths are committed.
