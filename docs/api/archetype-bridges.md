# Directed archetype bridges

Deterministic candidates feed two independent, cached reviews. Player routes return a bridge only when both reviewers accept its checked evidence, agree within one grade, and pass format and feedback checks. Player results say `validation: "deterministic"`, `judge: "accepted"`, and `engine_status: "unverified"`. Candidate CLI methods retain `judge: "pending"`. The player Suggestions row and progress-bar component remain for the UI stage; their server contract is implemented below.

## HTTP interfaces

All player routes require an authenticated application user with a player in the configured guild. The web server derives identity from the session and proxies to the HMAC-signed `POST /internal/duel` operation `bridges`. The host rechecks the user/player/guild mapping on every request, including cache hits and polling. Responses use `Cache-Control: private, no-store`. Client guild/user/player fields are rejected.

`GET /api/cards/bridges?source=Odion&format=advanced` returns at most four shown bridges. Optional query parameters are `target`, `genesysRemaining` (integer 0–1000), and `format=advanced|genesys` (default Advanced). Supply a positive integer `deckId` instead of `source` to infer the archetype from the authenticated owner's saved deck. Exactly one source selector is required. A target requests both directed lookups; `reverse` is present for that lookup.

Suggestions and free two-archetype lookups use the existing strict candidates,
score floor and top-four selection. Deep-only rows never enter these results,
including after a deep job saves them in the shared candidate table.

```ts
// GET response, HTTP 200
{ results: ShownBridge[], reverse?: ShownBridge[], inReview: number }
// Every ShownBridge includes all ArchetypeBridge fields and:
{ judge: "accepted", review: {
  grade: "strong" | "good" | "niche" | "risky",
  pros: string[], cons: string[], // zero to three of each
  lock_note: string, line: string[], // one to three exact supplied card names in order
  steps: { card: string; text: string }[] // exactly one entry per line name, in the same order
} }
```

`review.steps` is generated in code when accepted rows are projected, including
fast lists, `engines` operation `between` rows and `next[].links[].bridge`, and
completed deep results and links. Each `card` exactly matches its corresponding
`review.line` name (at most 200 characters). Each `text` is at most 500 characters
and describes checked access actions and source zones, material use, specific
same-effect costs, or Trap activation permission. An outgoing action takes
precedence over how the card is reached. Later actions remain subject to their
printed conditions; a search does not imply a Summon or a complete playable combo.
Unsupported steps have `text: ""`; no reason description or model-written prose
is substituted. Captions never enter judge input, stored judgements, prompts,
evidence hashes or cache keys, and require no new model calls. Host projection
and web response validators check the shape and ordered alignment. The web
accepts older responses without `steps` during rollout; `pathSteps` prefers an
aligned caption, including empty text, and uses its existing reason fallback
only when the caption is absent.

For a saved Genesys deck, a supplied `genesysRemaining` takes precedence; otherwise the host derives remaining points from its cap and existing copies, including Side. Only additional required copies consume that allowance. Source-only queries compare the complete evidence package against `genesysRemaining`, defaulting to 100. Card legality and the two review gates apply in either case.

`POST /api/cards/bridges/engines` is a SQLite-only fast operation (`engines` on the host). It reads stored candidates without a deep scan or a paid review. Unknown fields are rejected, the body is bounded to 4096 bytes, and each supplied passcode is a positive uint32. At least one of `deck` and `engines` is required; supplying both detects the deck but uses the corrected engines. Names are canonicalized, deduplicated and sorted. An empty detection is a successful empty result. Chip corrections affect Bridges only.

```ts
type BridgeDeck = { main: number[]; extra: number[]; deckMaster?: number; pointCap?: number }; // at most 91 total IDs
// Request
{ format: "advanced" | "genesys", deck?: BridgeDeck,
  engines?: string[], // 1–4 names, each at most 120 characters
  genesysRemaining?: number } // integer 0–1000; preferred over host deck accounting, including zero
// Response, HTTP 200
{ engines: string[], detected?: DetectedEngine[], between: ShownBridge[],
  next: EngineSuggestion[], inReview: number }
type DetectedEngine = { name: string; weight: number; copies: number; distinct: number;
  status: "engine" | "light"; hybrids: number[]; includes?: string[] };
type EngineSuggestion = {
  engine: string; score: number; grade: "Strong" | "Good" | "Niche" | "Risky";
  tier: "strict" | "niche"; covered: number; of: number; twoWay: string[];
  links: { from: string; to: string; bridge: ShownBridge }[]; // 1–3 accepted display pairs
  cards: number[]; missing: number[]; genesysPoints: number | null;
  pros: string[]; cons: string[];
};
```

