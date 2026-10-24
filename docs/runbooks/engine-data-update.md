# Engine data update

Workflow: `.github/workflows/engine-data-update.yml`. Full design: [engine-data-updates.md](../deployment/engine-data-updates.md).

## Purpose

Moves the pinned Project Ignis card data (scripts, card database, strings) to the newest commits. It opens one PR for review. A person merges it. Deploy then ships it.

## Schedule & triggers

| Trigger | When |
|---|---|
| Schedule | `0 6 * * 1,4` = Monday and Thursday 06:00 UTC |
| Manual | `workflow_dispatch` with inputs `scripts`, `database`, `strings` (full commit SHAs, optional) and `dry_run` |

Only one run at a time (group `engine-data-update`).

## What it changes

- Branch and PR `chore/engine-data-update`, label `engine-data`.
- Pin files and the Dueling Book passcode JSON files. Nothing else.
- Artifact `engine-data-update-report` (kept 14 days).
- If a person has pushed to the branch, the job does not overwrite it.
- Without `ENGINE_DATA_PR_TOKEN` it starts Test with `new_card_smoke=true` itself.

## Depends on

| Need | Note |
|---|---|
| `ENGINE_DATA_PR_TOKEN` (Actions secret) | Opens the PR. The repo setting blocks PR creation by the Actions token. |
| GitHub, Project Ignis repos | Public. |
| `VM_HOST`, `VM_USER`, `VM_PORT`, `ENGINE_DATA_PROD_SSH_PRIVATE_KEY`, `VM_SSH_KNOWN_HOSTS` | Optional. Read prod script errors. Missing = report says "prod error data unavailable". Not set today. |

## Run it by hand

```bash
# Preview only, no PR
gh workflow run engine-data-update.yml -R DuelingDomain/yugioh-bot -f dry_run=true

# Real run with the newest data
gh workflow run engine-data-update.yml -R DuelingDomain/yugioh-bot -f dry_run=false

# Pin exact commits
gh workflow run engine-data-update.yml -R DuelingDomain/yugioh-bot \
  -f scripts=<sha> -f database=<sha> -f strings=<sha> -f dry_run=false
```

Run locally: `npm run duel:prepare` (see [CLAUDE.md](../../CLAUDE.md)).

## Check it worked

```bash
gh run list -R DuelingDomain/yugioh-bot --workflow engine-data-update.yml --limit 5
gh pr list -R DuelingDomain/yugioh-bot --head chore/engine-data-update
```

Open the PR. Read the report. Wait for Test and the new-card smoke to pass. Then merge.

## When it fails

| Sign | Cause | Action |
|---|---|---|
| `publish` fails with `not permitted to create or approve pull requests` | `ENGINE_DATA_PR_TOKEN` missing or expired | Replace the secret. Re-run the job. |
| `prepare` fails | Source repo changed shape, or validation failed | Open the log. Run with `dry_run=true`. Fix the pin script. |
| Run skipped, no PR | No new data, or the relevance gate found no change | Normal. |
| Branch not updated | A person committed to it | Merge or close that PR, then run again. |

History: red on 10-12, 10-15, 10-19 (token missing). Green on 10-22 after the token was set.

## Cost/limits

No paid service. About one runner hour. Old replays can fail to open after a data update (known, see the design doc).
