import { createContext } from "react";

export type ChainStripSize = { width: number; height: number };

/** The FX portal keeps this context, so the stage can reserve its measured strip in the prompt search. */
export const ChainRoomContext = createContext<((size: ChainStripSize | null) => void) | null>(null);
