# Bridge judging

The effect-tagging workflow judges the highest-scoring ten directed candidates per source and format with two independent framings. `BRIDGE_JUDGE_MODEL` is pinned to `claude-haiku-5-5`; any other configured model is rejected. Historical Sonnet records remain readable and settle at their originating billing rates. A candidate remains hidden until both reviews and the deterministic checks pass. Advanced and Genesys evidence are separate. The committed `packages/shared/data/effects/bridge-judgements.jsonl.gz` cache must be populated with real completed reviews before enabling Bridges in Suggestions.

Runtime deep searches admit one job per user at a time and run at most two jobs globally. A user can start 15 searches per rolling hour, with no wait after a completed or failed job. Identical queries reuse the 24-hour cache. Hitting the hourly limit returns 429 with `retryAfter`; only that response starts the UI countdown. A full queue returns 503. Pending reviews stay hidden. If every attempted review fails and there is no accepted result, the job fails with “Review service unavailable, try later.” Failed jobs are retryable rather than cached as successful empty searches.

SDK connection, timeout, abort and HTTP errors release their runtime reservations for a later invocation. Provider status and message are logged to the duel-server journal with credential redaction. Ambiguous submission failures retain reservations. Paid malformed or otherwise unusable replies remain billed but store no judgement text and leave the pair pending for a later invocation. Code renders pros from checked primary evidence actions, stopping at the first edge rather than assuming optional follow-up Summons. Haiku can only confirm these pros. Each model-written con or lock sentence must cite a supplied card and quote a supporting clause. Code checks a normalized substring (Unicode, apostrophes, case and whitespace), then a separate Haiku yes/no pass filters the remaining sentences. Missing/invalid quotes and negative, missing, duplicate, malformed or unavailable fact-check answers remove text without changing either independent verdict or grade. The hidden `text_audit` stores citations, status and drop reasons; player API responses contain only display fields. Empty cons are allowed; deterministic warnings and printed lock data remain available.

The paid diagnostic below is opt-in, outside the unit/integration test runner and not used in CI. Run with Node 22 and `ANTHROPIC_API_KEY` already loaded into the process environment. It judges ten directed pairs (Odion → Ashtra/Argostars, Snake-Eye → Fire King/Diabell, Branded → Despia/Bystial, Kashtira → Tearlaments, Swordsoul → Tenyi, Danger! → Dark World and Blue-Eyes → Black Luster Soldier) in a disposable in-memory database, printing checked card texts, raw and filtered reviews, actual shown fields, drop reasons, token usage and USD cost for every judge and fact-check call. Review/invalid outcomes are measured outcomes; missing reviews or provider errors fail the diagnostic. It never prints the key or writes live judgements to the application database.

```sh
npx tsx scripts/effects/check-bridge-judges-live.ts --live
```

