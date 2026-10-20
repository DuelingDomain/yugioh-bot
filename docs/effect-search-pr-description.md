## What this adds

Players can search cards by what they do, in plain words. The card browser, cube editor and draft pages all use it.

- Natural-language effect search, built from searchygo effect tags (about 13,700 tagged cards).
- A "How it plays" panel on a card: what the card does, similar cards, and counters.
- Reason lines under each result, and "relax" hints when a search is too narrow.
- Release dates on cards, "new cards" order, and cube and draft integration (smart picks).
- Haiku fallback for phrases the rules cannot read. It has a $10 per month cap. If the key, ledger or budget is missing, search keeps the rule result and says nothing.
- This branch is already merged with the latest main (admin console, Xyz/drawer, bug reports, ban lists, idle close, auth changes, deck limits). Conflicts kept both sides.

## Flags and secrets

- `EFFECT_SEARCH=1` turns it on. `EFFECT_SEARCH=0` turns it off. If unset, it is on outside production and off in production.
- The owner must add `ANTHROPIC_API_KEY` (Actions secret for tagging, and runtime env for the Haiku fallback). Without it, search still works with rules only.
- The shared tag ledger enforces $10 per UTC month and $2 per run. No paid request was made while building this.

## Owner setup: runtime ledger token

The runtime does not use `GITHUB_TOKEN`. Without a nonblank
`EFFECT_TAGGING_LEDGER_TOKEN`, it makes no ledger request or paid call.
Pinned search and rule readings still work.

1. Use a GitHub organization member account with repository Write access and
   no rule bypass role. Open the profile menu > Settings > Developer settings >
   Personal access tokens > Fine-grained tokens > Generate new token.
2. Name it `effect-runtime-ledger`. Set a short expiration. Select resource
   owner `DuelingDomain`.
3. Under Repository access, choose Only select repositories. Select only
   `DuelingDomain/yugioh-bot`.
4. Under Repository permissions, set Contents to Read and write. Keep the
   required Metadata read permission. Add no other permissions. Generate the
   token. If approval is required, an organization owner must approve it under
   Organization Settings > Personal access tokens > Pending requests.
5. In the repository, open Settings > Rules > Rulesets > New ruleset > New
   branch ruleset. Name it `protect-main-from-runtime`. Set Enforcement to
   Active. Target `main`. Select Require a pull request before merging, Require
   approvals (at least 1), Block force pushes, and Restrict deletions. The token
   account and its roles/teams must have no bypass entry. Save the ruleset.
6. Protect `state/effect-tagging` from force pushes and deletion with a separate
   active branch ruleset. Allow normal fast-forward updates; a PR requirement
   on this branch would block ledger CAS. Use the existing ledger; never reset it.
7. Put the token in the runtime secret manager as `EFFECT_TAGGING_LEDGER_TOKEN`.
   Set `EFFECT_TAGGING_LEDGER_REPOSITORY=DuelingDomain/yugioh-bot`. Restart the
   calling web/duel services. Add the runtime `ANTHROPIC_API_KEY` only after
   token approval and branch protection are complete. Do not give these services
   a general `GITHUB_TOKEN`. The Actions tagging job keeps its own job token.

GitHub fine-grained tokens support repository and permission limits, not a
single file or branch limit. This code writes only `ledger.json` on
`state/effect-tagging`; branch rules protect `main`. A PAT alone cannot enforce
that file allowlist. Keep the runtime key unset if these controls are incomplete.

Sources: [GitHub token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens),
[GitHub branch rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

## Memory (cost to know before merge)

Measured locally on a production standalone build:

- Web RSS: +130.7 MiB after a cold preview, +211.9 MiB after a refresh. Peak 631.4 MiB for web plus its helper.
- A forced-GC test found 70.3 MiB of live heap added.
- **The production VM RSS check is still pending.** SSH to the VM was denied. The local test does not replace it.

Details: `docs/effect-search-performance-verification.md`, `docs/effect-search-memory-verification.md`.

## Credit

searchygo credit is in `NOTICE`, the data notice and source headers only. The UI shows no credit and no AI label.

## Tests

- Typecheck: shared, web, duel-server pass.
- Targeted tests pass: shared effect search, insights, artifact, cube and smart picks; web routes and deck components; duel-server effect-search eval (117 tests, 111 real-artifact queries, no labeled false matches or misses).
- Browser (e2e) specs for deck, cube and draft are in the branch. They run in CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GLTNwBcU5bVhsdGwaZoeik
