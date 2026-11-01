# Directed archetype bridges

Deterministic candidates feed two independent, cached reviews. Player routes return a bridge only when both reviewers accept its checked evidence, agree within one grade, and pass format and feedback checks. Player results say `validation: "deterministic"`, `judge: "accepted"`, and `engine_status: "unverified"`. Candidate CLI methods retain `judge: "pending"`. The player Suggestions row and progress-bar component remain for the UI stage; their server contract is implemented below.

Engine labels use official archetype or key-card names. `Temple of the Kings` is the display name of the stable internal `Odion` identity. Both spellings are accepted as request selectors, including saved chip edits; response labels and the archetype-name list use `Temple of the Kings`. Display translation occurs after review validation and does not change evidence hashes, judge inputs or stored cache identities. Artifact group policies carry `display_name` separately from their stable keys.

## Feature flag

Bridges are off by default in every environment. Set `BRIDGES_ENABLED=1` in both the web and duel server environments to turn them on; Compose passes it to both services with a default of `0`. Any other value, or none, keeps them off. The web reads it at request time: the app layout (`app/(app)/layout.tsx`) hands the answer to the page through `EffectSearchProvider`, so the browser never reads an environment variable. The duel server reads it at startup: when off, it skips bridge artifact and judgement imports and does not construct the bridge API or initialize bridge jobs. An authenticated `op: "bridges"` request returns the existing retryable 503 when Suggestions are enabled. Synergy search and Suggestions use effect tags and profiles independently of bridge tables and artifacts. Bridges also need `EFFECT_SEARCH=1` and `DECK_SUGGESTIONS=1`, like the Suggest tab.

For host-run systemd services, add `Environment=BRIDGES_ENABLED=1` to both the web and duel service drop-ins (or their shared `EnvironmentFile`), then reload systemd and restart both services. Use `0` to disable bridges. For Docker, set the value in the Compose `.env` and recreate both containers; a container restart does not reload environment values. Ordinary effect-tag imports and the effect search index still run when `EFFECT_SEARCH=1`.

While it is off:

- The deck editor has no Bridges tab, the Cards search makes no "See bridges for A + B" offer (the normal synergy results stay), and the browser makes no request to a bridges route.
- Every `POST /api/cards/bridges/*` route, `GET /api/cards/bridges/archetypes` and `GET /api/cards/bridges/deep-search/[jobId]` answers 404 `{"error":"Not found"}` before any session or host work. `GET /api/admin/console/bridges` (owner only) is not part of the flag.
- The duel host keeps the `bridges` operation loaded, but it only creates its tables and fails jobs that a restart interrupted. A deep search worker or a review call starts only when a request reaches it, and none does.

## HTTP interfaces

All player routes require an authenticated application user with a player in the configured guild. The web server derives identity from the session and proxies to the HMAC-signed `POST /internal/duel` operation `bridges`. The host rechecks the user/player/guild mapping on every request, including cache hits and polling. Responses use `Cache-Control: private, no-store`. Client guild/user/player fields are rejected.

`POST /api/cards/bridges` reads at most four shown stored rows (`from`/`between` on the host), using an explicit `source` and optional `target`. A target requests both directed lookups; `reverse` is present for that lookup. Optional `format` is `advanced|genesys` (default Advanced), and `genesysRemaining` is an integer 0–1000. `deckId` is rejected: callers send the current open deck rather than inferring a source from a saved deck.

Requests are JSON with a 4096-byte body limit and no query parameters. Unknown fields are rejected. Optional `deck` supplies subscriber context: Main and Extra arrays, optional Side, Deck Master, point cap, mode and singleton controls, at most 91 total positive uint32 IDs, and an integer cap from 0–1000. A deck alone is not a list selector. `source` and optional `target` remain authoritative; deck detection never changes them. This operation performs no deep scan or paid review.

```ts
// Import from packages/web/src/lib/bridges-api.ts (browser-safe).
type BridgeListRequest = {
  source: string;
  deck?: BridgeDeck;
  target?: string;
  format?: BridgeFormat; // "advanced" | "genesys", defaults to Advanced
  genesysRemaining?: number; // integer 0–1000, including zero
};
type BridgeListResponse = { results: ShownBridge[]; reverse?: ShownBridge[]; inReview: number };
export async function fetchBridges(query: BridgeListRequest, signal?: AbortSignal): Promise<BridgeListResponse>;

// One selected engine, with the editor's current copies and Side-aware allowance:
await fetchBridges({ source: "Temple of the Kings", format: "genesys",
  deck: { main: [29762407, 97522863], extra: [1710647], pointCap: 250 },
  genesysRemaining: 37 }, signal);
```

