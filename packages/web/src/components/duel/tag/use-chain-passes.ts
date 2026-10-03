"use client";

import { useMemo, useState } from "react";
import { seatsOfTeam, teamOfSeat, type DuelChainLink, type DuelEngineView, type DuelPrompt } from "@yugidraft/shared/duels";
import { tagResponseOrder } from "./live-tag";

/**
 * Who passed on the open chain. The engine view does not list passes, so the shell reads them from the seat that decides:
 * while the chain stays the same, a seat that decided and then lost the decision to the next expected responder passed.
 * Every viewer sees the deciding seat (`engine.prioritySeat`), so a partner, a rival and a spectator track the same passes
 * as the seat that holds the prompt. A new link or an empty chain starts a new window. The Rooftop chain chips (`TagFx`
 * `passedSeats`) follow this.
 */
export interface ChainPassState {
  /** The chain this state belongs to (`chainKeyOf`); "" for none. */
  key: string;
  seats: number[];
  /** The seat that decided last. */
  lastSeat: number | null;
}

export const EMPTY_PASSES: ChainPassState = { key: "", seats: [], lastSeat: null };

/** A key that changes with every link added to the chain. Null for an empty chain. */
export function chainKeyOf(chain: readonly DuelChainLink[]): string | null {
  const last = chain[chain.length - 1];
  return last ? `${chain.length}:${last.index}:${last.seat}` : null;
}

/**
 * The seat that decides on the open chain, for any viewer: the public priority seat, else the viewer's own chain prompt.
 * Null without a chain, while the engine processes, and while the viewer holds a prompt that is not a chain prompt
 * (a link resolving asks other things; those are no passes).
 */
export function chainDecidingSeat(engine: Pick<DuelEngineView, "chain" | "prioritySeat">, prompt: DuelPrompt | null): number | null {
  if (engine.chain.length === 0) return null;
  if (prompt && prompt.context?.type !== "chain") return null;
  return engine.prioritySeat ?? prompt?.seat ?? null;
}

/**
 * Seats that must have passed before `seat` decides on this chain (R-TAG-RESPONSE): the earlier members of its team in turn
 * order, and the whole rival team when `seat` is on the team of the newest link.
 */
function impliedPasses(chain: readonly DuelChainLink[], turnSeat: number, seat: number): number[] {
  const last = chain[chain.length - 1];
  if (!last) return [];
  const count = seatsOfTeam("tag", 0).length + seatsOfTeam("tag", 1).length;
  const team = teamOfSeat("tag", seat);
  const turnOrder = Array.from({ length: count }, (_, i) => (turnSeat + i) % count);
  const mates = turnOrder.filter((other) => teamOfSeat("tag", other) === team);
  const implied = mates.slice(0, mates.indexOf(seat));
  if (team === teamOfSeat("tag", last.seat)) implied.push(...seatsOfTeam("tag", 1 - team));
  return implied;
}

/**
 * The next pass state. It returns the same object when nothing changes, so a caller may compare by identity. A new deciding
 * seat counts only when it is the next expected responder (`tagResponseOrder`); anything else (a link resolving) is ignored.
 */
export function advancePasses(state: ChainPassState, input: { engine: DuelEngineView; decidingSeat: number | null }): ChainPassState {
  const { engine, decidingSeat } = input;
  const key = chainKeyOf(engine.chain);
  if (key == null) return state === EMPTY_PASSES ? state : EMPTY_PASSES;
  if (state.key !== key) return { key, seats: [], lastSeat: decidingSeat };
  if (decidingSeat == null || decidingSeat === state.lastSeat) return state;
  if (state.lastSeat == null) return { ...state, lastSeat: decidingSeat };
  const passed = new Set([...state.seats, state.lastSeat, ...impliedPasses(engine.chain, engine.turnSeat, state.lastSeat)]);
  if (tagResponseOrder(engine, engine.turnSeat, [...passed])?.promptSeat !== decidingSeat) return state;
  const seats = state.seats.includes(state.lastSeat) ? state.seats : [...state.seats, state.lastSeat];
  return { key, seats, lastSeat: decidingSeat };
}

/**
 * The seats that passed, for the chain chips: the tracked ones, and the seats that must have passed before the seat that
 * decides now (its earlier team mates, and the whole rival team when it is on the team of the newest link).
 */
export function passedSeatsFor(state: ChainPassState, chain: readonly DuelChainLink[], decidingSeat: number | null, turnSeat: number): number[] {
  if (chain.length === 0) return [];
  const seats = new Set(state.seats);
  if (decidingSeat != null) for (const seat of impliedPasses(chain, turnSeat, decidingSeat)) seats.add(seat);
  return [...seats];
}

/** The pass tracker of the shell: feed it the engine view and the open prompt on every render. */
export function useChainPasses(engine: DuelEngineView, prompt: DuelPrompt | null): number[] {
  const decidingSeat = chainDecidingSeat(engine, prompt);
  const [state, setState] = useState<ChainPassState>(EMPTY_PASSES);
  const next = advancePasses(state, { engine, decidingSeat });
  if (next !== state) setState(next);
  return useMemo(() => passedSeatsFor(next, engine.chain, decidingSeat, engine.turnSeat), [next, engine.chain, engine.turnSeat, decidingSeat]);
}