The shared detector uses bridge groups, including aliases and curated Odion membership. Hand traps and `formatStaples` are excluded. Main, Extra and Deck Master copies weigh 1, 0.5 and 2 respectively; hybrid weight is divided across memberships. Groups sharing at least 80% of their in-deck weight fold into a stronger group (`includes`). Engines require weight ≥ `max(3, 0.075 × Main size)` and two distinct Main cards. At most four engines survive; the others and groups weighing at least 1.5 are light. `copies` and `distinct` include all supplied zones, while engine eligibility counts distinct Main identities separately.

Fast suggestions contain at most four next engines and up to twelve directed rows between the chosen engines. Same-deck families and groups overlapping an existing engine by at least 50% are excluded. For each accepted pair, `v = score × gradeWeight × hubFactor`: grade weights are Strong 1, Good 0.8, strict Niche 0.6, Risky 0.3, and deep Niche 0.45. The primary line's hub factor is 0.25 for a hub, otherwise 1. Artifact import snapshots hub fan-out and target IDF from artifact rows alone; deep-search rows never alter these statistics. Primary access cards external to both groups become hubs at fifteen distinct directed pairs.

For engine Xi and candidate Z, `link_i = max(v(Xi→Z), 0.7 × v(Z→Xi)) + 0.3 × min(v(Xi→Z), v(Z→Xi))`. Sorted links receive weights 1, 0.8, 0.6, 0.5, then a multiplier `1 + 0.3 × (covered − 1)`. Only non-hub accepted links increase coverage. Target `idf = min(1, 0.05/share)`, where share is the fraction of graph sources with a stored directed row into Z. The final score must reach four. One target per `[format, accessCard, entryCard]` path survives across the complete set. Scores, coverage and two-way labels use the best accepted forward and reverse pair for every selected engine, independently of the display limit. Display selection keeps the best forward rows and best reverse row, at most three total. Pros and cons come from those accepted reviews.

`cards` is the evidence package; `missing` retains required copy multiplicity after subtracting the subscriber's deck. Genesys suggestions charge only missing copies across the combined package, counting shared cards once at the largest required multiplicity. Every artwork passcode is mapped to its main card before detection, points and missing-copy calculation.

For both fast engine requests and deep searches, a supplied `genesysRemaining` is the subscriber's remaining Genesys allowance and takes precedence over host deck accounting, including zero. The editor computes it using the deck's real cap and Side Deck; `deck` itself contains Main, Extra and optional Deck Master, with no Side field. Without an explicit allowance, the host subtracts those supplied cards' points from `deck.pointCap` (integer 0–1000, default 100), including the Deck Master. If any deck card has unknown points, the host skips that calculation, retains the copy context and uses the normal 100-point fallback; the engine search remains available. An explicit allowance skips deck accounting. Missing bridge cards still need known points to pass affordability checks. Without either deck context or an explicit allowance, Genesys affordability defaults to 100. These fields do not change Advanced affordability.

Fast engine detection and projection use two read-only scanners shared with Suggestions. Deep candidate scans and shortlists have a separate scanner, so fast requests and status polls cannot reject a running deep job through queue pressure. Equivalent fast requests share work, with at most eight distinct requests globally. Each user can retain one newest edit behind their running request; subsequent edits replace that queued input. The interactive scanner queue allows eight waiting calls. Fast calls have a 4.5-second budget including actor and scanner queue wait; completed-status scanner calls have the same budget including scanner queue wait. Overload or deadline expiry returns 503 with a one-second retry hint, and a timed-out active scanner is retired. A five-second, 64-entry fast cache includes guild, engine set, deck context, explicit `genesysRemaining` and persisted revisions of bridge evidence/reviews, catalog and saved-deck detection inputs. Duel writes do not invalidate it. Feedback and judgement writes, including through other connections, invalidate it immediately. This fast result cache is separate from the deck-independent shared deep-work cache.