The canonical helper sends POST JSON and throws `BridgeRequestError` with `status` and optional `retryAfter` seconds; cancellation uses the supplied signal. The list route is POST-only; `GET /api/cards/bridges` returns 405. Browser callers import `@/lib/bridges-api`; the old component-folder client has been removed. Both web and host validators reject saved-deck selectors and deep `source + target` selectors; deep pairs use `engines`. List evidence is cached only by source, target and format with the bridge revision; deck copies and allowance are applied separately to every response and never enter that shared cache key. Context cannot leak between callers or change cached evidence.

Suggestions and free two-archetype lookups use the existing strict candidates,
score floor and top-four selection. Deep-only rows never enter these results,
including after a deep job saves them in the shared candidate table.

```ts
// POST list response, HTTP 200
{ results: ShownBridge[], reverse?: ShownBridge[], inReview: number }
// Every ShownBridge includes all ArchetypeBridge fields and:
{ judge: "accepted", missing: number[], alreadyInDeck: boolean, core: EngineCore, review: {
  grade: "strong" | "good" | "niche" | "risky",
  pros: string[], cons: string[], // zero to three of each
  lock_note: string, line: string[], // one to three exact supplied card names in order
  steps: { card: string; text: string }[], // exactly one entry per line name, in the same order
  alternative_paths?: { line: string[]; steps: { card: string; text: string }[] }[] // at most three
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

`review.alternative_paths` contains up to three other grounded paths already supplied
in the same pair review. Each path has one to three exact evidence-card names in
`line`, and matching ordered `steps` with the same name and caption bounds as
`review.steps`. These are alternatives considered by the pair judges, not separate
per-path verdicts or a mandatory combined combo. Older responses may omit the
field; current host projections return an array, possibly empty. No component
rendering or controls are added in this build. The field is derived after review,
outside judge input/hashes and all shared or subscriber-specific query keys.

The generator retains up to four distinct grounded reasons per directed pair.
Practical Deck access, then other checked access and activation permissions precede
material or cost setups and naming overlap. Different physical outlets get slots
before redundant paths from one outlet; additional recipients can then fill spare
slots. Both existing Haiku framings see these alternatives together. The limit
remains twelve new directed-pair reviews; alternatives add no provider requests.
Unchanged checked inputs reuse their cached verdicts. A still-valid accepted stored
line is retained when a fresh scan finds more alternatives for the same pair;
only that previously reviewed evidence is projected, and new alternatives are not
claimed as reviewed. Current text, access, judge identities and feedback are all
rechecked before reuse. The managed search version
changes so completed searches rescan with the new generator on the next start.

For an open deck, list reads use the same points accounting as engines, described below. A supplied `genesysRemaining` takes precedence, including zero; otherwise the host derives remaining points from the supplied cap and copies, including Side. Only additional required copies consume that allowance. Source queries without deck context compare the complete evidence package against `genesysRemaining`, defaulting to 100. Card legality and the two review gates apply in either case.

`POST /api/cards/bridges/engines` is a SQLite-only fast operation (`engines` on the host). It reads stored candidates without a deep scan or a paid review. Unknown fields are rejected, the body is bounded to 4096 bytes, and each supplied passcode is a positive uint32. At least one of `deck` and `engines` is required; supplying both detects the deck but uses the corrected engines. Names are canonicalized, deduplicated and sorted. An empty detection is a successful empty result. Chip corrections affect Bridges only.

```ts
type BridgeDeck = { // at most 91 total IDs, including Side and Deck Master
  main: number[]; extra: number[]; side?: number[]; deckMaster?: number; pointCap?: number;
  mode?: "normal" | "domain"; singleton?: boolean;
};
// Request
{ format: "advanced" | "genesys", deck?: BridgeDeck,
  engines?: string[], // 1–4 names, each at most 120 characters
  genesysRemaining?: number } // integer 0–1000; preferred over host deck accounting, including zero
// Response, HTTP 200
{ engines: string[], detected?: DetectedEngine[], between: ShownBridge[],
  next: EngineSuggestion[], inReview: number }
// Response, HTTP 202 while a read is still loading (Retry-After: 1–10 seconds)
type BridgeLoadingResponse = { state: "loading"; retryAfter: number };
type DetectedEngine = { name: string; weight: number; copies: number; distinct: number;
  status: "engine" | "light"; hybrids: number[]; includes?: string[] };
