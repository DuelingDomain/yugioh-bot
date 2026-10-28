# Directed archetype bridges

This stage builds deterministic candidates and exposes administrative and worker APIs. The player UI, paid judges, deep-search HTTP route and progress bar are subsequent stages. No paid requests are made here. Every returned row says `validation: "deterministic"`, `judge: "pending"`, and `engine_status: "unverified"`.

## TypeScript API

Import types and extraction functions from `@yugidraft/shared/cards/effects`; import `createBridgeService` from `@yugidraft/shared/services`.

```ts
type BridgeFormat = "advanced" | "genesys";
type LockScope = "while_face_up" | "rest_of_turn_after_activation" | "whole_turn_cost" | "none";
type BridgeGrade = "Strong" | "Good" | "Niche" | "Risky";

extractCardCapabilities(card: Card, tags?: CardTags, profile?: ArchetypeProfile): CardCapability;
indexBridgeCapabilities(rows: CardCapability[]): void;
bridgeGroups(capabilities: readonly CardCapability[], profiles: ReadonlyMap<string, ArchetypeProfile>): Record<string, number[]>;
bridgeLegal(card: Card, format: BridgeFormat): boolean;
readBridgeManifest(directory?: string): BridgeManifest;
importBridgeArtifact(db: Database.Database, directory?: string): {
  version: string; bridges: number; capabilities: number; skipped: boolean;
};

createBridgeService(db: Database.Database): BridgeService;
// Methods of BridgeService:
bridgesFrom(archetype: string, format?: BridgeFormat, limit?: number): ArchetypeBridge[];
bridgeBetween(x: string, y: string, format?: BridgeFormat): ArchetypeBridge | null;
explain(x: string, y: string, format?: BridgeFormat): ArchetypeBridge | null;
liveCandidates(source: string, format?: BridgeFormat, progress?: (value: BridgeProgress) => void): ArchetypeBridge[];
capabilities(key: CapabilityKey, direction: "needs" | "provides"): CardCapability[];
```

`bridgesFrom` defaults to Advanced and four results, with a maximum of 25. `bridgeBetween` reads the retained artifact. `explain` also computes niche pairs outside the retained 25. `liveCandidates` searches all groups, reusing offline reach and material indexes. Unknown sources return no candidates. The service hides rejected judgements and evidence with two unresolved independent feedback flags.

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
  { op: "from"; limit?: number } | { op: "live" } |
  { op: "between" | "explain"; target: string }
);
type BridgeScanResult = ArchetypeBridge[] | ArchetypeBridge | null;

