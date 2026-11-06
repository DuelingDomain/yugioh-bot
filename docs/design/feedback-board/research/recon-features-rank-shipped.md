**A rank system already exists:** Elo, five tiers, tier progress, promotion feedback, seasons, winnings leaderboards, profiles, and achievements. The clearest new rank feature would be **automatic matchmaking or a ranked queue**.

Reviewed local `main` at `e0b7e470b` (October 24). No files were changed. "Shipped" below means present in local main's history; deployment was not verified.

(a) Existing features, each with its key source:

| Feature | What exists |
|---|---|
| Drafts | Booster-style cube drafts, timed picks, bots, Main/Extra rounds, saved pools and YDK export. Theme drafts are implemented behind `THEME_DRAFTS`, default off. [drafts.ts](../../../../packages/shared/src/services/drafts.ts), [theme gate](../../../../packages/web/src/lib/theme-drafts.ts) |
| Duels | Standard/Domain; 1v1, Tag 2v2, FFA3/FFA4; configurable rules, clocks, banlists, visibility and invitations. [creator.tsx](../../../../packages/web/src/components/duel/creator.tsx) |
| Practice bot | Basic legal-choice bot using generic EARTH Normal Monsters. Used in lobby practice and the deck-editor Test duel. Bot results never count toward rank. [practice-bot.ts](../../../../packages/duel-server/src/practice-bot.ts) |
| Replays | Replay viewer, timeline, multiplayer layouts, cross-version reconstruction and verification/fallback handling. [replay.tsx](../../../../packages/web/src/components/duel/replay.tsx) |
| Replay forks | "Jump in here" creates a private playable branch. Restricted to an allowlisted owner and that fork's creator. [replay-forks.ts](../../../../packages/shared/src/services/replay-forks.ts) |
| Series/challenges | Direct opponent challenges, Bo1/Bo3, side decking, readiness and next-game handoff. Optional rated human 1v1 results. [duel-series.ts](../../../../packages/shared/src/services/duel-series.ts) |
| Tournaments | Round robin and single elimination, byes, bracket progression, standings/crosstable, registration/deck locking, online series, manual result confirmation, cancellation/reopening and visibility controls. [tournaments.ts](../../../../packages/shared/src/services/tournaments.ts) |
| Leaderboard | Season/all-time winnings standings, tiers/Elo, personal position and accessible live-duel links. [leaderboard-view.tsx](../../../../packages/web/src/components/leaderboard/leaderboard-view.tsx) |
| Seasons | Numbered, optionally named seasons. Active/ended lifecycle and separate season standings. [seasons.ts](../../../../packages/shared/src/services/seasons.ts) |
| Ratings | Guild-scoped Elo, career winnings, scoring ledger, streaks and approved-match scoring. [scoring.ts](../../../../packages/shared/src/services/scoring.ts) |
| Rank tiers | Bronze through Diamond, threshold-derived progress and promotion detection. [rank components](../../../../packages/web/src/components/rank/rank-up.ts) |
| Profiles | `/player/[id]`: Elo/tier, season/career figures, achievements, recent winnings, progression and live-duel link. [profile page](../../../../packages/web/app/(app)/player/[id]/page.tsx) |
| Decks | Private library/editor. YDK, YDKE and card-name imports, bulk import, alternate-passcode compatibility, YDK/YDKE export, artwork, Deck Master, suggestions and Genesys budgets. [editor.tsx](../../../../packages/web/src/components/decks/editor.tsx), [import formats](../../../../docs/deck-import-formats.md) |
| Cubes | Private reusable pools. Main/Extra sections, copies, set/archetype/name/passcode imports, prerelease cards, description-based seeding and draft reuse. [cubes.ts](../../../../packages/shared/src/services/cubes.ts) |
| Effect search | Natural-language effects/roles, partners, similar cards/counters, format staples, release-date filters and draft/deck fit explanations. [contract](../../../../docs/effect-search-contract.md) |
| Card-data status | **Owner-only** freshness, engine/catalog gaps, update workflow status and update history. [status page](../../../../packages/web/app/(app)/settings/card-data/page.tsx) |
| Spectating | Signed-in players can watch open tables. Private tables require access or an invitation. Separate owner inspection allows private/full-information viewing, with live-participation restrictions. [duels.ts:860](../../../../packages/shared/src/services/duels.ts:860), [admin access](../../../../packages/shared/src/services/admin-spectate.ts) |
| Presence | Heartbeats and live-duel indicators. Owner "Online now" views and Discord reporting. Online window is 120 seconds. [presence](../../../../packages/shared/src/presence/index.ts) |
| Discord | Sign-in/linking plus an optional admin/community bot: public card lookup, welcome cards, moderation, waitlist and owner reports. Legacy gameplay bot commands were removed. [bot documentation](../../../../docs/deployment/discord-bot.md) |
| Achievements | Six: First Tournament Win, 10-Win Streak, Giant Slayer, High Roller, Legend and Three-Time Champion. [achievements.ts](../../../../packages/shared/src/scoring/achievements.ts) |