type EngineSuggestion = {
  engine: string; score: number; grade: "Strong" | "Good" | "Niche" | "Risky";
  kind?: "synergy"; // ordinary access bridges omit this field
  tier: "strict" | "niche"; covered: number; of: number; twoWay: string[];
  links: { from: string; to: string; bridge: ShownBridge }[]; // 1–3 accepted display pairs
  cards: number[]; missing: number[]; alreadyInDeck: boolean; genesysPoints: number | null;
  pros: string[]; cons: string[]; core: EngineCore;
};
```

The UI distinguishes a resource synergy using **`next[i].kind === "synergy"`**.
Its accepted `links[].bridge` rows also carry `kind: "synergy"`. The
directed `results` and `between` lists contain access bridges; resource suggestions
use `next`. Ordinary bridges omit `kind` for historical
compatibility; `"bridge"` is not a valid explicit value. Unknown values are rejected
by the host evidence gate and web response validators.

Synergy rows have `tier: "niche"`, `two_way: false` and the displayed Niche grade.
Synergy suggestions have `covered: 0`, `twoWay: []` and only synergy links;
`of` still records the number of selected engines. They never add access coverage,
two-way status or `between` rows, and cannot enter the free strict lists or their
`reverse` results. Accepted stored synergies can appear in `next` without further
review calls. At most two synergy suggestions or deep result rows are shown, within
the existing response limits. An ordinary suggestion cannot include synergy links.

## Engine cores and UI add semantics

The host projects a deterministic `core` on every shown bridge and next-engine suggestion. A bridge row's core belongs to its directed `target`; `next[].core` belongs to `next[].engine`, including an incoming link whose target is a selected engine. Existing `cards`, `missing`, `alreadyInDeck`, `genesys_points` and `genesysPoints` retain their evidence-package meanings and can include optional evidence beyond the accepted line. The accepted **Bridge cards** are the ordered names in `review.line` and aligned `review.steps`, plus their mandatory checked costs/materials. An accepted bridge does not imply that Haiku reviewed its core.

```ts
type CoreCard = {
  code: number; name: string;
  section: "main" | "extra";
  role: "starter" | "searcher" | "extender" | "payoff" | "support" | "material";
  copies: number; // proposed required quantity, adapted to format and singleton rules
  held: number; // actual canonical Main + Extra copies; can exceed copies
  needed: number; // Math.max(0, copies - held)
  points?: number; // Genesys points for ONE copy, including verified zeroes
};
type EngineCore = {
  cards: CoreCard[];
  ready: boolean;
  gaps: string[];
  caption: string; // short, deterministic explanation of the selected plan
};
```

`ready` means the selected coherent plan has grounded access, extension/resource and payoff roles, resolved dependencies, legal quantities, sufficient remaining Genesys allowance, and room for the needed copies in their Main/Extra sections. Missing ownership alone does not make a core unready. A blocked plan has `ready: false` and concrete `gaps`; the UI should display them and avoid silently truncating quantities. A complete owned core has every `needed` equal to zero; this is a separate state from `alreadyInDeck`, which describes the bridge evidence package.

Core derivation starts from canonical engine members and checked external support. It uses printed search/Summon/Set/placement/send actions and dependency closure, covering starters/searchers, extenders/resources and payoffs in one plan. Required targets, materials and relevant Extra Deck cards cannot be dropped to meet the normal package-size target. Reviewed narrow rules cover qualified membership and procedures; unsupported dependencies remain gaps. Groups without a checked complete procedure expose a provisional graph role proposal with `ready: false`; membership or centrality alone never proves readiness. Advanced excludes Forbidden cards and clamps Limited/Semi-Limited quantities. Genesys excludes Link/Pendulum dependencies and uses a Link-free Blue-Eyes Synchro plan. Domain mode implies singleton; explicit singleton also adapts copies to one. Held counts use canonical Main and Extra identities only. Side and Deck Master continue to consume Genesys points but never satisfy core ownership. Side copies also count against the overall copy limit, so a full Main proposal plus Side copies can block readiness. A Domain core cannot include its Deck Master identity. Incremental core spend is `sum(card.needed * card.points)`; callers must retain unknown-point gaps.

The six reviewed starting plans are Argostars (Adra, Giantslaying, Tydeu, Eteo, Capane, Stadium, Parthe; Arion), Ashtra (Yoa, Mikumari, Divine Domain, Insect Poison, Akasuna, Gateway; Mikumari-no-Mikoto, Susanoo), Tearlaments (Reinoheart, Scheiren, Havnis, Merrli, Kashtira, Scream, Sulliek, Cryme; Kaleido-Heart), Azamina (Deception, Hallowed, Debtors, Determination; Mu Rcielago, Sol Erysichthon, Moa Regina), Regenesis (Regenesis, Archfiend, Sage, Warrior, Dragon, Lord, Birth), and Blue-Eyes (Sage, Wishes, Maiden of White, Roar, White Dragon, True Light; Spirit with Eyes of Blue, Spirit Dragon, Ultimate Spirit Dragon). These are deterministic starting packages, with quantities and gaps projected for the current editor context. Forbidden Kitkallos and its unsupported ordinary Rulkallos dependency are excluded from the Advanced Tearlaments plan; Forbidden Ilia Silvia is excluded from the Advanced Azamina plan. The fresh 100-point Genesys allowance blocks the 300-point Tearlaments package. Blue-Eyes omits Spirit with Eyes of Blue in Genesys.

Show **Bridge cards** from the chosen accepted path separately from **Engine core**. Resolve its exact `review.line`/`review.steps[].card` names through the catalog and retain mandatory checked costs/materials from `reasons`; do not use the full evidence `cards` array as a substitute for that chosen path. **Add bridge (N)** adds missing copies of that path and its mandatory costs/materials. **Add engine (N)** takes the maximum multiplicity per canonical identity across the chosen path and `core.cards[].copies`, subtracts held Main+Extra copies, and routes additions using `section`/card metadata. Summing the two missing counts would double-count shared requirements. Keep one editor undo step and show the exact blocked copies/points. This round supplies backend types and data; component changes are separate.

Host construction and the web validator both use `EngineCoreSchema`; malformed copy accounting and inconsistent readiness are rejected. Type fields remain optional for older fixture/rollout responses, but current host responses always include the core. Derivation, captions and subscriber projections require no new model calls and never enter judge inputs, evidence hashes or shared work-cache keys. Only graph/catalog/format data belongs to reusable core derivation; held/needed copies, mode, singleton, section space and remaining allowance are subscriber context. Projection caches include that private context.

## Engine detection and ranking

The shared detector uses bridge groups, including aliases and curated Temple of the Kings membership. Hand traps and `formatStaples` are excluded. Main, Extra and Deck Master copies weigh 1, 0.5 and 2 respectively; hybrid weight is divided across memberships. Groups sharing at least 80% of their in-deck weight fold into a stronger group (`includes`). Engines require weight ≥ `max(3, 0.075 × Main size)` and two distinct Main cards. At most four engines survive; the others and groups weighing at least 1.5 are light. `copies` and `distinct` include all supplied zones, while engine eligibility counts distinct Main identities separately.

Fast suggestions contain at most four next engines and up to twelve directed rows between the chosen engines. Same-deck families and groups overlapping an existing engine by at least 50% are excluded. For each accepted pair, `v = score × gradeWeight × hubFactor`: grade weights are Strong 1, Good 0.8, strict Niche 0.6, Risky 0.3, and deep Niche 0.45. The primary line's hub factor is 0.25 for a hub, otherwise 1. Artifact import snapshots hub fan-out and target IDF from artifact rows alone; deep-search rows never alter these statistics. Primary access cards external to both groups become hubs at fifteen distinct directed pairs.

For engine Xi and candidate Z, `link_i = max(v(Xi→Z), 0.7 × v(Z→Xi)) + 0.3 × min(v(Xi→Z), v(Z→Xi))`. Sorted links receive weights 1, 0.8, 0.6, 0.5, then a multiplier `1 + 0.3 × (covered − 1)`. Only non-hub accepted access links increase coverage. Target `idf = min(1, 0.05/share)`, where share is the fraction of graph sources with a stored directed row into Z. Strict candidates must reach four. A bounded Niche lane admits complete non-hub physical paths accepted by both reviewers; score orders these paths without vetoing them, including a score rounded to zero. Up to two of eight shortlist slots belong to that lane, with resource synergies capped separately at one of the eight slots. One target per `[format, accessCard, entryCard]` path survives across the complete set. Access scores, coverage and two-way labels use the best accepted forward and reverse pair for every selected engine, independently of the display limit; synergy rows cannot affect those values. Display selection keeps the best forward rows and best reverse row, at most three total. Pros and cons come from those accepted reviews.

`cards` is the evidence package; `missing` retains required copy multiplicity after subtracting copies in **Main and Extra only**. Side and Deck Master copies do not satisfy a package. Every shown bridge (including `between`, `reverse`, engine links and completed deep results) and engine suggestion includes `alreadyInDeck`. It is true exactly when a nonempty package has no missing cards. A complete engine package remains an informational row for an **Already in deck** label, rather than an actionable next-engine recommendation; actionable packages sort first. If any package card is still missing, `alreadyInDeck` is false and `missing` lists all additional required copies. An engine suggestion checks the combined package of its displayed links; each link checks its own package. Source-only requests without deck context count the whole package as missing. Saved `deckId` lookups provide Main+Extra context in Advanced as well as Genesys.

The shared `BridgePackageSchema` validates host projections and web responses: card IDs are positive uint32s, `cards` contains unique IDs, missing IDs belong to the package, and the flag agrees with the missing list. Combined Genesys affordability and ownership preference apply before path/group deduplication and candidate limits, so ineligible or complete packages cannot crowd out actionable ones. Genesys suggestions charge only missing copies across the combined package, counting shared cards once at the largest required multiplicity. Every artwork passcode is mapped to its main card before detection, points and missing-copy calculation. Side and Deck Master still count toward saved and open deck Genesys spending; Deck Master also counts toward detection.

Deep-work keys include the `main-extra-packages-v1` context namespace. Older subscriber copy arrays did not retain zones and cannot safely be reinterpreted; their status IDs return 404 and are not reused. New explicit start requests supply current context. Existing evidence and independent-review caches remain reusable.

For POST list reads, fast engine requests and deep searches, a supplied `genesysRemaining` is the subscriber's remaining Genesys allowance and takes precedence over host deck accounting, including zero. The editor computes it using the deck's real cap and Side Deck; it can also supply `deck.side` for host accounting. Without an explicit allowance, the host subtracts those supplied cards' points from `deck.pointCap` (integer 0–1000, default 100), including Side and Deck Master. If any deck card has unknown points, the host skips that calculation, retains the copy context and uses the normal 100-point fallback; the bridge search remains available, while the core has an unknown-allowance gap and cannot claim readiness. An explicit allowance skips deck accounting. Missing bridge cards still need known points to pass affordability checks. Without either deck context or an explicit allowance, Genesys affordability defaults to 100. These fields do not change Advanced affordability.

Fast engine detection and projection use two read-only scanners shared with Suggestions. Deep candidate scans and shortlists have a separate scanner, so fast requests and status polls cannot reject a running deep job through queue pressure. Equivalent fast requests share work, with at most eight distinct requests globally. Each user can retain two queued query keys behind their running request; subsequent edits replace the oldest queued input. The interactive scanner queue allows eight waiting calls. Engines calls have a 20-second budget including cold worker/DB/graph initialization, actor wait and scanner queue wait. Completed-status scanner calls retain their 4.5-second budget. Host overload or deadline expiry returns 503 with a one-second retry hint. A cold scanner may finish warming after its caller deadline, up to the existing 30-second hard cap; a warm scanner that times out is retired. A five-second, 64-entry fast cache includes guild, engine set, deck context, explicit `genesysRemaining` and persisted revisions of bridge evidence/reviews, catalog and saved-deck detection inputs. Duel writes do not invalidate it. Feedback and judgement writes, including through other connections, invalidate it immediately. This fast result cache is separate from the deck-independent shared deep-work cache.

The web allows 25 seconds for engines and directed list reads (`from`/`between`), including reading the response body. Other bridge operations retain their five-second web deadline. A retryable host engines response (503 with a positive integer retry hint) becomes HTTP 202 with `BridgeLoadingResponse`, clamped to 1–10 seconds, and `Cache-Control: private, no-store`. The exported `fetchBridgeEngines` helper validates that shape and retries the same read after the supplied delay. Its promise stays pending, preserving the existing UI loading state and avoiding an unavailable message or a false empty detection on first open. It stops immediately when the tab/deck request is cancelled, including during the retry delay. Permanent errors, including missing ranking data, still fail normally. The retries only read stored rows and never admit deep work or call judges.

The web's own read deadline, including an empty-message fetch abort at that deadline, returns a retryable `BRIDGES_LOADING` response with the message “Bridges are still loading. Try again shortly.” Engines requests convert it to the same HTTP 202 contract; list reads retain HTTP 503 and `Retry-After: 1`. An earlier network failure remains an upstream error, and a caller's aborted signal remains cancellation.

Host construction does not load ranking data. With `EFFECT_SEARCH=0` and an older graph lacking `engine_ranking`, the duel host still starts; engine requests return 503 until a compatible artifact is imported. Replacing the graph with an older version also degrades engine requests without affecting duels.

Browser callers can import `fetchBridges`, `BridgeListRequest`, `BridgeListResponse`, `fetchBridgeEngines`, `BridgeLoadingResponse`, `isBridgeLoadingResponse`, `BridgeEnginesRequest`, `BridgeDeepSearchRequest`, `ShownBridge`, `BridgeReviewStep`, `EngineCore`, and `CoreCard` from `packages/web/src/lib/bridges-api.ts`. Server validation and signed-host helpers live in `bridges-server-api.ts`; web processes never construct the graph.

Caller cancellation is an expected web-to-host outcome, including Next.js's empty-message `ResponseAborted` reason. It returns a descriptive cancellation response without reporting an exception. Unexpected transport/HTTP failures always have a nonempty diagnostic message and include `hostStatus` and a redacted, bounded `hostBody` (at most 2048 characters); empty or invalid successful bodies log the same host details. A failed engines request is not a successful detection of zero engines.

`POST /api/cards/bridges/deep-search` accepts one selector form: `source` alone, `engines` with optional `deck`, or `deck` alone. Unknown fields are rejected, bodies are bounded to 4096 bytes, and archetype names to 120 characters. Engine sets contain 1–4 names. When `engines` is supplied, it alone selects the shared work and cache key; an accompanying `deck` is subscriber context for existing copies, missing cards and Genesys points. Its detected engines never replace the supplied set, including in Pick mode. A deck-only request resolves to its detected engine set at admission; a deck with no detected engines returns 400 only when explicit engines are absent. The source-only compatibility selector uses the same engine-set scan, shortlist and review execution. `deckId` and `target` are rejected for every deep-search selector; a pair uses `engines: [source, target]`. `source` cannot be combined with `engines` or `deck`. There is no separate single-pair save/judge loop or ten-pending-pair limit.

```ts
// Request
{ source?: string, engines?: string[], deck?: BridgeDeck,
  format?: "advanced" | "genesys", genesysRemaining?: number, // integer 0–1000; preferred when supplied
  join?: boolean } // true: reuse existing work only; never admit or charge a search