Host construction does not load ranking data. With `EFFECT_SEARCH=0` and an older graph lacking `engine_ranking`, the duel host still starts; engine requests return 503 until a compatible artifact is imported. Replacing the graph with an older version also degrades engine requests without affecting duels.

Browser callers can import `fetchBridgeEngines`, `BridgeEnginesRequest`, `BridgeDeepSearchRequest`, `ShownBridge`, and `BridgeReviewStep` from `packages/web/src/lib/bridges-api.ts`. Server validation and signed-host helpers live in `bridges-server-api.ts`; web processes never construct the graph.

`POST /api/cards/bridges/deep-search` accepts one selector form: `source`, `deckId`, `engines` with optional `deck`, or `deck` alone. Unknown fields are rejected, bodies are bounded to 4096 bytes, and archetype names to 120 characters. Engine sets contain 1–4 names. When `engines` is supplied, it alone selects the shared work and cache key; an accompanying `deck` is subscriber context for existing copies, missing cards and Genesys points. Its detected engines never replace the supplied set, including in Pick mode. A deck-only request resolves to its detected engine set at admission; a deck with no detected engines returns 400 only when explicit engines are absent. The legacy single-selector forms remain supported. `target` is available only with `source`/`deckId`; those selectors cannot be combined with `engines` or `deck`.

```ts
// Request
{ source?: string, deckId?: number, engines?: string[], deck?: BridgeDeck, target?: string,
  format?: "advanced" | "genesys", genesysRemaining?: number, // integer 0–1000; preferred when supplied
  join?: boolean } // true: reuse existing work only; never admit or charge a search
// Editor request for Use my deck or Pick mode with a deck open:
{ format: "genesys", engines: ["Odion", "Ashtra"],
  deck: { main: [29762407, 97522863], extra: [], pointCap: 250 }, genesysRemaining: 37 }
// Response: HTTP 202 for queued/running; HTTP 200 for cached completed jobs
{ jobId: string, state: "queued" | "running" | "done" | "failed", cached: boolean }
```

For automatic deck/points refreshes, send **`join: true` as a top-level JSON field** in that POST body, alongside the selector, `deck`, `format` and `genesysRemaining`. The host subscribes to matching queued/running work or a completed job retained in the 24-hour work cache, and updates only that subscriber's deck/points context. This also reuses retained incomplete-review results after their normal ten-minute retry window, without retrying reviews. If there is no reusable work (including expired or version-invalidated work), it returns 404; a different search already running for that user returns 409. Join-only requests bypass hourly admission and the queue limit, never create a job, never call scan/review workers and never count toward the 15/hour limit, including subscriptions to running work and after host restarts. Omitting `join` or sending `false` retains normal admission. Non-boolean values return 400.

`BridgeDeepSearchRequest` in `packages/web/src/lib/bridges-api.ts` includes `join?: boolean`. The UI's actual POST builder is `startDeepSearch` in `packages/web/src/components/bridges/bridges-api.ts`: its UI worker must carry `join: true` into the top level of either payload branch for context refreshes. A normal user click should omit it or send `false`.

`GET /api/cards/bridges/deep-search/[jobId]` accepts no query parameters or body. Only a subscribed user in the same guild can poll it. Results remain empty until completion. Completed projections use a five-second, 64-entry cache keyed by job, subscriber deck/points context and the bridge-input revision. Evidence, review and feedback writes invalidate it immediately. Equivalent polls share work; a user can have one distinct projection in flight and at most four distinct projections run globally. Additional distinct polls receive 503 with a one-second retry hint. Multi jobs persist the complete candidate set as compact source/target/format/evidence-hash references. Status sends the job ID to a scanner, which loads those inputs and resolves unchanged evidence rows. Older full-row results are also parsed in the scanner, with a bounded parse cache. Large candidate sets never cross the host loop on status reads.

