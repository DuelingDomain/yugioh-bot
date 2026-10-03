"use client";

import { useMemo, useState } from "react";
import { seatsOfTeam, teamOfSeat, type DuelChainLink, type DuelPrompt } from "@yugidraft/shared/duels";

/**
 * Who passed on the open chain. The engine view does not list passes, so the shell reads them from the prompt: while the
 * chain stays the same, a seat that held the chain prompt and then lost it to another seat passed. A new link or an empty
 * chain starts a new window. The Rooftop chain chips (`TagFx` `passedSeats`) follow this.
 */
export interface ChainPassState {
  /** The chain this state belongs to (`chainKeyOf`); "" for none. */
  key: string;
  seats: number[];
  /** The seat that held the chain prompt last. */
  lastSeat: number | null;
}

export const EMPTY_PASSES: ChainPassState = { key: "", seats: [], lastSeat: null };

/** A key that changes with every link added to the chain. Null for an empty chain. */
export function chainKeyOf(chain: readonly DuelChainLink[]): string | null {
  const last = chain[chain.length - 1];
  return last ? `${chain.length}:${last.index}:${last.seat}` : null;
}

/** The next pass state. It returns the same object when nothing changes, so a caller may compare by identity. */
export function advancePasses(state: ChainPassState, input: { chainKey: string | null; promptSeat: number | null }): ChainPassState {
  if (input.chainKey == null) return state === EMPTY_PASSES ? state : EMPTY_PASSES;
  if (state.key !== input.chainKey) return { key: input.chainKey, seats: [], lastSeat: input.promptSeat };
  if (input.promptSeat == null || input.promptSeat === state.lastSeat) return state;
  const seats = state.lastSeat != null && !state.seats.includes(state.lastSeat) ? [...state.seats, state.lastSeat] : state.seats;
  return { key: state.key, seats, lastSeat: input.promptSeat };
}

/**
 * The seats that passed, for the chain chips: the tracked ones, and the whole rival team when the seat that decides now is
 * on the team of the newest link (R-TAG-RESPONSE: the other team answered first and passed).
 */
export function passedSeatsFor(state: ChainPassState, chain: readonly DuelChainLink[], promptSeat: number | null): number[] {
  const last = chain[chain.length - 1];
  if (!last) return [];
  const seats = new Set(state.seats);
  if (promptSeat != null && teamOfSeat("tag", promptSeat) === teamOfSeat("tag", last.seat)) {
    for (const seat of seatsOfTeam("tag", 1 - teamOfSeat("tag", last.seat))) seats.add(seat);
  }
  return [...seats];
}

/** The pass tracker of the shell: feed it the chain and the open prompt on every render. */
export function useChainPasses(chain: readonly DuelChainLink[], prompt: DuelPrompt | null): number[] {
  const promptSeat = prompt?.context?.type === "chain" ? prompt.seat : null;
  const [state, setState] = useState<ChainPassState>(EMPTY_PASSES);
  const next = advancePasses(state, { chainKey: chainKeyOf(chain), promptSeat });
  if (next !== state) setState(next);
  return useMemo(() => passedSeatsFor(next, chain, promptSeat), [next, chain, promptSeat]);
}
