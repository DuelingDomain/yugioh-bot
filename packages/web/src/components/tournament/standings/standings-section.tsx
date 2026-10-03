"use client";

import { Bracket } from "../bracket/bracket";
import type { CrosstableProps } from "../sheet-contracts";
import { Crosstable } from "./crosstable";

/** The standings slot of the sheet: a bracket for single elimination, the crosstable otherwise. */
export function StandingsSection(props: CrosstableProps & { narrow?: boolean; final?: boolean }) {
  return props.tournament.format === "single_elim" ? <Bracket {...props} /> : <Crosstable {...props} />;
}
