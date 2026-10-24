# Format staples

Runs as the `staples` job inside the [effect tagging](effect-tagging.md) workflow. Full design: [format-staples.md](../format-staples.md).

## Purpose

Counts which cards appear in public YGOPRODeck decks (TCG, Domain, Genesys). The deck editor uses the result to suggest staples. No paid key.

## Schedule & triggers

Same as effect tagging: Monday, Wednesday, Friday 07:30 UTC, on matching pushes to main, and by hand. The old doc says "daily". That is out of date.

## What it changes

- Files `packages/shared/data/staples/usage.json` and `decks.json`. Nothing else.
- A new branch `chore/format-staples-<base>-<hash>` and a PR. The job never overwrites a branch and never merges.
- Artifact `format-staples`.

## Depends on

| Need | Note |
|---|---|
| `ENGINE_DATA_PR_TOKEN` | Contents, Pull requests, Actions write |
| ygoprodeck.com deck API | Max 4 pages of 20 decks per source. 20-second timeout, 3-minute limit. |

## Run it by hand

Run the workflow (see [effect tagging](effect-tagging.md#run-it-by-hand)). Or locally with Node 22:

```bash
prlimit --core=0 node scripts/staples/refresh.mjs
STAPLES_BASE_SHA=$(git rev-parse HEAD) prlimit --core=0 node scripts/staples/publish.mjs --validate-only
```

## Check it worked

```bash
gh pr list -R DuelingDomain/yugioh-bot --search "format staples in:title"
```

The PR changes only the two data files. Merge when Test is green.

## When it fails

| Sign | Action |
|---|---|
| `Resource not accessible by personal access token` at `gh workflow run test.yml` | Add Actions write to `ENGINE_DATA_PR_TOKEN`. Seen 10-24. PR #469 was made before the error. |
| `Base advanced; next refresh will retry` | Normal. Main moved. |
| `Artifact branch already exists` | Normal. Same data already has a PR. |
| Many old `chore/format-staples-*` branches | Close the old PRs and delete the branches. |

## Cost/limits

Free. Files must stay under 500 KB. A source that fails keeps its old sample.