The local preview needs no credential and makes no network requests:

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx tsx scripts/effects/judge-bridges.ts --dry-run
```

The report counts eligible pairs and judge requests, estimates tokens from serialized request bytes, and uses the selected model's [current pricing](https://platform.claude.com/docs/en/about-claude/pricing) with the Batch API's 50% discount. The preview assumes 700 output tokens per review. This is an estimate; cache writes, reads, actual output and unusually large context can change billed spend. Re-run the preview against the release artifacts for the current pair count and cost estimate. The command defaults to dry run. `--max-requests N` optionally reduces submission size; otherwise the complete initial candidate set is split into batches of at most 1,000 requests.

Live runs require the Actions secret `ANTHROPIC_API_KEY` and the durable `state/bridge-judging` branch. Initialize that branch once through a dispatch on `main`:

```sh
gh workflow run effect-tagging.yml --ref main -f dry_run=false -f initialize_bridge_ledger=true
```

Initialization creates `ledger.json.gz` through GitHub's Git Data API and submits no paid request. Never reinitialize a missing ledger after any paid run; recover its history. Normal scheduled and live dispatched runs collect completed batches even when effect tags have not changed, then submit only uncached evidence. A changed prompt or checked evidence requires new reviews. The workflow continues to run its existing effect-tagging job and its separate tagging budget.

## Release prerequisite: populate Suggestions

Do this after the bridge workflow, its corrected candidate artifacts and current judge parser are available on `main`, before enabling the feature. A dispatch against an older `main` without `initialize_bridge_ledger` cannot initialize or judge bridges. Do not substitute hand-written approvals for provider results.

1. Check whether `state/bridge-judging` already exists. If it exists, preserve its ledger and skip initialization. If it is missing after any prior paid run, recover its history. For a first installation only, run the initialization dispatch above and wait for it to succeed; it submits no paid judge requests.
2. Submit the initial live batch with `gh workflow run effect-tagging.yml --ref main -f dry_run=false`. Wait for the Actions run in the foreground. An Actions run finishing does not mean its provider batches have finished: read its report for pending requests.
3. Once the submitted batches finish, dispatch the same live workflow again to collect their results. Continue until the report reconciles the initial batch and the artifact contains completed reviews for the release candidates. Preserve the immutable batch IDs and report. The normal workflow can publish artifact PRs; perform these release dispatches only when that publication is authorized.
4. Download `effect-tagging-report` from the collection run, validate its judgement candidate with the existing publication validator, and commit the collected `packages/shared/data/effects/bridge-judgements.jsonl.gz` with its provenance. Rebuild shared and rerun the targeted judgement integration tests against that cache. Import it into a disposable database with the matching capability and bridge artifacts and verify that Suggestions for the core sources return up to four judge-approved bridges in each supported format. Inspect sources with fewer accepted results; never fill an empty row with pending candidates.
5. Enable the feature only after those checks. Record the collection run and accepted-pair counts in the release notes. A changed evidence hash or parser identity may require fresh reviews; an older nonempty cache alone does not establish release readiness.

As of this backend repair, remote `main` lacks the bridge-specific dispatch inputs and collection steps. The cache remains empty until this prerequisite can run after integration. Local backend verification does not satisfy this release prerequisite.

Every Batch submission is preceded by a durable reservation and submission intent. Grounded notes from collected judge replies remain hidden until a separate fact-check batch completes. Each follow-up request durably stores its draft review and reserves its own serialized request and output allowance before submission; collection settles its actual usage with the Batch discount. Collection may therefore submit a follow-up text batch, which needs another collection run. Runtime fact-checks likewise reserve and settle separately; if budget or service availability prevents checking, only the unchecked text is dropped. Verdicts still come exclusively from the two original judges. Submitted batches retain their immutable IDs until all result custom IDs have been reconciled. Lost submission responses remain `submission_started` and block further submissions; there is no automatic paid POST retry. The workflow report shows submitted, collected and pending requests, spend settled during the run, monthly settled spend and outstanding reservations. New runtime and Batch reservations use the serialized request size (bytes / 3, plus 50% token overhead and 512 tokens), maximum output tokens and a further 25% billing margin at cold one-hour-cache-write rates. Historical full-context reservations remain readable.

There is no bridge monthly cap by default. The optional repository variable `BRIDGE_JUDGE_MONTHLY_USD` caps this offline ledger when configured; unset or blank leaves it uncapped. Runtime bridge judging maintains its own durable host ledger and reads the same optional environment setting. These are separate ledgers, so a configured value is not an account-wide combined limit. The existing effect-tagging $10/month cap does not apply to bridges.

Recover an uncertain submission only with both its reservation ID from the failure log and the matching immutable completed Message Batch ID from the provider:

```sh
gh workflow run effect-tagging.yml --ref main -f dry_run=false \
  -f recover_bridge_reservation=RESERVATION_ID -f recover_bridge_batch=msgbatch_BATCH_ID
```

Recovery verifies the complete result identity set before settling spend. It cannot release a reservation for a still-running, incomplete or mismatched batch. Invalid verdicts are stored as rejected; unsure verdicts remain in review. Malformed replies are billed without storing a verdict and may be submitted again on a later run, never during the same collection run.

Validated results are exported to the gzip cache and staged alongside an immutable Batch report. Publication accepts only that data file, verifies its hash, row schema and result provenance, and preserves existing cache entries. Judgement-only changes can be published independently of effect-tag updates through the existing artifact PR workflow. No repository source code is accepted from a judge result. Missing credentials use the offline preview and do not create paid calls.

Targeted validation:

```sh
prlimit --core=0 -- npx tsc -p scripts/effects/tsconfig.json --noEmit
prlimit --core=0 -- npx vitest run scripts/effects/tests/bridge-batch.integration.test.ts --maxWorkers=1
```
