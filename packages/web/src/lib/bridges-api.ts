import type { BridgeDeck, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat, EngineSuggestion, ShownBridge } from "@yugidraft/shared/cards/effects";

/** ShownBridge and EngineSuggestion carry kind?: "synergy"; ordinary access bridges omit kind. */
export type { BridgeDeck, CoreCard, EngineCore, DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat, BridgeAlternativePath, ShownBridge } from "@yugidraft/shared/cards/effects";

/** The selected source stays authoritative; an open deck supplies only copies and points. */
export type BridgeListRequest = {
  source: string;
  deck?: BridgeDeck;
  target?: string;
  format?: BridgeFormat;
  genesysRemaining?: number;
};
export type BridgeListResponse = { results: ShownBridge[]; reverse?: ShownBridge[]; inReview: number };

/** Selected engines and optional subscriber context for deep search. */
export type BridgeScope = { source: string; target?: string; format: BridgeFormat; genesysRemaining?: number; engines?: readonly string[]; deck?: BridgeDeck };
export type DeepState = "queued" | "running" | "done" | "failed";
export type DeepStep = "candidates" | "checking" | "rating" | "done";
export type DeepStatus = { jobId: string; state: DeepState; step: DeepStep; progress: number; results: ShownBridge[]; inReview: number; error?: string; engines?: string[]; next?: EngineSuggestion[] };
export type DeepStart = { jobId: string; state: DeepState; cached: boolean };

export class BridgeRequestError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter?: number) {
    super(message); this.name = "BridgeRequestError";
  }
}

async function requestBridge(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.ok) return response;
  const body = await response.json().catch(() => ({})) as { error?: unknown; retryAfter?: unknown };
  const hint = typeof body.retryAfter === "number" ? body.retryAfter : Number(response.headers.get("Retry-After"));
  throw new BridgeRequestError(response.status,
    typeof body.error === "string" && body.error ? body.error : `Bridges are not available (${response.status}).`,
    Number.isFinite(hint) && hint > 0 ? Math.ceil(hint) : undefined);
}
const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
const call = async <T>(url: string, init?: RequestInit): Promise<T> => (await requestBridge(url, init)).json() as Promise<T>;

/** Stored directed lists always use bounded POST JSON, including when no deck is open. */
export function fetchBridges(query: BridgeListRequest, signal?: AbortSignal): Promise<BridgeListResponse> {
  const { source, target, format, deck, genesysRemaining } = query;
  return call("/api/cards/bridges", post({ source, ...(target === undefined ? {} : { target }),
    ...(format === undefined ? {} : { format }), ...(deck === undefined ? {} : { deck }),
    ...(genesysRemaining === undefined ? {} : { genesysRemaining }) }, signal));
}

/** HTTP 202: retry this read while keeping the existing loading presentation. */
export type BridgeLoadingResponse = { state: "loading"; retryAfter: number };

export function isBridgeLoadingResponse(value: unknown): value is BridgeLoadingResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(key => key === "state" || key === "retryAfter") && row.state === "loading"
    && Number.isSafeInteger(row.retryAfter) && Number(row.retryAfter) >= 1 && Number(row.retryAfter) <= 10;
}

function waitForBridgeRetry(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, seconds * 1000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Explicit engines select shared work; an accompanying deck supplies subscriber context. */
export type BridgeDeepSearchRequest = {
  format?: BridgeFormat;
  /** Refresh context on existing work only; never admits or counts a new search. */
  join?: boolean;
  /** Integer 0–1000; the editor's remaining allowance overrides host deck accounting, including zero. */
  genesysRemaining?: number;
} & (
  | { engines: string[]; deck?: BridgeDeck; source?: never }
  | { deck: BridgeDeck; engines?: never; source?: never }
  | { source: string; engines?: never; deck?: never }
);

/** Stored-row reads only. Retry loading responses until answered or the tab/deck request is cancelled. */
export async function fetchBridgeEngines(query: BridgeEnginesRequest, signal?: AbortSignal): Promise<BridgeEnginesResponse> {
  while (true) {
    signal?.throwIfAborted();
    const response = await requestBridge("/api/cards/bridges/engines", post(query, signal));
    const body: unknown = await response.json();
    if (response.status !== 202) return body as BridgeEnginesResponse;
    if (!isBridgeLoadingResponse(body)) throw new BridgeRequestError(502, "Invalid bridge loading response");
    await waitForBridgeRetry(body.retryAfter, signal);
  }
}

/** Existing source-only callers share the same engine search execution and retain directed status projection. */
export function startDeepSearch(scope: BridgeScope, signal?: AbortSignal, join = false): Promise<DeepStart> {
  const points = scope.format === "genesys" && scope.genesysRemaining != null
    ? { genesysRemaining: Math.max(0, Math.min(1000, Math.floor(scope.genesysRemaining))) } : {};
  const selected = scope.engines?.length ? [...scope.engines] : scope.target ? [scope.source, scope.target] : scope.deck ? [scope.source] : undefined;
  const selector = selected ? { engines: selected, ...(scope.deck ? { deck: scope.deck } : {}) } : { source: scope.source };
  return call("/api/cards/bridges/deep-search", post({ ...selector, format: scope.format, ...points, ...(join ? { join: true } : {}) }, signal));
}

export function pollDeepSearch(jobId: string, signal?: AbortSignal): Promise<DeepStatus> {
  return call(`/api/cards/bridges/deep-search/${encodeURIComponent(jobId)}`, { signal });
}

export function reportBridge(evidenceHash: string, reason: string, signal?: AbortSignal): Promise<{ accepted: true; hidden: boolean }> {
  return call("/api/cards/bridges/feedback", post({ evidenceHash, ...(reason.trim() ? { reason: reason.trim() } : {}) }, signal));
}

let archetypeNames: Promise<string[]> | null = null;
export function fetchBridgeArchetypes(): Promise<string[]> {
  if (!archetypeNames) {
    archetypeNames = call<{ archetypes: string[] }>("/api/cards/bridges/archetypes").then(body => body.archetypes);
    archetypeNames.catch(() => { archetypeNames = null; });
  }
  return archetypeNames;
}
