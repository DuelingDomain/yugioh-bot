# Effect tagging

Workflow: `.github/workflows/effect-tagging.yml`. Full design, budget rules and recovery: [effect-tagging.md](../effect-tagging.md).

## Purpose

Uses Claude Haiku 5.5 (Batch API) to tag what each new card does. Opens a PR with the tags. The same workflow also refreshes the [format staples](format-staples.md) and fills card release months from the free YGOPRODeck API.

## Schedule & triggers

| Trigger | When |
|---|---|
| Schedule | `30 7 * * 1,3,5` = Monday, Wednesday, Friday 07:30 UTC |
| Push to `main` | Only when these paths change: `packages/duel-server/scripts/prepare-data.ts`, `scripts/effects/**`, `scripts/staples/**`, `packages/shared/src/cards/effects/tags.ts`, `synergy.ts`, `scripts/ci/publish-effect-tags.mjs`, the workflow file |
| Manual | Inputs: `dry_run` (default `true`), `initialize_ledger`, `recover_reservation`, `recover_batch` |

Jobs: `validate` (offline tests) then `tag` then `publish`. `staples` runs apart. One run at a time (group `effect-tagging-budget`).

## What it changes

- Branch and PR `chore/effect-tags` (tags).
- Branch and PR `chore/format-staples-<sha>-<hash>` (staples).
- Budget ledger: file `ledger.json` on git branch `state/effect-tagging`.
- Artifacts `effect-tagging-report`, `format-staples`.

## Depends on

| Need | Note |
|---|---|
| `ANTHROPIC_API_KEY` (Actions secret) | Set 2026-10-24. If missing, the `tag` job skips with a notice. |
| `ENGINE_DATA_PR_TOKEN` | Contents, Pull requests and **Actions** write. |
| Branch `state/effect-tagging` | **Does not exist yet.** Create it once (below). |
| YGOPRODeck API | Free. Release months. |

## Run it by hand

```bash
R=DuelingDomain/yugioh-bot

# 1. ONE TIME, before any paid run: create the ledger. No Anthropic call.
gh workflow run effect-tagging.yml -R $R --ref main -f dry_run=false -f initialize_ledger=true

# 2. Safe preview. No spend, no PR.
gh workflow run effect-tagging.yml -R $R --ref main -f dry_run=true

# 3. Real run.
gh workflow run effect-tagging.yml -R $R --ref main -f dry_run=false

# Recovery after a crashed run (ids come from the run log)
gh workflow run effect-tagging.yml -R $R --ref main -f dry_run=false -f recover_reservation=<id>
gh workflow run effect-tagging.yml -R $R --ref main -f dry_run=false -f recover_batch=<id>
```

Release months by hand: `npm run effects:fill-releases -- --apply`.

Never run `initialize_ledger` if tagging has run before. Restore the old ledger from git history.

## Check it worked

```bash
gh run list -R DuelingDomain/yugioh-bot --workflow effect-tagging.yml --limit 5
gh pr list -R DuelingDomain/yugioh-bot --head chore/effect-tags
gh api repos/DuelingDomain/yugioh-bot/branches/state/effect-tagging --jq .name
```

Open the run summary. It shows spend for this run and this month.

## When it fails

| Sign | Cause | Action |
|---|---|---|
| `Durable budget ledger is missing; explicit initialization is required` | Ledger not created | Do step 1 above. **This is the failure today.** |
| `publish`/`staples`: `not permitted to create or approve pull requests` | PAT missing | Fixed by PR #468. Check the secret. |
| `staples`: `Resource not accessible by personal access token` on `gh workflow run test.yml` | PAT has no Actions write | Add Actions: Read and write to the token. The PR is still created. |
| `tag` skipped, notice about key | `ANTHROPIC_API_KEY` missing | Set the secret. |
| Budget refused | Over $2 per run or $10 per month | Wait for next month, or see the design doc. Do not edit the ledger by hand. |

Run health: scheduled runs failed 10-21 to 10-24. Run 40114637829 (10-24, push) failed on the missing ledger. Run 40114645212 (dispatch) was still running at check time.

## Cost/limits

| Limit | Value |
|---|---|
| Per run | $2 |
| Per month | $10 |
| Hold per batch request | $0.275 |
| Model | `claude-haiku-5-5`, 8 cards per request |

Staples and release-month fill cost nothing.
