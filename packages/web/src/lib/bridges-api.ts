import type { BridgeEnginesRequest, BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";

export type { BridgeDeck, DetectedEngine, EngineSuggestion, BridgeEnginesRequest, BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";

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
