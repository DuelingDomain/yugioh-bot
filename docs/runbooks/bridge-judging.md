# Bridge judging

The effect-tagging workflow judges the highest-scoring ten directed candidates per source and format with two independent Haiku 5.5 framings. A candidate remains hidden until both reviews and the deterministic checks pass. Advanced and Genesys evidence are separate. The committed `packages/shared/data/effects/bridge-judgements.jsonl.gz` cache starts empty; it contains no fabricated reviews.

The local preview needs no credential and makes no network requests:

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx tsx scripts/effects/judge-bridges.ts --dry-run
```

The report counts eligible pairs and judge requests, estimates tokens from serialized request bytes, and prices them at $0.10/M input and $0.50/M output with the Batch API's 50% discount. Output assumes 700 tokens per review. This is an estimate; cache writes, reads, actual output and unusually large context can change billed spend. The current initial preview finds 4,898 pairs, 9,796 requests, about 41.8M input and 6.86M output estimated tokens, costing about $3.81. The command defaults to dry run. `--max-requests N` optionally reduces submission size; otherwise the complete initial candidate set is split into batches of at most 1,000 requests.

Live runs require the Actions secret `ANTHROPIC_API_KEY` and the durable `state/bridge-judging` branch. Initialize that branch once through a dispatch on `main`:

```sh
gh workflow run effect-tagging.yml --ref main -f dry_run=false -f initialize_bridge_ledger=true
```

Initialization creates `ledger.json.gz` through GitHub's Git Data API and submits no paid request. Never reinitialize a missing ledger after any paid run; recover its history. Normal scheduled and live dispatched runs collect completed batches even when effect tags have not changed, then submit only uncached evidence. A changed prompt or checked evidence requires new reviews. The workflow continues to run its existing effect-tagging job and its separate tagging budget.

Every Batch submission is preceded by a durable reservation and submission intent. Submitted batches retain their immutable IDs until all result custom IDs have been reconciled. Lost submission responses remain `submission_started` and block further submissions; there is no automatic paid POST retry. The workflow report shows submitted, collected and pending requests, spend settled during the run, monthly settled spend and outstanding reservations. Reservations use conservative full-context pricing rather than the much smaller preview estimate.

There is no bridge monthly cap by default. The optional repository variable `BRIDGE_JUDGE_MONTHLY_USD` caps this offline ledger when configured; unset or blank leaves it uncapped. Runtime bridge judging maintains its own durable host ledger and reads the same optional environment setting. These are separate ledgers, so a configured value is not an account-wide combined limit. The existing effect-tagging $10/month cap does not apply to bridges.

Recover an uncertain submission only with both its reservation ID from the failure log and the matching immutable completed Message Batch ID from the provider:

```sh
gh workflow run effect-tagging.yml --ref main -f dry_run=false \
  -f recover_bridge_reservation=RESERVATION_ID -f recover_bridge_batch=msgbatch_BATCH_ID
```

Recovery verifies the complete result identity set before settling spend. It cannot release a reservation for a still-running, incomplete or mismatched batch. Invalid or malformed reviews are billed but remain hidden for review. Cached evidence is not repeatedly submitted for a malformed verdict.

Validated results are exported to the gzip cache and staged alongside an immutable Batch report. Publication accepts only that data file, verifies its hash, row schema and result provenance, and preserves existing cache entries. Judgement-only changes can be published independently of effect-tag updates through the existing artifact PR workflow. No repository source code is accepted from a judge result. Missing credentials use the offline preview and do not create paid calls.

Targeted validation:

```sh
prlimit --core=0 -- npx tsc -p scripts/effects/tsconfig.json --noEmit
prlimit --core=0 -- npx vitest run scripts/effects/tests/bridge-batch.integration.test.ts --maxWorkers=1
```