// Editor request for Use my deck or Pick mode with a deck open:
{ format: "genesys", engines: ["Temple of the Kings", "Ashtra"],
  deck: { main: [29762407, 97522863], extra: [], pointCap: 250 }, genesysRemaining: 37 }
// Response: HTTP 202 for queued/running; HTTP 200 for cached completed jobs
{ jobId: string, state: "queued" | "running" | "done" | "failed", cached: boolean }
```

For automatic deck/points refreshes, send **`join: true` as a top-level JSON field** in that POST body, alongside the selector, `deck`, `format` and `genesysRemaining`. The host subscribes to matching queued/running work or a completed job retained in the 24-hour work cache, and updates only that subscriber's deck/points context. This also reuses retained incomplete-review results after their normal ten-minute retry window, without retrying reviews. If there is no reusable work (including expired or version-invalidated work), it returns 404; a different search already running for that user returns 409. Join-only requests bypass hourly admission and the queue limit, never create a job, never call scan/review workers and never count toward the 15/hour limit, including subscriptions to running work and after host restarts. Omitting `join` or sending `false` retains normal admission. Non-boolean values return 400.

`BridgeDeepSearchRequest` and the canonical `startDeepSearch` builder in `packages/web/src/lib/bridges-api.ts` include `join?: boolean`. The builder carries `join: true` at the top level for context refreshes. A normal user click omits it. Its compatibility `BridgeScope.target` is translated to a two-engine set; no pair selector is sent to the host.

`GET /api/cards/bridges/deep-search/[jobId]` accepts no query parameters or body. Only a subscribed user in the same guild can poll it. Results remain empty until completion. Completed projections use a five-second, 64-entry cache keyed by job, subscriber deck/points context and the bridge-input revision. Evidence, review and feedback writes invalidate it immediately. Equivalent polls share work; a user can have one distinct projection in flight and at most four distinct projections run globally. Additional distinct polls receive 503 with a one-second retry hint. Multi jobs persist the complete candidate set as compact source/target/format/evidence-hash references. Status sends the job ID to a scanner, which loads those inputs and resolves unchanged evidence rows. Older full-row results are also parsed in the scanner, with a bounded parse cache. Large candidate sets never cross the host loop on status reads.

```ts
{ jobId: string, state: "queued" | "running" | "done" | "failed",
  step: "candidates" | "checking" | "rating" | "done",
  progress: number, // integer 0–100
  engines: string[], next: EngineSuggestion[], // at most six; empty while work is pending
  results: ShownBridge[], inReview: number, error?: string }