```ts
{ jobId: string, state: "queued" | "running" | "done" | "failed",
  step: "candidates" | "checking" | "rating" | "done",
  progress: number, // integer 0–100
  engines: string[], next: EngineSuggestion[], // at most six; empty while work is pending
  results: ShownBridge[], inReview: number, error?: string }
```

Jobs progress `queued → running → done|failed`. Queued jobs start at `candidates/0`; running steps are candidates, deterministic checking, then rating. Success ends at `done/100`; failures retain their last progress and a safe error. Interrupted jobs become failed on host restart. `inReview` includes pending and disputed candidates, never invalid ones.

For multiple engines, each source gets a complete forward scan and an incoming `deepInto` scan before cross-source ranking. Legacy single-source results are a top-25 deduplicated projection, so multi searches always rescan complete outgoing rows and reuse cached judgements. Candidate progress covers both directions for every source. Stored rows receive the current artifact version before ranking.

A multi job with attempted reviews still pending after provider failures uses ten-minute retry admission, even when other pairs were accepted. Only successful bounded work retains the full 24-hour cache. Invalid, disputed and player-hidden pairs are excluded before shortlist slots or shared access paths are assigned. An engine counts toward the six-engine stop only with a shown link or a new verdict saved by this job.

The deterministic shortlist contains at most eight engines. Reviews follow shortlist order and use the best forward display pairs plus the best reverse pair, at most three per engine. The job stops after six engines have reviewed pairs or twelve pairs have needed new reviews. Cached directed-pair evidence is free; a partially reviewed pair consumes one of the twelve when its missing review is requested. Two pair tasks run at a time through the existing global judge queue. Only the existing independent Haiku reviews run; no aggregate prose call is added. Internal engine-to-engine rows are published only if already accepted. Completed projection rechecks all gates and computes at most six next engines using all accepted candidate pairs; pending pairs never add coverage or two-way status. A completed multi job remains reusable for 24 hours even when its intentional review limit leaves part of the shortlist pending.

Single-engine selectors use the legacy source execution and cache tuple `[version, lowerCaseSource, targetOrNull, format]`, preserving `results` regardless of which selector first creates the shared job. Multi-engine keys hash `[version, "multi-v2", sortedLowerCaseEngines, format]`. The deck and points allowance never enter the shared work query or key: `bridge_deep_actor.deck_cards_json` and `genesys_remaining` retain subscriber context. Two players with the same engines share one job but receive their own missing cards and Genesys affordability. Reposting the same work with a changed deck or allowance updates that subscriber's context on an active or completed job without a new scan or review. Multi jobs keep `results: []`; legacy single-source callers retain their existing results and also receive the new `engines` and `next` fields.

Completed deep searches return at most **ten** shown rows: strict bridges first,
then rows with `tier: "niche"`. These deep-only rows display **Niche** in both
the list and details even if the reviewers assign a higher usefulness grade.
The existing `grade: "Niche"` can still occur on strict candidates; only the
new `tier` field identifies deep-only eligibility. Both independent Haiku 5.5
reviews, format checks, current evidence and feedback gates apply to every row.
No pending or disputed row fills an empty slot. Within the Niche tier, two-way
access ranks before one-way access, then score and target name break ties.

A Niche candidate requires a physical access path over checked capability
edges: a source card searches/adds, Summons, Sets, places or sends a genuine
target-engine card, or a complete supported material procedure or specific
cost leads to a card with that action. A wide stat filter or generic discard
alone does not establish entry. Generic one-card toolbox searchers fetching
any Trap do not qualify. Material procedures and costs retain their card IDs
and the same-effect cost identity in the evidence sent to both judges.
Scores below four and generic Link-1 procedures are allowed only in this tier.
Strict score normalization is computed before any deep-only evidence.

For example, The Man with the Mark can make Spirit with Eyes of Blue, which
Tributes itself to Summon a Blue-Eyes from hand or GY. Spirit's Dragon lock
ends when it leaves as that cost. Altergeist Marionetter's specific Deck Set
of Altergeist Emulatelf plus Temple's same-turn activation permission is also
accepted as an access path, at score 3.99. Temple permission alone is
insufficient: Paleozoic Traps merely played alongside Odion do not qualify.
Name-label groups, same-deck families, negated entry chains and unsupported
material/placement setups remain excluded.

