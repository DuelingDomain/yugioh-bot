# CI effect tagging

`.github/workflows/effect-tagging.yml` tags new or changed printed effects from
the approved engine catalog. Card tagging in the application only imports the reviewed pinned
artifact. The optional runtime phrase reader uses the same budget ledger;
see the runtime reader section below. Card text is
normalized and hashed using the [artifact contract](effect-search-artifact.md).
Known artwork/remaps fold before comparison; named functional aliases retain
their own identity. Tokens, empty effects and ordinary Normal Monsters are
excluded. Normal Pendulum Monsters with effects remain eligible.

## Enable and run

1. Set the repository Actions secret `ANTHROPIC_API_KEY` for a dedicated
   Anthropic workspace. Enable repository Actions to create pull requests.
   The workflow token needs contents write for the ledger and artifact branch,
   pull requests write, and actions write for the explicit Test dispatch.
   `EFFECT_TAGGING_PR_TOKEN` is an optional replacement publication token with
   these permissions; it is only exposed to the publication job.
2. Before **any** spend, manually dispatch **Effect tagging** on `main` with
   `dry_run=false` and `initialize_ledger=true`. This creates the independent
   `state/effect-tagging` branch containing `ledger.json` and makes no Anthropic
   request. Initialization refuses to replace an existing ledger. If tagging
   has ever run, restore a lost ledger from its Git history or backups instead
   of initializing an empty one.
3. For an inspection, dispatch with the default `dry_run=true`. It reads the
   catalog/artifact and ledger, writes a report artifact, and performs no paid
   requests, ledger mutations or publication. Before the first paid run, inspect
   `report.profileCandidates`; hand-written profiles and the pinned synergy
   examples (Dark World and Tearlaments) must never be refresh candidates.
4. To submit/collect, dispatch with `dry_run=false`. Approved `main` changes to
   the engine preparation pin also trigger a run; a daily 07:30 UTC run collects
   completed work. Without the API secret paid runs skip cleanly and emit an Actions notice. Explicit dry runs remain available. All runs share
   one concurrency group with cancellation disabled.

The CLI also defaults to a keyless dry run. Build shared first, then point it at
an already prepared catalog; this does not run preparation or change its data:

```bash
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- node --import tsx scripts/effects/tag-cards.ts \
  --engine-directory /absolute/path/to/prepared-engine \
  --output .status/effect-tagging
```

The workflow reports candidates, submitted/collected batches, reusable tags,
pending reservations, spent plus held dollars and reasons for deferral. Reports
are downloadable for 14 days. Completed accepted tags remain in the durable
ledger and are reused until their artifact PR merges, preventing repeated paid
tagging of the same inputs.

## Hard monthly budget