```

Jobs progress `queued → running → done|failed`. Queued jobs start at `candidates/0`; running steps are candidates, deterministic checking, then rating. Success ends at `done/100`; failures retain their last progress and a safe error. Interrupted jobs become failed on host restart. `inReview` includes pending and disputed candidates, never invalid ones.

For both single-engine and multiple-engine Next engine searches, each source gets a complete forward scan and an incoming `deepInto` scan before ranking. Single-source `results` retain their legacy directed projection separately; `next` uses both directions. Candidate progress covers both directions for every source. Stored rows receive the current artifact version before ranking.

A multi job with attempted reviews still pending after provider failures uses ten-minute retry admission, even when other pairs were accepted. Only successful bounded work retains the full 24-hour cache. Invalid, disputed and player-hidden pairs are excluded before shortlist slots or shared access paths are assigned. An engine counts toward the six-engine stop only with a shown link or a new verdict saved by this job.

The deterministic shortlist contains at most eight engines, reserving up to two slots for complete non-hub physical Niche paths that already passed both independent reviews. Resource synergies can occupy at most one of those eight slots. Reviews follow shortlist order and use the best forward display pairs plus the best reverse pair, at most three per engine. The job stops after six engines have reviewed pairs or twelve directed pairs have needed new reviews. Cached accepted paths can backfill without paid calls, including after the paid-review stop; a partially reviewed pair consumes one of the twelve when its missing review is requested. Two pair tasks run at a time through the existing global judge queue. Only the existing independent Haiku reviews run for bridges and synergies; no aggregate, core prose or additional synergy call is added. Internal engine-to-engine rows are published only if already accepted access bridges. Completed projection rechecks all gates and computes at most six next engines using accepted candidate pairs; pending pairs never add coverage or two-way status, and synergies never count as access. Invalid, disputed, generic-toolbox and hub-only paths cannot fill the Niche lane. A completed multi job remains reusable for 24 hours even when its intentional review limit leaves part of the shortlist pending.

Single-engine selectors use the shared engine search execution and source cache tuple `[version, lowerCaseSource, null, format]`, preserving `results` regardless of which selector first creates the shared job. Multi-engine keys hash `[version, "multi-v2", sortedLowerCaseEngines, format]`. The deck and points allowance never enter the shared work query or key: `bridge_deep_actor.deck_cards_json`, `deck_context_json` and `genesys_remaining` retain subscriber context, including sections, mode and singleton rules. Two players with the same engines share one job but receive their own missing cards and Genesys affordability. Reposting the same work with a changed deck or allowance updates that subscriber's context on an active or completed job without a new scan or review. Multi jobs keep `results: []`; legacy single-source callers retain their existing results and also receive the new `engines` and `next` fields.

Completed deep searches return at most **ten** shown rows: strict bridges first,
then rows with `tier: "niche"`, including at most two resource synergies.
These deep-only rows display **Niche** in both
the list and details even if the reviewers assign a higher usefulness grade.
The existing `grade: "Niche"` can still occur on strict candidates; only the
new `tier` field identifies deep-only eligibility. Both independent Haiku 5.5
reviews, format checks, current evidence and feedback gates apply to every row.
No pending or disputed row fills an empty slot. Within the Niche tier, two-way
access ranks before one-way access, then score and target name break ties.

A Niche access bridge requires a physical access path over checked capability
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
insufficient: Paleozoic Traps merely played alongside Temple of the Kings do not qualify.
Name-label groups, same-deck families, negated entry chains and unsupported
material/placement setups remain excluded.

Set access checks the printed recipient and origin. A named/archetype filter or
an actual matching catalog pool of at most 30 cards qualifies. A subtype alone,
such as Normal Trap or Continuous Trap, does not bypass the normal toolbox cap;
broad subtype pools cannot establish access. A Set must take its recipient from
the Deck, or an otherwise inaccessible Extra Deck origin. A Set from the player's
own hand never establishes access, and a GY Set is recursion. Setting never implies
activation. Scoped and global activation permissions still retain their printed
recipient restrictions, conditions and costs; delayed activation prohibitions
are not waived.

Toy Box itself cannot Set Ashtra cards, so Toy → Ashtra is a resource synergy,
not an access bridge. The source must generate an additional checked Set resource
from the Deck in a multi-card effect: Toy Box can Set up to two qualifying
original-name Toy monsters as Spells. A source that only Sets one of its own cards
does not qualify.
The target Ashtra monster's printed hand Summon procedure must reveal and actually
return that Set resource. This path uses `kind: "synergy"` and
`reason.setup: {card, using, capability: "face_down_card"}`; `setup` never establishes
bridge access. A generic ability to Set a card from hand, a Set affinity without
the printed consumer, or a recipient that would be banished instead of returning
to hand is insufficient. Older tag recipient indexes are
rechecked against current identity filters; omitted trap-monster/attack-only
restrictions and explicit exclusions are preserved. Unsupported qualifiers fail
closed.


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
rankNextEngines(engines: readonly string[], rows: readonly ShownBridge[], context: EngineRankingContext, limit?: number, options?: EngineRankingOptions): RankedEngine[];
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

Scanner progress is `{phase: "index" | "score" | "validate" | "done", completed: number, total: number}`. Managed jobs map it to the HTTP steps and use the twelve-pair/six-engine stop rules above, with two candidate tasks at a time. `outgoing` returns the complete candidate set before target deduplication; `into` interprets the scan's `source` field as the destination engine. Single-engine Next engine scans use both operations while preserving directed `results`. Candidate extraction uses read-only worker connections. Reviews run on the host with at most two requests in flight. Candidate scans use at most one scanner, leaving the second scanner available for Suggestions.

## Files and schemas

All files live in `packages/shared/data/effects/`. The independent `bridges-manifest.json` has its own integrity pin in `bridge-artifact.ts`; updating bridges does not change the primary effect-tag pin.

| Artifact | Record |
| --- | --- |
| `card-capabilities.jsonl.gz` | `{id,card: Card,provides: Capability[],needs: Capability[],locks: SummonLock[],text_hash,evidence_hash}` |
| `bridges-advanced.jsonl.gz`, `bridges-genesys.jsonl.gz` | `ArchetypeBridge`, up to 25 per source |
| `bridges-manifest.json` | `{schema_version:1,algorithm_version,inputs:{tags,profiles,engine,metadata,genesys_revision,groups},files:{capabilities,advanced,genesys},groups,target_means,reason_frequencies,group_policies,materials,version}` |
| `bridge-groups.json` | Group curation, aliases, exclusions and membership selectors (hashed in the manifest inputs) |
| `bridges-golden.json` | `{pairs:[{source,target,format,expected:"bridge"|"not_bridge",tier?:"deep",access_path?:boolean,min_grade?,cards?,why,source_url}]}` |
| `bridge-judgements.jsonl.gz` | `{evidence_hash,input_hash,judge,framing,model,result,created_at}`; current reviews plus inert historical identities |

Each file descriptor is `{path,records,bytes,sha256,gzipBytes,gzipSha256}`. `version` hashes the manifest identity without itself. `groups` maps exact primary archetypes with profiles to IDs, folding duplicate case variants; the Temple of the Kings engine additionally groups exact Temple references and Apophis names. `materials` stores complete supported material lines by format and source. Unsupported material procedures fail closed.

`Capability` is `{key,value?,filter?:CardFilter,from?:string[],effect?:number,evidence,targets?:number[]}`. The closed 33-key vocabulary is `CAPABILITY_KEYS`. Targets are precomputed over the identity universe and filtered for format legality at runtime. `SummonLock` is `{scope,allow:CardFilter,extra_deck_only,self_removal,unresolved,evidence}`.

`ArchetypeBridge` is `{source,target,format,kind?:"synergy",tier?:"niche",score,raw_score,target_mean,two_way,grade,reasons,cards,warnings,genesys_points,validation,judge,engine_status,evidence_hash}`. `ShownBridge` retains that optional discriminator, and `RankedEngine`/`EngineSuggestion` carry it for a synergy suggestion. Ordinary access bridges omit it. Each reason has `{key,weight,cards,evidence,description,alternative?:true,steps?,materials?,cost?,setup?}`. Steps are `{from,to,capability}`; `cost` is `{card,using,capability,effect}`. `alternative?: true` marks additional recipients of an already scored action; these paths do not add aggregate score. Only synergy reasons use `setup`, which binds the checked target hand-Summon consumer and the actual Set resource; a bridge reason containing it is rejected. `materials` retains repeated passcodes when multiple copies are required. Evidence hashes incorporate contributing IDs, reason keys, material lines and card text/capability hashes, including evidence that contributed to aggregate scoring. Deep-only hashes also bind the tier, cost and Set-resource setup identities, and synergy identities cannot reuse access-bridge reviews.

Golden labels with `tier: "deep", access_path: true` check a directed physical
access regression through the current generator and checked judge-evidence builder,
independently of list truncation. They report `access_path_labels`,
`access_path_hits` and `access_path_recall`; `--check` requires full access recall
and the minimum grade. They do not enter top-ten recall or strict precision.
No model calls are made by this check.

Golden labels with `tier: "deep"` without `access_path` are evaluated against the deep top ten and
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

npx tsx scripts/effects/bridges.ts from "Temple of the Kings"
npx tsx scripts/effects/bridges.ts from "Temple of the Kings" --to Blue-Eyes
npx tsx scripts/effects/bridges.ts from "Temple of the Kings" --format genesys --limit 4
npx tsx scripts/effects/bridges.ts needs face_down_card
npx tsx scripts/effects/bridges.ts provides activate_trap_turn_set
npx tsx scripts/effects/bridges.ts path "Temple of the Kings" Blue-Eyes --hops 3
npx tsx scripts/effects/bridges.ts explain "Temple of the Kings" Blue-Eyes
```