Admission permits one queued/running search per application user across guilds. Another identical POST returns that job ID; a different active query returns 409. There is no completion or failure cooldown; at most 15 new jobs are admitted per user per rolling hour, and a multi-engine job counts as one search. Two jobs run globally in the host, with a queue bounded to 100 waiting jobs. Completion writes retry without blocking on SQLite locks for at most five seconds. If persistence still fails, status reports a terminal in-memory failure and releases the global and user slots; startup recovery persists interrupted jobs after a restart. Identical query keys share pending work and completed results for 24 hours, without new review calls; artifact/prompt versions invalidate that reuse. Each subscriber retains its own points and deck context. Cached completed queries bypass new-work admission. The hourly limit returns HTTP 429, `Retry-After: <seconds>`, and JSON `{error:string,retryAfter:number}`. Invalid requests return 400, missing subscriptions/decks 404, missing guild membership 403, and unavailable bridge data or a full queue 503. The UI shows a countdown only for the hourly-limit 429 with `retryAfter`; completion and failure enable the button immediately.

`POST /api/cards/bridges/feedback` accepts `{evidenceHash:string,reason?:string}` (64 lowercase hex characters, optional reason up to 512 characters) and returns `{accepted:true,hidden:boolean}`. Reports are idempotent per application user and evidence hash. Two distinct unresolved reports hide that evidence immediately, including cached results.

`GET /api/admin/console/bridges` requires current owner access and returns the existing console section envelope:

```ts
{ state: "ok", updatedAt: number, data: {
  feedback: [{ evidenceHash: string, source: string, target: string,
    format: "advanced" | "genesys", users: number, reasons: string[],
    createdAt: string, hidden: boolean }], inReview: number
} }
```

The read-only list appears under `/admin#insights`, with up to 200 evidence groups and 200 recent reason samples per group. A shared evidence hash uses a representative directed pair. No review-resolution write endpoint is exposed.

## Reviews and spend

Reviews use the official SDK, `claude-haiku-5-5`, adaptive defaults, cached fixed system prompts, and `output_config.format` JSON schema. The mechanic and skeptic receive only checked summaries, supplied card texts/stat fields, reasons and locks. Invented line cards invalidate a verdict in code. Disagreements, uncertainty, or a grade gap over one step remain hidden for review.

SQLite caches by evidence hash and a versioned judge identity containing the checked input hash; this separates directed pairs sharing engine evidence. Runtime threads write directly to the durable host database. Ambiguous submissions retain a spend reservation and cannot be retried automatically. Startup imports the committed `bridge-judgements.jsonl.gz` independently of graph import and keeps newer runtime records. The initial committed cache is empty: no paid run was authorized locally. See [the batch runbook](../runbooks/bridge-judging.md) for dry runs, weekly collection, spend and recovery.

## TypeScript API

Import types and extraction functions from `@yugidraft/shared/cards/effects`; import `createBridgeService` from `@yugidraft/shared/services`.

```ts
type BridgeFormat = "advanced" | "genesys";
type LockScope = "while_face_up" | "rest_of_turn_after_activation" | "whole_turn_cost" | "none";
type BridgeGrade = "Strong" | "Good" | "Niche" | "Risky";

extractCardCapabilities(card: Card, tags?: CardTags, profile?: ArchetypeProfile): CardCapability;
indexBridgeCapabilities(rows: CardCapability[]): void;
bridgeGroups(capabilities: readonly CardCapability[], profiles: ReadonlyMap<string, ArchetypeProfile>): Record<string, number[]>;
detectDeckEngines(deck: BridgeDeck, groups: Record<string, number[]>, skip?: ReadonlySet<number>): DetectedEngine[];
rankNextEngines(engines: readonly string[], rows: readonly ShownBridge[], context: EngineRankingContext, limit?: number): RankedEngine[];
bridgeLegal(card: Card, format: BridgeFormat): boolean;
readBridgeManifest(directory?: string): BridgeManifest;
importBridgeArtifact(db: Database.Database, directory?: string): {
  version: string; bridges: number; capabilities: number; skipped: boolean;
};

createBridgeService(db: Database.Database): BridgeService;
// Methods of BridgeService:
detectEngines(deck: BridgeDeck, format?: BridgeFormat, guildId?: string): DetectedEngine[];
engineRows(engines: readonly string[], format: BridgeFormat): ArchetypeBridge[];
rankingContext(): EngineRankingContext;
deepInto(target: string, format?: BridgeFormat, progress?: (value: BridgeProgress) => void): ArchetypeBridge[];
bridgesFrom(archetype: string, format?: BridgeFormat, limit?: number): ArchetypeBridge[];
bridgeBetween(x: string, y: string, format?: BridgeFormat): ArchetypeBridge | null;
explain(x: string, y: string, format?: BridgeFormat): ArchetypeBridge | null;
liveCandidates(source: string, format?: BridgeFormat, progress?: (value: BridgeProgress) => void): ArchetypeBridge[];
shownFrom(archetype: string, format?: BridgeFormat, limit?: number): ShownBridge[];
shownBetween(x: string, y: string, format?: BridgeFormat): ShownBridge | null;
capabilities(key: CapabilityKey, direction: "needs" | "provides"): CardCapability[];
```

