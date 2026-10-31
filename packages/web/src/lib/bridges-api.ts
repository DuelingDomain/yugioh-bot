import type { BridgeDeck, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat, ShownBridge } from "@yugidraft/shared/cards/effects";

export type { BridgeDeck, BridgePackage, CoreCard, EngineCore, DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat, BridgeReviewStep, BridgeAlternativePath, ShownBridge } from "@yugidraft/shared/cards/effects";

/** The selected source stays authoritative; an open deck supplies only copies and points. */
export type BridgeListRequest = {
  target?: string;
  format?: BridgeFormat;
  genesysRemaining?: number;
} & (
  | { source: string; deck?: BridgeDeck; deckId?: never }
  | { deckId: number; source?: never; deck?: never }
);
export type BridgeListResponse = { results: ShownBridge[]; reverse?: ShownBridge[]; inReview: number };

/** Stored directed lists, with the same bounded JSON deck transport as engines. */
export async function fetchBridges(query: BridgeListRequest, signal?: AbortSignal): Promise<BridgeListResponse> {
  const response = await fetch("/api/cards/bridges", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; retryAfter?: number };
    const retryAfter = body.retryAfter ?? Number(response.headers.get("Retry-After"));
    throw Object.assign(new Error(body.error || `Bridges are not available (${response.status}).`), { status: response.status,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) });
  }
  return response.json() as Promise<BridgeListResponse>;
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
  | { engines: string[]; deck?: BridgeDeck; source?: never; deckId?: never; target?: never }
  | { deck: BridgeDeck; engines?: never; source?: never; deckId?: never; target?: never }
  | { source: string; deckId?: never; target?: string; engines?: never; deck?: never }
  | { deckId: number; source?: never; target?: string; engines?: never; deck?: never }
);

/** Stored-row reads only. Retry loading responses until answered or the tab/deck request is cancelled. */
export async function fetchBridgeEngines(query: BridgeEnginesRequest, signal?: AbortSignal): Promise<BridgeEnginesResponse> {
  while (true) {
    signal?.throwIfAborted();
    const response = await fetch("/api/cards/bridges/engines", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query), signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(body.error || `Bridges are not available (${response.status}).`), { status: response.status });
    }
    const body: unknown = await response.json();
    if (response.status !== 202) return body as BridgeEnginesResponse;
    if (!isBridgeLoadingResponse(body)) throw Object.assign(new Error("Invalid bridge loading response"), { status: 502 });
    await waitForBridgeRetry(body.retryAfter, signal);
  }
}
