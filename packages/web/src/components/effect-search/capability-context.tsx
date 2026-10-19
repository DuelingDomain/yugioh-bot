"use client";

import * as React from "react";

const EffectSearchContext = React.createContext(false);
const DeckSuggestionsContext = React.createContext(false);

/** The server decides per request whether effect search is on. Screens below read it here instead of taking a prop each. */
export function EffectSearchProvider({ enabled, suggestionsEnabled = false, children }: { enabled: boolean; suggestionsEnabled?: boolean; children: React.ReactNode }) {
  return <EffectSearchContext.Provider value={enabled}><DeckSuggestionsContext.Provider value={suggestionsEnabled}>{children}</DeckSuggestionsContext.Provider></EffectSearchContext.Provider>;
}

export function useDeckSuggestionsEnabled(): boolean { return React.useContext(DeckSuggestionsContext); }

export function useEffectSearchEnabled(): boolean {
  return React.useContext(EffectSearchContext);
}