Theme drafts, effect search, suggestions and the bot are configuration-dependent. Their Compose defaults are off. [docker-compose.yml](../../../../docker-compose.yml)

Clear gap candidates from the inspected routes, services and schema:

- Automatic matchmaking/ranked queue; friends/follow relationships.
- Swiss or double-elimination tournaments.
- Public browsable deck/cube sharing pages. Portable deck exports already exist.
- Player-accessible replay forks.
- Scheduled seasonal competition, rewards and rating-reset policy.
- General player notification inbox/push.
- Anonymous spectating. Signed-in open-table spectating already exists.
- Separate ratings by format, provisional placement games and rating decay.

These are uncommitted candidates, not verified roadmap promises. Challenges, achievements, tiers and signed-in spectating should not seed duplicate "new" ideas.

(b) Exactly how rank works today:

**Rating:** each player starts at **1000 Elo**, already **Silver**. Expected score is `1 / (1 + 10^((opponent − rating)/400))`. The update is `round(rating + 32 × (actual − expected))`. Everyone uses K=32, so equal-rated opponents exchange about ±16. There is no provisional K or rated-draw calculation. [elo.ts](../../../../packages/shared/src/scoring/elo.ts)

**What counts:** scoring consumes approved match records with a winner. Completed rated human 1v1 series and tournament series record one match result. Individual Bo3 games do not each award Elo. Bot practice, ordinary unranked duels and replay forks do not count. Tag/FFA cannot be marked ranked. Ranked is off by default. Ranked tables enforce a 180-second time bank and timeout loss. [series scoring](../../../../packages/shared/src/services/duel-series.ts:570), [settings](../../../../packages/shared/src/duels/settings.ts:115)

**Storage:** `player_ratings` is keyed by guild/player, with no format or season dimension. Standard and Domain therefore share one rating. `matches`, `point_awards` and `season_standings` separately retain results and awards. [schema.ts:586](../../../../packages/shared/src/db/schema.ts:586), [schema.ts:822](../../../../packages/shared/src/db/schema.ts:822)

| Tier | Elo |
|---|---:|
| Bronze | Below 900 |
| Silver | 900–1099 |
| Gold | 1100–1349 |
| Platinum | 1350–1599 |
| Diamond | 1600+ |

Tiers change directly at these thresholds. [constants.ts](../../../../packages/shared/src/scoring/constants.ts)

**Seasons:** one active season per guild, managed through worker operations. Scoring automatically creates one if none is active. Starting another season creates fresh seasonal totals, but **Elo and career winnings persist**. No automatic calendar rollover, Elo reset or seasonal rewards were found. [season operations](../../../../packages/worker/src/ops/season.ts)

**Leaderboard:** placement follows **winnings, not Elo**. Season ordering is winnings, then wins, then name. All-time ordering is career winnings, then name. The page shows a podium, tier/Elo, winnings, season W–L/win percentage/streak, personal position/gap, tier progress and tier population. All-time hides seasonal records. Without an active season it falls back to career standings. [leaderboard model](../../../../packages/web/src/components/leaderboard/leaderboard-model.ts)

Match winnings are `round(5 × clamp(1 + Elo difference/800, 0.5, 2))`, currently **3–10**, with 5 against equal Elo. Tournament placement bases are 50/30/15 for champion/runner-up/top-four, multiplied by field size. These points are separate from Elo. [winnings.ts](../../../../packages/shared/src/scoring/winnings.ts)

**Visuals:** current pages use faceted gems: bronze, silver, gold, blue Platinum and prismatic Diamond, plus tier text and progress lines. Profiles detect promotion against the last tier seen in browser storage, show "Up to …" and play a reduced-motion-aware pop. The separate `rank-badge.tsx` defines animated pill badges, but no page callers were found. [current gem](../../../../packages/web/src/components/sheet/rank-gem.tsx), [profile promotion](../../../../packages/web/src/components/player/profile-header.tsx)

