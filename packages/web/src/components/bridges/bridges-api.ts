import type { BridgeDeck, EngineSuggestion, ShownBridge } from "@yugidraft/shared/cards/effects";

export type { BridgeDeck, EngineSuggestion, ShownBridge };
export type BridgeFormat = "advanced" | "genesys";

/**
 * What a bridge search is about. `genesysRemaining` only counts in Genesys. `source` is the first engine. With
 * `engines` of two or more the deep search runs on the whole set: `deck` (the open deck, when the set is the one the
 * host finds in it) or the named `engines`. The deep route takes only one of the two.
 */
export type BridgeScope = { source: string; target?: string; format: BridgeFormat; genesysRemaining?: number; engines?: readonly string[]; deck?: BridgeDeck };
export type BridgeList = { results: ShownBridge[]; reverse?: ShownBridge[]; inReview: number };

export type DeepState = "queued" | "running" | "done" | "failed";
export type DeepStep = "candidates" | "checking" | "rating" | "done";
export type DeepStatus = { jobId: string; state: DeepState; step: DeepStep; progress: number; results: ShownBridge[]; inReview: number; error?: string; engines?: string[]; next?: EngineSuggestion[] };
export type DeepStart = { jobId: string; state: DeepState; cached: boolean };

/** A failed call. `retryAfter` (seconds) comes with a 429. */
export class BridgeRequestError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter?: number) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = "";
    let retryAfter: number | undefined;
    try {
      const body = (await response.json()) as { error?: unknown; retryAfter?: unknown };
      if (typeof body.error === "string") message = body.error;
      if (typeof body.retryAfter === "number") retryAfter = body.retryAfter;
    } catch { /* The body is not JSON. The status is enough. */ }
    if (response.status === 429 && retryAfter === undefined) {
      const header = Number(response.headers.get("Retry-After"));
      if (Number.isFinite(header) && header > 0) retryAfter = Math.ceil(header);
    }
    throw new BridgeRequestError(response.status, message || `Bridges are not available (${response.status}).`, retryAfter);
  }
  return (await response.json()) as T;
}

function queryOf(scope: BridgeScope): string {
  const params = new URLSearchParams({ source: scope.source, format: scope.format });
  if (scope.target) params.set("target", scope.target);
  if (scope.format === "genesys" && scope.genesysRemaining != null) params.set("genesysRemaining", String(Math.max(0, Math.min(1000, Math.floor(scope.genesysRemaining)))));
  return params.toString();
}

/** The top shown bridges from one archetype; with a target, the bridge each way. */
export function fetchBridges(scope: BridgeScope, signal?: AbortSignal): Promise<BridgeList> {
  return call<BridgeList>(`/api/cards/bridges?${queryOf(scope)}`, { signal });
}

/** Start the deep search, or join the one that already runs. */
export function startDeepSearch(scope: BridgeScope, signal?: AbortSignal): Promise<DeepStart> {
  const points = scope.format === "genesys" && scope.genesysRemaining != null ? { genesysRemaining: Math.max(0, Math.min(1000, Math.floor(scope.genesysRemaining))) } : {};
  // Several engines: exactly one selector. The open deck stands for its engines; the points come from the deck then.
  const multi = scope.engines && scope.engines.length > 1 ? scope.engines : null;
  const body = multi
    ? { format: scope.format, ...(scope.deck ? { deck: scope.deck } : { engines: multi, ...points }) }
    : { source: scope.source, format: scope.format, ...(scope.target ? { target: scope.target } : {}),
    ...points };
  return call<DeepStart>("/api/cards/bridges/deep-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

export function pollDeepSearch(jobId: string, signal?: AbortSignal): Promise<DeepStatus> {
  return call<DeepStatus>(`/api/cards/bridges/deep-search/${encodeURIComponent(jobId)}`, { signal });
}

export function reportBridge(evidenceHash: string, reason: string, signal?: AbortSignal): Promise<{ accepted: true; hidden: boolean }> {
  return call("/api/cards/bridges/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidenceHash, ...(reason.trim() ? { reason: reason.trim() } : {}) }), signal });
}

let archetypeNames: Promise<string[]> | null = null;

/** The archetypes that have bridge data, for the two-archetype search. Kept after the first answer; a failed call is not kept. */
export function fetchBridgeArchetypes(): Promise<string[]> {
  if (!archetypeNames) {
    archetypeNames = call<{ archetypes: string[] }>("/api/cards/bridges/archetypes").then((body) => body.archetypes);
    archetypeNames.catch(() => { archetypeNames = null; });
  }
  return archetypeNames;
}