`bridgesFrom` defaults to Advanced and four candidates, with a maximum of 25. `bridgeBetween` reads retained rows. `explain` also computes niche pairs outside the retained 25. `liveCandidates` searches all groups, reusing offline reach and material indexes. These administrative methods expose deterministic candidates. Player consumers use `shownFrom`/`shownBetween` or the HTTP routes, which enforce the review/feedback gates.

Shared searchers, Small World and generic hand-only support can strengthen a proved connection but cannot establish a bridge by themselves. Extra Deck effects require a complete supported material procedure and a named effect into the target engine. An ordinary shared Type through a broad alternative-Type material slot does not establish a new connection. The first reason is the primary proved line; optional searcher paths do not impose locks on it. Continuous locks are checked before material use, and self-removal only clears a continuous effect lock when it belongs to the same activation.

The offline `BridgeEngine` class takes `BridgeGraphData` and exposes:

```ts
reasons(source: string, target: string, format: BridgeFormat): BridgeReason[];
validateReason(reason: BridgeReason, format: BridgeFormat): boolean;
between(source: string, target: string, format?: BridgeFormat): ArchetypeBridge | null;
liveCandidates(source: string, format?: BridgeFormat, progress?: (value: BridgeProgress) => void): ArchetypeBridge[];
rebuild(progress?: (value: BridgeProgress) => void): ArchetypeBridge[];
```

Only administrative tools and the existing duel-host suggestion workers should construct this service. Web code must call the host; it must not load this graph.

## Worker admission and progress

```ts
type BridgeScan = { kind: "bridges"; source: string; format: BridgeFormat } & (
  { op: "from"; limit?: number } | { op: "live" | "outgoing" | "into" } |
  { op: "between" | "explain"; target: string }
);
type BridgeScanResult = ArchetypeBridge[] | ArchetypeBridge | null;

// Managed jobs acquire persistent admission before calling these queued workers:
DeckSuggestionWorkers.bridgeCandidates(scan: BridgeScan, progress?: (value: BridgeProgress) => void): Promise<BridgeScanResult>;
DeckSuggestionWorkers.rateBridge(bridge: ArchetypeBridge): Promise<void>;
```

`BridgeSearchJobs` provides persistent admission before invoking the queued worker methods. Scanner candidates still require the review gate before publication.

Scanner progress is `{phase: "index" | "score" | "validate" | "done", completed: number, total: number}`. Managed single-source jobs map it to the HTTP steps, then judge up to ten currently unjudged candidates from the top 25, with two candidate tasks at a time. Multi-source jobs use the twelve-pair/six-engine stop rules above. `outgoing` returns the complete candidate set before target deduplication; `into` interprets the scan's `source` field as the destination engine. Candidate extraction uses read-only worker connections. Reviews run on the host with at most two requests in flight. Candidate scans use at most one scanner, leaving the second scanner available for Suggestions.

## Files and schemas

All files live in `packages/shared/data/effects/`. The independent `bridges-manifest.json` has its own integrity pin in `bridge-artifact.ts`; updating bridges does not change the primary effect-tag pin.