DeckSuggestionWorkers.runBridge(
  scan: BridgeScan, actor: string, progress?: (value: BridgeProgress) => void
): Promise<BridgeScanResult>;
```

`actor` must be the authenticated player identity supplied by the host. One request per actor may be in flight. The suggestion pool bounds total concurrency to two workers; there is no backlog. Uncached `live` and `explain` requests share a persistent, atomic 60-second actor cooldown. Identical results are cached across callers for 15 minutes, bounded to 64 entries and invalidated by artifact version. Cached responses recheck judgements and feedback. `BridgeSearchBusyError` has `status: 429` and `retryAfterMs`; the future HTTP route should preserve those values.

Progress is `{phase: "index" | "score" | "validate" | "done", completed: number, total: number}`. Forward these events to the future progress bar. Cached results immediately emit `done`. This admission contract has no spend cap; a future paid search must acquire admission before submitting any paid request.

## Files and schemas

All files live in `packages/shared/data/effects/`. The independent `bridges-manifest.json` has its own integrity pin in `bridge-artifact.ts`; updating bridges does not change the primary effect-tag pin.

| Artifact | Record |
| --- | --- |
| `card-capabilities.jsonl.gz` | `{id,card: Card,provides: Capability[],needs: Capability[],locks: SummonLock[],text_hash,evidence_hash}` |
| `bridges-advanced.jsonl.gz`, `bridges-genesys.jsonl.gz` | `ArchetypeBridge`, up to 25 per source |
| `bridges-manifest.json` | `{schema_version:1,algorithm_version,inputs:{tags,profiles,engine,metadata,genesys_revision},files:{capabilities,advanced,genesys},groups,target_means,materials,version}` |
| `bridges-golden.json` | `{pairs:[{source,target,format,expected:"bridge"|"not_bridge",min_grade?,cards?,why,source_url}]}` |

Each file descriptor is `{path,records,bytes,sha256,gzipBytes,gzipSha256}`. `version` hashes the manifest identity without itself. `groups` maps exact primary archetypes with profiles to IDs, folding duplicate case variants; Odion additionally groups exact Temple references and Apophis names. `materials` stores complete supported material lines by format and source. Unsupported material procedures fail closed.

`Capability` is `{key,value?,filter?:CardFilter,from?:string[],effect?:number,evidence,targets?:number[]}`. The closed 33-key vocabulary is `CAPABILITY_KEYS`. Targets are precomputed over the identity universe and filtered for format legality at runtime. `SummonLock` is `{scope,allow:CardFilter,extra_deck_only,self_removal,unresolved,evidence}`.

`ArchetypeBridge` is `{source,target,format,score,raw_score,target_mean,two_way,grade,reasons,cards,warnings,genesys_points,validation,judge,engine_status,evidence_hash}`. Each reason has `{key,weight,cards,evidence,description,steps?,materials?}`. Steps are `{from,to,capability}`. `materials` retains repeated passcodes when multiple copies are required. Evidence hashes incorporate contributing IDs, reason keys, material lines and card text/capability hashes, including evidence that contributed to aggregate scoring.

Genesys excludes Link/Pendulum cards and lines with mandatory Link/Pendulum dependencies. It uses the existing verified Genesys snapshot reader, including known zeroes, and ignores the competitive Forbidden/Limited list. `genesys_points` counts one copy of each displayed evidence card plus required material multiplicity. It describes that evidence package; it is not a claim that an existing deck has sufficient remaining points. The caller must use the existing deck admission checker for the selected deck cap and copies.

| SQLite table | Columns / keys |
| --- | --- |
| `card_capability` | `passcode` PK, `capabilities_json`, `text_hash`, `evidence_hash`, `source_version` |
| `archetype_bridge` | PK `(source,target,format)`, `score`, `grade`, `bridge_json`, `evidence_hash`, `source_version`; lookup index `(source,format,score DESC)` |
| `bridge_graph` | `id=1` PK, `graph_json`, `source_version` |
| `bridge_artifact_import` | `version` PK, `imported_at` |
| `bridge_judgement` | PK `(evidence_hash,judge)`, `verdict` (`approved/rejected/review`), `judgement_json`, `created_at` |
| `bridge_feedback` | `id` PK, `evidence_hash`, `actor_hash`, `reason`, `created_at`, `resolved_at`; unique `(evidence_hash,actor_hash)` |
| `bridge_search_admission` | `actor_hash` PK, `admitted_at` epoch milliseconds |

Judgement and feedback tables start empty. Imports validate pinned compressed and decompressed bytes before one transaction; changed artifacts replace graph rows while preserving judgement/feedback history. Duel-host effect startup imports bridges behind the existing effect-search flag.

## Rebuild, CLI and evaluation

Use Node 22. All engine reads use the same `loadCardDatabase` / `engineInsightCard` path as effect indexing. No application catalog race field is used. The public metadata snapshot supplies primary archetype labels, TCG availability and verified Genesys points; card identity, exact engine setcode memberships and printed text come from the read-only engine bundle. Thematic group labels never establish an effect's rules membership: Sage with Eyes of Blue is grouped with Blue-Eyes support but cannot be summoned by an effect requiring a Blue-Eyes monster.

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
DUEL_DATA_DIR=/path/to/read-only/engine prlimit --core=0 -- npx tsx scripts/effects/rebuild-bridges.ts
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npx tsx scripts/effects/evaluate-bridges.ts --check
prlimit --core=0 -- npx tsx scripts/effects/benchmark-bridges.ts

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

The golden set labels pairs, rather than every top-five result. The evaluator therefore reports `judged_precision_at_5`, judgement coverage and a precision interval. `precision_at_5` is null until all returned top-five pairs are labelled; it never counts unjudged pairs as correct. Recall@10 includes unavailable positive labels as misses. `--check` requires judged precision ≥0.9, recall ≥0.6 and no known negative pair returned even by live explanation. `--strict-precision` additionally requires complete top-five coverage. Grades and matching annotated evidence cards are reported per pair for review.

Missing engine identities are excluded; the rebuild report lists unavailable profiled groups and their missing cards. The supplied snapshot omits all ten tagged Ashtra identities, so the Odion → Ashtra sanity target cannot be satisfied with that snapshot. Rebuilding with a current prepared engine bundle will include those identities if present; no bridge is invented for a missing card.
