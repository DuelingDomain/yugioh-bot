"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_DUEL_FORMAT, type DuelFormat, type DuelSettings } from "@yugidraft/shared/duels";
import { formatStartingLp } from "../table-format";
import { hashSeed } from "./gen";
import type { RegainMode } from "./stage";

/** What a duel tells its fields so they can crack: who it is (for the seed), where LP started, and how to treat regained LP. */
export interface FieldCracksValue {
  duelKey: string;
  /** Starting LP of one side (the team total in Tag). */
  startLp: number;
  regain: RegainMode;
  /** A replay shows the stage at the seek position and never animates it. */
  replay: boolean;
}

const FieldCracksContext = createContext<FieldCracksValue | null>(null);

/** Without a scope (the lab, tests, tournament boards) a field does not crack. */
export function useFieldCracksScope(): FieldCracksValue | null {
  return useContext(FieldCracksContext);
}

export function FieldCracksScope({
  duelKey,
  format,
  settings,
  startLp,
  replay = false,
  regain = "keep",
  children,
}: {
  duelKey: string;
  format?: DuelFormat;
  settings?: Pick<DuelSettings, "startingLP">;
  /** Overrides format + settings. */
  startLp?: number;
  replay?: boolean;
  regain?: RegainMode;
  children: ReactNode;
}) {
  const start = startLp ?? (settings ? formatStartingLp(format ?? DEFAULT_DUEL_FORMAT, settings) : null);
  const value = useMemo<FieldCracksValue | null>(
    () => (start != null && start > 0 ? { duelKey, startLp: start, regain, replay } : null),
    [duelKey, start, regain, replay],
  );
  return <FieldCracksContext.Provider value={value}>{children}</FieldCracksContext.Provider>;
}

/** The seed of one field: the same for every viewer of the duel. */
export function crackSeed(duelKey: string, region: string | number): number {
  return hashSeed(`${duelKey}:${region}`);
}