| Artifact | Record |
| --- | --- |
| `card-capabilities.jsonl.gz` | `{id,card: Card,provides: Capability[],needs: Capability[],locks: SummonLock[],text_hash,evidence_hash}` |
| `bridges-advanced.jsonl.gz`, `bridges-genesys.jsonl.gz` | `ArchetypeBridge`, up to 25 per source |
| `bridges-manifest.json` | `{schema_version:1,algorithm_version,inputs:{tags,profiles,engine,metadata,genesys_revision,groups},files:{capabilities,advanced,genesys},groups,target_means,reason_frequencies,group_policies,materials,version}` |
| `bridge-groups.json` | Group curation, aliases, exclusions and membership selectors (hashed in the manifest inputs) |
| `bridges-golden.json` | `{pairs:[{source,target,format,expected:"bridge"|"not_bridge",tier?:"deep",min_grade?,cards?,why,source_url}]}` |
| `bridge-judgements.jsonl.gz` | `{evidence_hash,input_hash,judge,framing,model,result,created_at}`; current reviews plus inert historical identities |

Each file descriptor is `{path,records,bytes,sha256,gzipBytes,gzipSha256}`. `version` hashes the manifest identity without itself. `groups` maps exact primary archetypes with profiles to IDs, folding duplicate case variants; Odion additionally groups exact Temple references and Apophis names. `materials` stores complete supported material lines by format and source. Unsupported material procedures fail closed.

`Capability` is `{key,value?,filter?:CardFilter,from?:string[],effect?:number,evidence,targets?:number[]}`. The closed 33-key vocabulary is `CAPABILITY_KEYS`. Targets are precomputed over the identity universe and filtered for format legality at runtime. `SummonLock` is `{scope,allow:CardFilter,extra_deck_only,self_removal,unresolved,evidence}`.

`ArchetypeBridge` is `{source,target,format,tier?:"niche",score,raw_score,target_mean,two_way,grade,reasons,cards,warnings,genesys_points,validation,judge,engine_status,evidence_hash}`. Each reason has `{key,weight,cards,evidence,description,steps?,materials?,cost?}`. Steps are `{from,to,capability}`; `cost` is `{card,using,capability,effect}`. `materials` retains repeated passcodes when multiple copies are required. Evidence hashes incorporate contributing IDs, reason keys, material lines and card text/capability hashes, including evidence that contributed to aggregate scoring. Deep-only hashes also bind the tier and cost identities.

Golden labels with `tier: "deep"` are evaluated against the deep top ten and
excluded from strict recall/precision denominators. The evaluator reports
strict `recall_at_4` and `recall_at_10` separately from `deep_recall_at_10` for
these deep-only positives. `--check` requires all deep positives to be found
at their minimum grade; `--strict-precision` retains full strict judgement
coverage. Golden evaluation measures deterministic candidates, independently
of the live judge cache.

Genesys excludes Link/Pendulum cards and lines with mandatory Link/Pendulum dependencies. It uses the existing verified Genesys snapshot reader, including known zeroes, and ignores the competitive Forbidden/Limited list. `genesys_points` counts one copy of each displayed evidence card plus required material multiplicity. It describes that evidence package; it is not a claim that an existing deck has sufficient remaining points. The caller must use the existing deck admission checker for the selected deck cap and copies.

| SQLite table | Columns / keys |
| --- | --- |
| `card_capability` | `passcode` PK, `capabilities_json`, `text_hash`, `evidence_hash`, `source_version` |
| `archetype_bridge` | PK `(source,target,format)`, `score`, `grade`, `bridge_json`, `evidence_hash`, `source_version`; lookup indexes `(source,format,score DESC)` and `(target,format,score DESC)` |
| `bridge_graph` | `id=1` PK, `graph_json`, `source_version` |
| `bridge_artifact_import` | `version` PK, `imported_at` |
| `bridge_judgement` | PK `(evidence_hash,judge)`, `verdict` (`approved/rejected/review`), `judgement_json`, `created_at` |
| `bridge_feedback` | `id` PK, `evidence_hash`, `actor_hash`, `reason`, `created_at`, `resolved_at`; unique `(evidence_hash,actor_hash)` |
| `bridge_search_admission` | `actor_hash` PK, `admitted_at` epoch milliseconds |
| `bridge_judge_spend` | Durable request keys, submission state, reserved/actual microdollars, usage and UTC billing month |
| `bridge_deep_job` | Job/query identity, state, step, progress, candidate JSON, safe error and completion time |
| `bridge_deep_actor` | Job/user/guild subscription, admission/completion times, private points/deck context and `counts_toward_limit` (zero for join-only subscriptions) |

