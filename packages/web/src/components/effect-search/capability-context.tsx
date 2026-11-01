"use client";

import * as React from "react";

const EffectSearchContext = React.createContext(false);
const DeckSuggestionsContext = React.createContext(false);
const BridgesContext = React.createContext(false);

/** The server decides per request whether effect search is on. Screens below read it here instead of taking a prop each. */
export function EffectSearchProvider({ enabled, suggestionsEnabled = false, bridgesEnabled = false, children }: { enabled: boolean; suggestionsEnabled?: boolean; bridgesEnabled?: boolean; children: React.ReactNode }) {
  return <EffectSearchContext.Provider value={enabled}><DeckSuggestionsContext.Provider value={suggestionsEnabled}><BridgesContext.Provider value={bridgesEnabled}>{children}</BridgesContext.Provider></DeckSuggestionsContext.Provider></EffectSearchContext.Provider>;
}

export function useDeckSuggestionsEnabled(): boolean { return React.useContext(DeckSuggestionsContext); }

/** BRIDGES_ENABLED=1 on the server. Off: no Bridges tab, no "See bridges" offer and no request to a bridges route. */
export function useBridgesEnabled(): boolean { return React.useContext(BridgesContext); }

export function useEffectSearchEnabled(): boolean {
  return React.useContext(EffectSearchContext);
}
