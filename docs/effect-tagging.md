# CI effect tagging

`.github/workflows/effect-tagging.yml` tags new or changed printed effects from
the approved engine catalog. The application only imports the reviewed pinned
artifact: it never calls a model or needs an Anthropic credential. Card text is
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
   requests, ledger mutations or publication.
4. To submit/collect, dispatch with `dry_run=false`. Approved `main` changes to
   the engine preparation pin also trigger a run; a daily 07:30 UTC run collects
   completed work. Without the API secret these runs stay dry. All runs share
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

The code pins `claude-haiku-4-5-20251001`, whose context bound is 200,000 tokens.
It sends at most eight cards per Batch request and sets output to 20,000 tokens.
It omits caching, thinking, tools and effort.
[Anthropic model specifications](https://platform.claude.com/docs/en/models/haiku-4-5/overview).

Verified on 2026-10-17, Batch pricing is USD $0.50 per million input tokens and
$2.50 per million output tokens. The worst accepted request therefore costs at
most `$0.50 × 0.2 + $2.50 × 0.02 = $0.15`; this entire amount is reserved before
submission, regardless of estimates or actual card count. Settlement rounds
actual usage upward to an integer microdollar. Recheck the official price and
model limits before changing the pinned model or enabling after a price change.
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

The $10 cap is enforced by settled spend in the current UTC month plus **all**
unsettled reservations, including prior months. Missing, corrupt or conflicting
durable state blocks live operation. Monthly totals must exactly equal complete
settled reservation history. Do not prune or hand-edit this history. Protect
the state branch against deletion and force replacement, preserve fast-forward
writes by the workflow, and keep Git backups. Other consumers of the same API
workspace are outside this pipeline's cap.

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
runs. Invalid tag content still settles billed token usage, and failed inputs
are deferred for the rest of that month. Missing/duplicate result IDs or usage
outside the reserved bounds leave the full liability held.

For `submission_started`, inspect the Anthropic workspace and match the recorded
reservation's `et_<reservation-id>_<request-index>` custom IDs. Dispatch on
`main` with `dry_run=false`, `recover_reservation=<reservation-id>` and
`recover_batch=<msgbatch-id>`. Recovery performs GETs only and settles only
after every expected custom ID has a complete matching terminal result. A
processing or mismatching batch releases nothing. When an ID or results cannot
be recovered, the reservation stays held across month changes; do not delete
it or retry its POST. The durable ledger records card inputs and prompt hashes
for inspection and contains no API key.

## Artifact publication and provenance

Results pass structured output validation, copied upstream repair/defaulting,
quoted-name cleanup, and the application CardTags schema. The generator emits
candidate files in a temporary output directory: deterministic compressed
tags/source hashes, a new manifest and two literal code pin replacements.
Profiles and popularity are byte-identical to the prior pin. Text hashes record
the actual submitted printed effect, never current text substituted for an old
tag's source.

The fixed source metadata continues to credit LorenzoWhite/searchygo commit
`9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c` as the foundation. Changed file
descriptors retain `baseSourcePath`/`baseSourceSha256`; generation metadata adds
the immutable model, prior artifact version, normalization, prompt hashes,
reservation IDs and accepted-results digest. Generated cards are attributed to
the Batch generation rather than claimed as verbatim upstream bytes. Schema
adapters retain their upstream source headers.

Before publication, CI verifies the strict four-file allowlist, builds the
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