Graph imports validate pinned compressed and decompressed bytes before one transaction; changed artifacts replace graph rows while preserving judgement/feedback history. Review imports revalidate current checked input and skip stale identities. Duel-host effect startup imports graph and reviews behind the existing effect-search flag.

## Rebuild, CLI and evaluation

Use Node 22. All engine reads use the same `loadCardDatabase` / `engineInsightCard` path as effect indexing. No application catalog race field is used. The public metadata snapshot supplies primary archetype labels, TCG availability and verified Genesys points; card identity, exact engine setcode memberships and printed text come from the read-only engine bundle. A candidate must include a named target-engine member (or a member of a curated unnamed engine). Generic face-down access cannot establish a bridge alone. Single-material generic Link-1 lines cannot establish a strict bridge alone; a checked physical access path through one can establish a deep-only Niche bridge. Each target/reason weight scales down above 5% source frequency, using the same persisted frequencies for live and offline searches. Thematic group labels never establish an effect's rules membership: Sage with Eyes of Blue is grouped with Blue-Eyes support but cannot be summoned by an effect requiring a Blue-Eyes monster.

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
DUEL_DATA_DIR=/path/to/read-only/engine prlimit --core=0 -- npx tsx scripts/effects/rebuild-bridges.ts
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx tsx scripts/effects/evaluate-bridges.ts --check --strict-precision
prlimit --core=0 -- npx tsx scripts/effects/benchmark-bridges.ts
prlimit --core=0 -- npx tsx scripts/effects/benchmark-bridges.ts --multi

npx tsx scripts/effects/bridges.ts from Odion
npx tsx scripts/effects/bridges.ts from Odion --to Blue-Eyes
npx tsx scripts/effects/bridges.ts from Odion --format genesys --limit 4
npx tsx scripts/effects/bridges.ts needs face_down_card
npx tsx scripts/effects/bridges.ts provides activate_trap_turn_set
npx tsx scripts/effects/bridges.ts path Odion Blue-Eyes --hops 3
npx tsx scripts/effects/bridges.ts explain Odion Blue-Eyes
```

Rebuild options: `--engine-directory`, `--directory` (tag/profile inputs), `--output`, `--metadata` (saved unpaginated public API snapshot), `--pin`. Rebuild shared after updating the integrity pin before running tools that import the compiled package. The CLI defaults to a disposable in-memory import; `--database PATH` opens an already-imported application database read-only. Path edges are validated individually; the CLI explicitly marks combined resource/lock compatibility as unverified.

Both effect tagging and engine-data update workflows rebuild/evaluate/stage bridges. Publication validators permit only four bridge data files and the single literal integrity-pin replacement. CI runs the golden evaluator and targeted integrations.

The golden set covers every top-five candidate for ten core sources in each format, plus regression pairs. `precision_at_5` counts only labelled positives in the numerator and all retrieved core-source rows in the denominator; unlabelled rows count against precision. Judged precision, coverage and the precision interval remain available for diagnosis. `--check` requires precision ≥0.9, coverage ≥0.8, recall ≥0.6 and no known negative pair returned even by live explanation. Missing engine labels fail evaluation; explicit excluded-label regressions instead assert that those labels stay absent. Negative evidence regressions reject the specified evidence cards without rejecting other valid lines for the pair. `--strict-precision` requires complete top-five coverage. Grades and matching annotated evidence cards are reported per pair for review.

Missing engine identities are excluded; the rebuild report lists unavailable profiled groups and their missing cards. The current prepared bundle includes the Ashtra identities, including Yoa the Plague Deity Ashtra and Ashtra Divine Domain. Golden evidence uses those printed identities; no bridge is invented for a missing card.
