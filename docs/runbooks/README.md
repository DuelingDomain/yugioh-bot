# Runbooks

One page for each job that runs by itself. Each page says what the job does, how to run it by hand, what it needs, and what to do when it fails.

Health was checked on **2026-10-24**. Times are UTC. GitHub can start a scheduled run hours late.

## Jobs

| Job | What it does | Schedule (UTC) | Run by hand | Needs | Owner action now | Health |
|---|---|---|---|---|---|---|
| [Engine data update](engine-data-update.md) | Opens a PR with newer card data | Mon + Thu 06:00 | `gh workflow run engine-data-update.yml` | `ENGINE_DATA_PR_TOKEN` | None | OK (last red 10-19, green 10-22) |
| [Effect tagging](effect-tagging.md) | Tags card effects with Haiku, opens a PR | Mon + Wed + Fri 07:30, and on push to main | `gh workflow run effect-tagging.yml -f dry_run=true` | `ANTHROPIC_API_KEY`, `ENGINE_DATA_PR_TOKEN` | Create the ledger once. Add Actions write to the PAT | **FAILING** since 10-21 |
| [Format staples](format-staples.md) | Refreshes measured staple data, opens a PR | Same run as effect tagging | Same workflow (`staples` job) | `ENGINE_DATA_PR_TOKEN` | Add Actions write to the PAT | **Half works**: PR #469 opened, the follow-up dispatch fails |
| [Test and nightly fuzz](test-and-nightly.md) | Runs affected checks. Nightly runs all suites and engine fuzz | Daily 03:17 | `gh workflow run test.yml` | Repository variables | Engine bug in nduel fuzz | **Nightly FAILING** since 10-20. Push runs green |
| [New-card smoke](test-and-nightly.md#new-card-smoke) | Plays new cards on the engine-data PR | On the engine-data PR | `gh workflow run test.yml --ref chore/engine-data-update -f new_card_smoke=true` | Test workflow | None | OK |
| [Deploy](deploy.md) | Builds images and updates production | After a green Test on main | `gh workflow run deploy.yml -f ref=main` | VM SSH secrets, `production` environment | None | OK |
| [Clean GHCR images](ghcr-cleanup.md) | Deletes old image versions | Sunday 05:17 | `gh workflow run ghcr-cleanup.yml` | `GITHUB_TOKEN` (packages write) | None | OK (last run 10-18) |
| [VM database backup](vm-backup.md) | Copies the SQLite file, keeps 7 | Daily 07:30 (+ up to 10 min) | `sudo systemctl start dueling-backup.service` | systemd timer on the VM | Confirm it runs | Not visible from the repo |
| [Worker timers](worker-timers.md) | Draft + tournament timers, presence, analytics, heartbeat, VM health, disk use | Every 1 s to 1 h | Restart the `worker` service | Worker container | None | Not visible from the repo |
| [Worker syncs](worker-syncs.md) | Card sets, Genesys points, image cache cleanup | 04:00 / 06:00 daily, Genesys Sunday 06:00 | Restart the `worker` service | Worker container, ygoprodeck.com | None | Not visible from the repo |
| [Duel server timers](duel-server-timers.md) | Closes idle duels, settles clocks, compresses old snapshots | Every 30 s, every 6 h | Restart the `duel` service | Duel container | Decide on snapshot compression | Not visible from the repo |
| [Discord bot timers](discord-bot.md) | Online-now embed, outbox, welcome cards | Every 3 s to 60 s | Restart the `bot` service | `DISCORD_BOT_ENABLED=1`, `DISCORD_TOKEN` | Say if the bot runs in production | Unknown |
| [VM upkeep](vm-upkeep.md) | OS patches, disk clean, swap, alerts | Manual | See page | SSH to the VM | Answer the open questions | Not in the repo |

"Not visible from the repo" means a person must look at the VM or the admin console. The admin console warns when the worker heartbeat is older than 3 minutes.

## Secrets and tokens

Values are never in the repo. Names only.

| Name | Where | Used by | Rotate | If it expires or is wrong |
|---|---|---|---|---|
| `ENGINE_DATA_PR_TOKEN` | Actions secret | Engine data update, effect tagging, format staples (open PRs, push branches, start Test) | Create a new fine-grained token. Needs Contents, Pull requests and **Actions** write. Replace the secret. Check the expiry date in GitHub token settings. | Jobs fall back to the Actions token. The repo blocks PR creation by that token, so the publish step fails: `GitHub Actions is not permitted to create or approve pull requests` |
| `ANTHROPIC_API_KEY` | Actions secret. Also VM `.env` for the optional phrase reader | Effect tagging; effect search helper | Make a new key in the Anthropic workspace. Replace both copies. | Tagging skips with a notice (secret missing) or fails (key rejected) |
| `EFFECT_TAGGING_LEDGER_TOKEN`, `EFFECT_TAGGING_LEDGER_REPOSITORY` | VM `.env` | Runtime phrase reader (reads the budget ledger) | New token with Contents read/write on this repo | The phrase reader stops. Tagging in CI is not affected |
| `VM_HOST`, `VM_USER`, `VM_PORT` | Actions secrets | Deploy, prod-error export | Edit the secret when the VM changes | Deploy cannot reach the VM |
| `VM_SSH_PRIVATE_KEY` | Actions secret, `production` environment | Deploy | New key pair. Put the public key in the VM `authorized_keys` | Deploy fails at the SSH step |
| `VM_SSH_KNOWN_HOSTS` | Actions secret | Deploy, prod-error export | Run `ssh-keyscan` on the VM after a host key change | Deploy fails host key check |
| `ENGINE_DATA_PROD_SSH_PRIVATE_KEY` | Actions secret. **Not set** | Engine data update, `prod-errors` job | Dedicated key with a restricted `authorized_keys` line, see [engine-data-updates.md](../deployment/engine-data-updates.md) | The report says "prod error data unavailable". The run still passes |
| `SENTRY_AUTH_TOKEN` | Actions secret. **Not set** | Deploy, `report-release` job | Sentry organization token | No release record in Sentry. Deploy does not fail |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Actions variable (set) | Test, Deploy (web build) | Edit the variable | Web image builds with the wrong key |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Actions variables. **Not set** | Test, Deploy (web build) | Edit the variable | Browser analytics and error reports are off |
| `DISCORD_TOKEN` and other `DISCORD_*` ids | VM `.env` | Discord bot | Reset in the Discord developer portal | Bot goes offline |
| `WS_INTERNAL_SECRET` | VM `.env` | Signs calls between web, duel, worker and ws | Change on the VM, then redeploy all services | Live updates stop |
| `POSTHOG_KEY` | VM `.env` | Worker analytics drain | Edit `.env`, restart worker | Queue is cleared, no events sent |
| `CLERK_SECRET_KEY` | VM `.env` | Web sign-in, owner CLI | Clerk dashboard | Sign-in fails |

Names in the first part of the table match `gh secret list -R DuelingDomain/yugioh-bot`. Check expiry dates in GitHub settings. The repo cannot show them.

## Related docs

- [Docs index](../README.md)
- [Architecture](../architecture/README.md)
- [VM runbook](../deployment/vm-runbook.md) (deploy, rollback, restore)
- [Cloudflare plan and maintenance page](../deployment/cloudflare.md)
- [Engine data updates](../deployment/engine-data-updates.md)
- [Effect tagging](../architecture/effect-search/tagging.md)
- [Discord bot setup](../deployment/discord-bot.md)