The code pins `claude-haiku-5-5`. It sends at most eight cards per tag
request or forty representative members per profile request, with a 20,000
output-token limit. New members take priority over popular members. Archetypes
need at least three members. Hand-written profiles and synergy examples are
preserved. Other upstream profiles refresh when their member count
grows; generated profiles also refresh when their member-input hash changes.
The upstream artifact has counts but no member IDs, so equal-count membership
replacement in an original profile cannot be detected until its first refresh.
[Anthropic model specifications](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
Both request kinds explicitly disable thinking so the output-token allowance is
available for structured replies.

Verified on 2026-10-17, Haiku 5.5 Batch pricing is $0.05/M input and $0.25/M
output up to 100,000 input tokens, and $0.25/M input and $1.25/M output above
that threshold. The 1M context bound and 20K output limit give a conservative
maximum of `$0.25 × 1 + $1.25 × 0.02 = $0.275` per request. This whole amount
is reserved before submission, including structured-schema and thinking tokens;
local token estimates never authorize spend. Actual usage rounds upward to an
integer microdollar. Both request kinds share the $2 per-run cap: at most seven
requests ($1.925 held). `--max-requests` can reduce this, never raise the cap.
The 500 KB request-size safety limit is a transport bound, not a proven bound on
billed tokens including server-added schema overhead, so it does not lower the
reservation. This limits a tag-only run to 56 cards (48 with a profile request).
Historical Haiku 4.5 ledger entries remain readable, retain their $0.15 holds,
and settle using their original rate; their POST is never repeated after intent.
A legacy batch still in `reserved` state can be trimmed to the run cap before
submission intent; unsubmitted excess inputs become eligible on later runs.
No `submission_started` or `submitted` liability is ever reduced this way.
Recheck official prices and limits before changing the model or rates.
[Anthropic Batch pricing](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

The $10 cap is enforced by settled spend in the current UTC month plus **all**
unsettled reservations, including prior months. Missing, corrupt or conflicting
durable state blocks live operation. Monthly totals must exactly equal complete
settled reservation history. Do not prune or hand-edit this history. Protect
the state branch against deletion and force replacement, preserve fast-forward
writes by the workflow, and keep Git backups. The runtime phrase reader is included in this same cap. Other consumers of
the same API workspace are outside it.

Git Data API commits use structured JSON and a compare-and-swap revision;
non-fast-forward updates fail. A reservation is committed, then submission
intent is committed, before the one allowed POST. No uncertain submission is
automatically repeated or refunded. Cancellation cannot remove committed
liability. A new submission is deferred during the final 25 hours of a UTC
month. Workspace spend limits alone may overshoot; batches may process for
24 hours and results remain available for 29 days.
[Anthropic Batch behavior](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

## Recovery

Known immutable Batch IDs in `submitted` entries are polled on subsequent live
runs. Invalid tag content still settles billed token usage, and unchanged failed
inputs are deferred for the rest of that month. A changed profile member-input
hash permits a new attempt within the same month. Missing/duplicate result IDs or usage
outside the reserved bounds leave the full liability held.

For `submission_started`, inspect the Anthropic workspace and match the recorded
reservation's `et_<reservation-id>_<request-index>` custom IDs. Dispatch on
`main` with `dry_run=false`, `recover_reservation=<reservation-id>` and
`recover_batch=<msgbatch-id>`. Recovery performs GETs only and settles only
after every expected custom ID has a complete matching terminal result. A
processing or mismatching batch releases nothing. When an ID or results cannot
be recovered, the reservation stays held across month changes; do not delete
it or retry its POST. The durable ledger records card inputs and prompt hashes
for inspection and contains no API key. New profile requests store only their
prompt hash; submission rebuilds the prompt from pinned code and checks the hash
before recording intent. A mismatch leaves the reservation unsubmitted and held.
Historical requests with full saved profile prompts remain resumable. Collection
uses the saved hash, even if the prompt code has changed since submission.

## Artifact publication and provenance

Results pass structured output validation, copied upstream repair/defaulting,
quoted-name cleanup, and the application CardTags schema. The generator emits
candidate files in a temporary output directory: deterministic compressed
tags/source hashes, a new manifest and two literal code pin replacements.
Only accepted profile rows can change. Popularity remains byte-identical to the prior pin. Text hashes record
the actual submitted printed effect, never current text substituted for an old
tag's source.

The fixed source metadata continues to credit LorenzoWhite/searchygo commit
`9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c` as the foundation. Changed file
descriptors retain `baseSourcePath`/`baseSourceSha256`; generation metadata adds
the sorted `generation.models` set of models used by the accepted results,
prior artifact version, normalization, prompt hashes,
reservation IDs and accepted tag/profile digests. Generated profile rows retain their member-input hash for the next refresh. Generated cards are attributed to
the Batch generation rather than claimed as verbatim upstream bytes. Schema
adapters retain their upstream source headers.

Before publication, CI verifies the strict six-file allowlist (manifest, tags, source hashes, profiles, releases, and artifact pin source), builds the
candidate shared package, runs real-artifact SQLite tests and evaluates the
prepared engine's 60-query search fixture against that candidate. The publisher
then revalidates data and pin-only code changes in a fresh checkout. It opens or
updates `chore/effect-tags`, skips if `main` advanced, and preserves any commit
whose author **or committer** differs from the bot. It uses a lease to update
that branch and explicitly dispatches the repository Test workflow. Review and
merge the concrete artifact PR through normal repository rules.

Offline integration checks exercise real compressed artifacts, SQLite catalog
identities, durable disk CAS, fake HTTP Batch responses, budget corruption,
ambiguous submission, result billing and candidate publication validation:

```bash
prlimit --core=0 -- npx tsc -p scripts/effects/tsconfig.json --noEmit
prlimit --core=0 -- npx vitest run scripts/effects/tests/effect-tagging.integration.test.ts --maxWorkers=1
```

These checks need no API secret and issue no GitHub writes or paid requests.

## Files and worker contract

- `scripts/effects/tag-cards.ts`: CLI and `runTagging(options)`. Default is dry
  run; `--live` needs the owner secret and initialized durable state.
- `scripts/effects/profile-archetypes.ts`: count/hash selection and Zod plus
  `readProfile` validation; `synergy-prompt.ts` ports the credited upstream prompt.
- `budget-ledger.ts`, `batch-client.ts`: one ledger and one Batch transport for
  both kinds. Profile prompt hashes and card input snapshots survive restarts. Failed
  profiles settle their billed usage; unchanged failed inputs are deferred until
  the next UTC month.
- `artifact-output.ts`, `scripts/ci/publish-effect-tags.mjs`: generate and validate
  the candidate in `.status/effect-tagging`; no checked-out pin changes locally.
  The PR may change `packages/shared/data/effects/{manifest.json,tags.jsonl.gz,
  source-hashes.json.gz,profiles.jsonl.gz}` plus the two literal constants in
  `packages/shared/src/cards/effects/artifact.ts`. Each compressed file and its
  uncompressed content have SHA-256 descriptors.
- `.github/workflows/effect-tagging.yml`: starts after an approved engine pin
  merges to main, including Monday/Thursday engine update PRs; daily runs collect
  completed batches. It tags the approved catalog, rather than sending unreviewed
  engine PR input to the paid API. Engine update PRs do not wait for Batch completion.
- Runtime APIs, `card_tags`, `card_tag_profiles`, `EFFECT_SEARCH=1`, the attribution
  constant, and summary display are unchanged. No API key is needed to search pinned tags. The optional hard-phrase reader
uses a runtime key and the same durable ledger.

Before publishing, CI evaluates all sixty engine queries against the generated
pin. Any failed expected hit or exclusion fails the job; no lower score is
accepted. The generated PR also dispatches the normal Test workflow. No generated
artifact was committed from a real model in local development: the integration
suite exercises candidate generation, validation and dry run with fake responses.
The owner must add `ANTHROPIC_API_KEY` and initialize the ledger before paid use.
No secret is created by this change.


## Optional runtime phrase reader

Behind `EFFECT_SEARCH`, authenticated deck search and public-catalog insights may
make one Messages POST for a low-confidence or empty rule reading. This never
tags cards. It uses `claude-haiku-5-5`, disables thinking, limits output to 1,024
tokens and validates JSON against the existing query vocabulary. Named cards and
unsupported facets are rejected; archetypes must exist in the shared catalog.

Configure `ANTHROPIC_API_KEY` and `EFFECT_TAGGING_LEDGER_TOKEN`
in the calling server process. `EFFECT_TAGGING_LEDGER_REPOSITORY` (or
`GITHUB_REPOSITORY`) is `owner/repo`. The token needs read and fast-forward write
access to the existing `state/effect-tagging` branch. Runtime never initializes
or replaces this branch. Missing credentials, missing/corrupt ledger, CAS
conflict, exhausted budget, HTTP error, SQLite contention or a ledger/request
deadline silently preserve the deterministic result. Successful name
searches, exact/name-only searches, empty explicit pools and chip edits skip it.
No credential or user identity enters the prompt or spend ledger.

The ledger schema and budget calculation live in shared `budget-ledger.ts`;
the CI module re-exports them. Its optional `runtime` history is backward
compatible with version 1. Each Messages request reserves $0.50256 before a
separate durable submission-intent CAS: the worst standard tier on the model's
full 1M context plus 1,024 output tokens. Actual input/output usage settles at
$0.10/$0.50 per million up to 100K input, $0.50/$2.50 above it, rounded upward
to a microdollar. Rates were checked against the official Haiku overview on
2026-10-19. Runtime spends share the existing $10/month cap, not the CI $2/run
cap. Every uncertain hold survives UTC month rollover. Runtime defers during
the final minute of a UTC month and rechecks before POST and settlement.

The shared SQLite `effect_readings` table permanently caches validated readings
by normalized phrase. A durable phrase claim prevents duplicate POSTs across
users, API routes, processes and restarts. Failed/uncertain paid attempts retain
a terminal or pending claim and are never retried. Pre-submission failures release their reservation and may be retried. `effect_reading_limits` applies
a sliding 20 attempts/user/hour and 100 attempts globally/hour; cached hits are
free. User identities are hashed only for this local rate table. Never delete
claims to retry uncertain spend. Search responses contain no model attribution.


## Daily release months

The daily job also fills missing release months from the free
[YGOPRODeck bulk API](https://ygoprodeck.com/api-guide/). This step makes no AI
or paid calls and runs even when the tagging key is absent. Explicit workflow
dry runs and ledger initialization skip it. The job stores a 24-hour disk cache.
It makes one card and one set bulk GET per refresh, with at most three attempts, a 30-second
request timeout, a 200 MB limit per response (header and streaming bytes), exponential backoff, and a bounded Retry-After wait. An API or
validation failure skips the release step and retains the tag candidate.

Missing months are filled; valid months may move earlier to a first print, never later.
TCG years start at 2002; OCG years start at 1999. Names, aliases, quality flags,
tags, and popularity stay intact.
Existing artwork aliases and unique printed names select the original family.
The existing local importer applies engine pre-release remaps. Publication
checks every old release record and refuses deletions or later-month changes.
An earlier valid month requires matching misc or first-set evidence in `report.json`
and a visible per-card line in `report.md`, which becomes the pull request body.
The free source is evidence for human review, not independent verification.
Publication also permits new IDs and date fills, including an update with no new tags.

Run the same free step by hand from the checkout used by the local server:

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
prlimit --core=0 -- npm run effects:fill-releases -- --apply
```

Without `--apply`, the command writes a candidate under `.status/effect-releases`.
Use `--output` and `--cache` to select other directories. After applying, rebuild
shared and its consumers, then restart them. Startup imports the new verified
artifact version. `.status/effect-releases/releases-report.json` lists the counts
and the ten newest filled records. Dates have month precision; default sorting
uses the newest known TCG or OCG month. Explicit region filters use only that region.


## Final review: runtime reservation recovery

Each runtime ledger read and compare-and-swap has its own 10-second limit.
The 2-second limit covers only the Anthropic POST and response body. A failure
before that POST releases the reservation with a fresh ledger read and CAS,
including a lost response from the intent write. Cleanup preserves other rows.
If GitHub is unavailable, cleanup retries three times. The live CI tagging job
removes runtime rows still in `reserved` after more than one hour. It preserves
recent rows, all `submission_started` rows and the complete settled history.
A process whose reservation CI removed cannot commit its stale intent CAS.
After a paid attempt starts, uncertain spend remains held and cannot be retried.


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