Rebuild options: `--engine-directory`, `--directory` (tag/profile inputs), `--output`, `--metadata` (saved unpaginated public API snapshot), `--pin`. Rebuild shared after updating the integrity pin before running tools that import the compiled package. The CLI defaults to a disposable in-memory import; `--database PATH` opens an already-imported application database read-only. Path edges are validated individually; the CLI explicitly marks combined resource/lock compatibility as unverified.

Both effect tagging and engine-data update workflows rebuild/evaluate/stage bridges. Publication validators permit only four bridge data files and the single literal integrity-pin replacement. CI runs the golden evaluator and targeted integrations.

The golden set covers every top-five candidate for ten core sources in each format, plus regression pairs. `precision_at_5` counts only labelled positives in the numerator and all retrieved core-source rows in the denominator; unlabelled rows count against precision. Judged precision, coverage and the precision interval remain available for diagnosis. `--check` requires precision ≥0.9, coverage ≥0.8, recall ≥0.6 and no known negative pair returned even by live explanation. Missing engine labels fail evaluation; explicit excluded-label regressions instead assert that those labels stay absent. Negative evidence regressions reject the specified evidence cards without rejecting other valid lines for the pair. `--strict-precision` requires complete top-five coverage. Grades and matching annotated evidence cards are reported per pair for review.

Missing engine identities are excluded; the rebuild report lists unavailable profiled groups and their missing cards. The current prepared bundle includes the Ashtra identities, including Yoa the Plague Deity Ashtra and Ashtra Divine Domain. Golden evidence uses those printed identities; no bridge is invented for a missing card.