**What is missing for a "rank system":** a ranked queue or matchmaking, per-format ratings, placement games, seasonal Elo reset or soft reset, seasonal rewards, and automatic season rollover.

(c) Weekly changelog candidates from both requested logs. PR numbers are kept. CI/infra/test-only work is omitted.

| Week | Player-facing entry | PR/commit |
|---|---|---|
| Sept 28–Oct 4 | Play Domain duels with configurable tables, clocks, banlists and invitations. | `30145731f`, `d6f6109bf` |
| | Save decks, import multiple YDKs and build decks from finished draft pools. | `c2e8293ca`, `63cc2b272`, `4e2209fbd` |
| | Challenge opponents to Bo1/Bo3, side deck between games and record rated/tournament results. | `77e41054b`, `c93ba1b4d`, `6c841ab08` |
| | Play Tag 2v2 and three/four-player free-for-all. | #101, #124 |
| | Use redesigned draft rooms, libraries, deck pages and player profiles. | #69, #74, #75, #88, #112, #144 |
| | Export draft decks and turn finished drafts into tournaments. | #94, #120, #128 |
| | Try 3D duel effects, clearer chain controls and animated results. | #139–#141, #147 |
| Oct 5–11 | Read bigger hands/card text and zoom or pan multiplayer tables. | #192, #202, #203, #289 |
| | Choose alternate artwork and manage deck copies more easily. | #222, #224, #228 |
| | Choose open or private drafts/tournaments with invitation access. | #304, #305 |
| | Import cube cards by name, configure draft deck size and let hosts end drafts. | #240, #307, #312, #313 |
| | Use prerelease cards and improved Standard-engine compatibility. | #257, #261, #325 |
| | Follow detailed chain resolution, table logs and negation indicators. | #263, #294, #328 |
| | Link existing Discord accounts and request access within sign-in. | #259, #268, #301 |
| | New theme-draft creation is hidden behind an availability switch. | #320 |
| Oct 12–18 | Import decks in bulk with improved previews and a better-fitting editor. | #335, #347, #366 |
| | Replay older games across engine-version changes. | #338 |
| | Cancel active tournaments; keep private cubes private. | #358, #356 |
| | Build and play Genesys decks with point-budget rules. | #388 |
| | Receive clearer warnings before leaving an active game. | #386 |
| | Use improved multiplayer layouts, card inspection and field effects. | #348, #381 |
| Oct 19–25 | Search by effects, partners, counters, release dates and format staples. | #412, #414, #421 |
| | Get legal deck suggestions and launch Test duel from the editor. | #413, #411 |
| | Draft prerelease cube cards and use updated cards/October banlists. | #399, #404, #430, #443 |
| | Get community Discord card lookup and welcome cards when enabled. | #407, #426 |
| | See live card statuses, protections and counters. | #465 |
| | Import simulator name lists and verified Dueling Book alternate passcodes. | #447, #452, #453 |
| | Read Xyz materials, pinned card details and opponent ATK/DEF more clearly. | #403, #439, #459, #460, #462 |
| | Get corrected decision clocks, Damage Step windows, sorting and multiplayer LP interactions. | #455–#458, #464 |
| | Hosts can remove players before a table starts; replays load faster. | #429, #416 |
| | Avoid accidental clicks during board movement and unnecessary same-page leave warnings. | #463, #466 |

No matching entries appeared September 10–27 or October 26–30 in local main.

(d) The `gh issue list … --json number,title,labels` command failed with "error connecting to api.github.com." Open-issue themes and issue-backed Planned/Under review seeds could not be verified. No issue statuses are inferred here.

(e) [docs/roadmap.md](../../../../docs/roadmap.md) queues:

- **Planned candidates:** remove the disabled Game engine selector, unify format names, and improve text below 11px.
- **Under review candidates:** clock-name clipping, lobby wording, small-screen card details, clock remount and blur performance. All are explicitly awaiting visual checks.
- **Parked:** include production script errors in card-update reports. The implementation exists, but activation awaits owner credentials.
- **Parked/Under review:** daily update checks, original scripts/data for cards missing from Ignis, and a catalog-versus-Ignis gap report.
- **Already done:** multiplayer, Cancel table confirmation and Table full messaging.

The roadmap is partly stale. Updates now run Monday and Thursday, and the owner status page already includes gap reporting. Narrow those ideas before publishing them. [workflow](../../../../.github/workflows/engine-data-update.yml:5), [gap UI](../../../../packages/web/src/components/card-data/card-data-gap.tsx)