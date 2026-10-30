import type { BridgeDeck, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat } from "@yugidraft/shared/cards/effects";

export type { BridgeDeck, DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse, BridgeFormat } from "@yugidraft/shared/cards/effects";

/** Explicit engines select shared work; an accompanying deck supplies subscriber context. */
export type BridgeDeepSearchRequest = { format?: BridgeFormat; genesysRemaining?: number } & (
  | { engines: string[]; deck?: BridgeDeck; source?: never; deckId?: never; target?: never }
  | { deck: BridgeDeck; engines?: never; source?: never; deckId?: never; target?: never }
  | { source: string; deckId?: never; target?: string; engines?: never; deck?: never }
  | { deckId: number; source?: never; target?: string; engines?: never; deck?: never }
);

/** Fast stored-row search. Calling this never admits a paid deep-search job. */
export async function fetchBridgeEngines(query: BridgeEnginesRequest, signal?: AbortSignal): Promise<BridgeEnginesResponse> {
  const response = await fetch("/api/cards/bridges/engines", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw Object.assign(new Error(body.error || `Bridges are not available (${response.status}).`), { status: response.status });
  }
  return response.json() as Promise<BridgeEnginesResponse>;
}
