"use client";

import * as React from "react";

const EffectSearchContext = React.createContext(false);

/** The server decides per request whether effect search is on. Screens below read it here instead of taking a prop each. */
export function EffectSearchProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <EffectSearchContext.Provider value={enabled}>{children}</EffectSearchContext.Provider>;
}

export function useEffectSearchEnabled(): boolean {
  return React.useContext(EffectSearchContext);
}
