# Docs index

This is the one index of the Dueling Domain docs. Each folder holds one kind of document. Start with the folder that matches your question.

| Question | Start here |
|---|---|
| How is the system built? | [architecture/](#architecture) |
| How does a player use the app? | [flows/](#flows) |
| What does an API or shared type promise? | [api/](#api) |
| What are the game rules? | [adr/0002](adr/0002-multiplayer-duel-rules.md), then [specs/](#specs) |
| How do I run or fix a job in production? | [runbooks/](#runbooks), then [deployment/](#deployment) |
| How do I test a change? | [testing/](#testing) |
| Why was a decision made? | [adr/](#adr) |

Root files:

| File | Purpose |
|---|---|
| [README.md](../README.md) | Repo front page: features, local setup, environment variables |
| [CLAUDE.md](../CLAUDE.md) | Agent guide: commands, package map, key rules |
| [CONTEXT.md](../CONTEXT.md) | Domain glossary. Use its terms in code, issues and docs |
| [.impeccable.md](../.impeccable.md) | Design context for the design skill |
| [packages/web/PRODUCT.md](../packages/web/PRODUCT.md) | Product schema for the design skill |

Do not move these paths. Tools read them: `adr/0002-multiplayer-duel-rules.md`, `specs/multiplayer-rule-coverage.md` (generated), `adr/0003-duel-test-layers.md`, `deployment/vm-runbook.md` (and its headings), `deployment/duel-engine-switch.md`, `deployment/engine-data-updates.md`, `engine/core-pins.md` and `design/duel-3d-mode/concept/solid-vision/`.

## architecture

How the system is built.

| Doc | Purpose |
|---|---|
| [architecture/README.md](architecture/README.md) | Overview: packages, duel engine, engine to screen, stored duel boards |
| [architecture/data-flow.md](architecture/data-flow.md) | How data moves between browser, web, ws, duel-server, worker, bot, shared and SQLite |
| [architecture/infrastructure.md](architecture/infrastructure.md) | What it runs on: Hetzner VM, Docker Compose services, Caddy, GHCR images, engine bundle, backups |
| [architecture/draft-engine.md](architecture/draft-engine.md) | Draft engine: booster and theme drafts, picks, timers |
| [architecture/card-data/prerelease-cards.md](architecture/card-data/prerelease-cards.md) | Pre-release cards in the card catalog |
| [architecture/card-data/genesys-points.md](architecture/card-data/genesys-points.md) | Genesys points sync and the duel admission reader |
| [architecture/effect-search/artifact.md](architecture/effect-search/artifact.md) | The pinned effect artifact: source and format |
| [architecture/effect-search/tagging.md](architecture/effect-search/tagging.md) | CI effect tagging with Claude: budget, ledger, owner setup |
| [architecture/effect-search/format-staples.md](architecture/effect-search/format-staples.md) | Measured format staples |

## engine

Duel engine internals.

| Doc | Purpose |
|---|---|
| [engine/core-pins.md](engine/core-pins.md) | Engine pins and core hashes; `scripts/ci/build-core.test.mjs` reads its table |
| [engine/ocgcore-wasm-abi.md](engine/ocgcore-wasm-abi.md) | ocgcore-wasm ABI audit |
| [engine/domain-first-turn-draw.md](engine/domain-first-turn-draw.md) | Domain first-turn draw check on the real engine |
| [engine/genesys-engine.md](engine/genesys-engine.md) | Genesys engine field zones (no EMZ, no Pendulum Zones) |
| [engine/card-status-protection-overlays.md](engine/card-status-protection-overlays.md) | Lua overlays that add public hints for active card protections |

## flows

How a player goes through the app. Each page names the entry URL, the steps, and the API routes and services that run.

| Doc | Purpose |
|---|---|
| [flows/README.md](flows/README.md) | Map of all flows |
| [flows/sign-in-and-access.md](flows/sign-in-and-access.md) | Waitlist, invitation, Clerk email/password and Discord sign-in, existing-player recovery |
| [flows/decks.md](flows/decks.md) | Deck builder, imports, alternate art, Genesys points, suggestions |
| [flows/cubes-and-drafts.md](flows/cubes-and-drafts.md) | Cube library, list import, booster and theme drafts, draft room |
| [flows/duels-and-tables.md](flows/duels-and-tables.md) | Create a table, formats, openings, clocks, results |
| [flows/replays.md](flows/replays.md) | Replay, all-seat view, fork and jump in |
| [flows/tournaments.md](flows/tournaments.md) | Create, join by invite link, rounds, series |
| [flows/bug-reports.md](flows/bug-reports.md) | Report bug button to GitHub issue |
| [flows/owner-admin.md](flows/owner-admin.md) | `/admin` console, live spectate, owner CLI |

## api

Backend, HTTP and shared-type contracts.

| Doc | Purpose |
|---|---|
| [api/active-game-guard.md](api/active-game-guard.md) | Active game guard |
| [api/alt-art-picker.md](api/alt-art-picker.md) | Alternate artwork picker |
| [api/cube-list-import.md](api/cube-list-import.md) | Cube list import by name, `.txt` or `.ydk` |
| [api/deck-master-cost.md](api/deck-master-cost.md) | Deck Master LP cost (`engine.seats[].deckMaster`) |
| [api/deck-suggestions-contract.md](api/deck-suggestions-contract.md) | Deck suggestions API |
| [api/draft-host-end.md](api/draft-host-end.md) | Draft host cancellation (a host stop cancels the draft) |
| [api/duel-card-status.md](api/duel-card-status.md) | Card status (protections and counters) |
| [api/effect-search-contract.md](api/effect-search-contract.md) | Effect search foundation |
| [api/effect-search-cube-contract.md](api/effect-search-cube-contract.md) | Cube effect search |
| [api/effect-search-dates.md](api/effect-search-dates.md) | Release dates and cube era |
| [api/effect-search-draft-picks.md](api/effect-search-draft-picks.md) | Smart draft picks |
| [api/effect-search-insights.md](api/effect-search-insights.md) | SQL card insights and HTTP contract |
| [api/genesys-contract.md](api/genesys-contract.md) | Genesys settings, points and validation |

## specs

Rules, rulings and feature specs. The folder path is pinned by tooling.

| Doc | Purpose |
|---|---|
| [specs/multiplayer-rule-coverage.md](specs/multiplayer-rule-coverage.md) | Generated rule coverage table. Do not edit by hand |
| [specs/multiplayer-lp-comparisons.md](specs/multiplayer-lp-comparisons.md) | Owner LP comparison rulings for FFA |
| [specs/2026-09-30-multiplayer-core-design.md](specs/2026-09-30-multiplayer-core-design.md) | One ygopro-core for 1v1, Tag, FFA3 and FFA4 |
| [specs/2026-09-30-multiplayer-card-scenarios.md](specs/2026-09-30-multiplayer-card-scenarios.md) | Multiplayer card scenarios and forbidden list |
| [specs/2026-09-30-preset-contract.md](specs/2026-09-30-preset-contract.md) | Preset contract (duel host and web) |
| [specs/2026-09-30-duel-results-tournaments-draft-decks-design.md](specs/2026-09-30-duel-results-tournaments-draft-decks-design.md) | Duel results, tournament duels, series and draft decks |
| [specs/2026-10-01-domain-nseat-stress.md](specs/2026-10-01-domain-nseat-stress.md) | Domain engine proof at three and four seats |
| [specs/2026-10-07-tag-shared-emz-ui.md](specs/2026-10-07-tag-shared-emz-ui.md) | Tag shared EMZ UI |
| [specs/2026-10-10-replay-fork.md](specs/2026-10-10-replay-fork.md) | All-seat replay and replay fork |
| [specs/2026-10-11-duel-storage-compaction.md](specs/2026-10-11-duel-storage-compaction.md) | Duel snapshot storage compaction |
| [specs/deck-import-formats.md](specs/deck-import-formats.md) | Simulator deck imports (YDK, ydke, name lists) and alternate art policy |
| [specs/multiplayer-core-sites.txt](specs/multiplayer-core-sites.txt) | Core site census for the multi-seat patches |

## banlists

| Doc | Purpose |
|---|---|
| [banlists/2026-10.md](banlists/2026-10.md) | October 2026 banlist source audit |

## adr

Architecture decision records.

| Doc | Purpose |
|---|---|
| [adr/0001-internal-call-notifier.md](adr/0001-internal-call-notifier.md) | Signed internal calls and the broadcaster facade |
| [adr/0002-multiplayer-duel-rules.md](adr/0002-multiplayer-duel-rules.md) | Multiplayer duel rules: Domain FFA and TCG Tag. The rules source |
| [adr/0003-duel-test-layers.md](adr/0003-duel-test-layers.md) | Test layers: engine tests in Vitest, few Playwright flows |
| [adr/0004-alpha-access-clerk.md](adr/0004-alpha-access-clerk.md) | Clerk waitlist sign-in and the `users` table |
| [adr/0005-competitive-clock-recovery.md](adr/0005-competitive-clock-recovery.md) | Competitive clock recovery and idle backstop |
| [adr/0006-admin-discord-bot.md](adr/0006-admin-discord-bot.md) | The admin Discord bot returns |

## deployment

Operations reference.

| Doc | Purpose |
|---|---|
| [deployment/vm-runbook.md](deployment/vm-runbook.md) | Main ops reference: VM setup, deploy pipeline, rollback, backups, env |
| [deployment/domains.md](deployment/domains.md) | Hosts, DNS, Caddy routes, Clerk instances |
| [deployment/duel-engine-switch.md](deployment/duel-engine-switch.md) | Which engine runs which table, and the multiplayer flag |
| [deployment/engine-data-updates.md](deployment/engine-data-updates.md) | Weekly engine data updates and their review |
| [deployment/admin-console.md](deployment/admin-console.md) | `/admin` console setup |
| [deployment/discord-bot.md](deployment/discord-bot.md) | Admin Discord bot setup and permissions |
| [deployment/discord-join-alerts.md](deployment/discord-join-alerts.md) | Discord join request alerts (webhook) |

## runbooks

One page per automated job. [runbooks/README.md](runbooks/README.md) has the status table and the secrets list.

| Doc | Job |
|---|---|
| [runbooks/deploy.md](runbooks/deploy.md) | Deploy to production |
| [runbooks/test-and-nightly.md](runbooks/test-and-nightly.md) | Test, nightly fuzz and new-card smoke |
| [runbooks/engine-data-update.md](runbooks/engine-data-update.md) | Engine data update |
| [runbooks/effect-tagging.md](runbooks/effect-tagging.md) | Effect tagging |
| [runbooks/format-staples.md](runbooks/format-staples.md) | Format staples |
| [runbooks/ghcr-cleanup.md](runbooks/ghcr-cleanup.md) | GHCR image cleanup |
| [runbooks/worker-timers.md](runbooks/worker-timers.md) | Worker timers |
| [runbooks/worker-syncs.md](runbooks/worker-syncs.md) | Card set, Genesys and image cache syncs |
| [runbooks/duel-server-timers.md](runbooks/duel-server-timers.md) | Duel server timers |
| [runbooks/discord-bot.md](runbooks/discord-bot.md) | Discord bot timers |
| [runbooks/vm-backup.md](runbooks/vm-backup.md) | VM database backup |
| [runbooks/vm-upkeep.md](runbooks/vm-upkeep.md) | VM upkeep |

## testing

| Doc | Purpose |
|---|---|
| [testing/README.md](testing/README.md) | Map of the test layers and where each guide lives |
| [testing/deck-suggestions-quality.md](testing/deck-suggestions-quality.md) | Deck suggestion quality evaluation |
| [testing/deck-suggestions-quality-lists.md](testing/deck-suggestions-quality-lists.md) | Card lists for that evaluation |

## audits

Dated reviews and investigations.

| Doc | Purpose |
|---|---|
| [audits/2026-10-05-hand-card-rules.md](audits/2026-10-05-hand-card-rules.md) | Hand effect audit and owner decisions |
| [audits/2026-10-10-betb-prerelease.md](audits/2026-10-10-betb-prerelease.md) | Released BETB cards kept as previews |
| [audits/2026-10-10-betb-remap-review.md](audits/2026-10-10-betb-remap-review.md) | BETB historical passcode review |
| [audits/2026-10-19-ars-magna-380.md](audits/2026-10-19-ars-magna-380.md) | Issue 380: Ars Magna hand search |
| [audits/2026-10-19-engine-data-395.md](audits/2026-10-19-engine-data-395.md) | Engine data PR 395 review |
| [audits/2026-10-19-report-reconstruction.md](audits/2026-10-19-report-reconstruction.md) | Bug report reconstruction and log limits |
| [audits/2026-10-22-duel-startup-locks.md](audits/2026-10-22-duel-startup-locks.md) | Duel startup SQLite contention |
| [audits/2026-10-23-bug-report-auth.md](audits/2026-10-23-bug-report-auth.md) | Report bug authentication |

## performance

Measurement reports.

| Doc | Purpose |
|---|---|
| [performance/duel-server-memory.md](performance/duel-server-memory.md) | Duel server memory (with JSON data) |
| [performance/replay-load.md](performance/replay-load.md) | Replay open times (with JSON data) |
| [performance/dice-to-duel-load.md](performance/dice-to-duel-load.md) | Dice result to duel field load time |
| [performance/deck-suggestions.md](performance/deck-suggestions.md) | Deck suggestions performance |
| [performance/effect-search.md](performance/effect-search.md) | Effect search performance |
| [performance/effect-search-memory.md](performance/effect-search-memory.md) | Effect search startup memory |

## design

Design references that code or tests use. [design/README.md](design/README.md) is the design index.

| Doc | Purpose |
|---|---|
| [design/bigger-field-contract.md](design/bigger-field-contract.md) | Bigger field shared UI contract |
| [design/sign-in/README.md](design/sign-in/README.md) | Sign-in design |
| [design/clerk-email/README.md](design/clerk-email/README.md) | Clerk email templates |
| [design/coin-toss/backend.md](design/coin-toss/backend.md) | Coin toss FX timing contract |
| [design/fx/destroy-sequence.md](design/fx/destroy-sequence.md) | Destroy and move FX sequence |
| [design/duel-3d-mode/concept/solid-vision/CONCEPT.md](design/duel-3d-mode/concept/solid-vision/CONCEPT.md) | 3D mode concept; e2e baseline |
| `design/draft-room/` | Draft room design workshop and shots |

## plans

| Doc | Purpose |
|---|---|
| [plans/roadmap.md](plans/roadmap.md) | Open and parked work |

## agents

Docs for agent skills.

| Doc | Purpose |
|---|---|
| [agents/domain.md](agents/domain.md) | How agents use `CONTEXT.md` and `adr/` |
| [agents/issue-tracker.md](agents/issue-tracker.md) | GitHub issues in `DuelingDomain/yugioh-bot` |
| [agents/triage-labels.md](agents/triage-labels.md) | Triage label names |

## Package docs

These docs stay next to their code.

| Doc | Purpose |
|---|---|
| [packages/e2e/README.md](../packages/e2e/README.md) | Playwright e2e on an isolated stack |
| [packages/e2e/stack/MANUAL.md](../packages/e2e/stack/MANUAL.md) | Run the isolated stack by hand |
| [packages/duel-server/legacy-1v1/README.md](../packages/duel-server/legacy-1v1/README.md) | Legacy 1v1 engine pin |
| [packages/duel-server/domain-core/patches/README.md](../packages/duel-server/domain-core/patches/README.md) | Domain core patch series |
| [packages/duel-server/domain-core/proposals/domain-nseat-stress/README.md](../packages/duel-server/domain-core/proposals/domain-nseat-stress/README.md) | Engine patch proposals not yet applied |
| [packages/duel-server/tests/scenarios/README.md](../packages/duel-server/tests/scenarios/README.md) | Scenario test layer |
| [packages/duel-server/tests/scenarios/generated/README.md](../packages/duel-server/tests/scenarios/generated/README.md) | Generated scenarios from failures |
| [packages/duel-server/tests/differential/README.md](../packages/duel-server/tests/differential/README.md) | Differential engine tests |
| [packages/duel-server/scripts/native/README.md](../packages/duel-server/scripts/native/README.md) | Native engine checks |
| [packages/duel-server/scripts/native/checks/README.md](../packages/duel-server/scripts/native/checks/README.md) | Native check catalog |
| [packages/bot/src/features/moderation/README.md](../packages/bot/src/features/moderation/README.md) | Bot moderation commands |
| [packages/bot/src/features/server/README.md](../packages/bot/src/features/server/README.md) | Bot server setup commands |
| [packages/bot/src/features/waitlist/README.md](../packages/bot/src/features/waitlist/README.md) | Bot waitlist decisions |
| [packages/bot/src/features/community/README.md](../packages/bot/src/features/community/README.md) | Bot community commands |
| [packages/bot/assets/welcome/README.md](../packages/bot/assets/welcome/README.md) | Welcome card assets |
| [packages/shared/src/discord-admin/README.md](../packages/shared/src/discord-admin/README.md) | Shared Discord admin API (access, audit, outbox) |
| [packages/shared/scripts/README.md](../packages/shared/scripts/README.md) | Repair scoring after overturned results |
| [packages/shared/data/effects/NOTICE.md](../packages/shared/data/effects/NOTICE.md) | Effect data attribution |
| [site/README.md](../site/README.md) | Marketing site |

## Waiting for an owner decision

The two `effect-search-*missing-tags.csv` lists may be deleted after owner approval, so this index does not link them.
