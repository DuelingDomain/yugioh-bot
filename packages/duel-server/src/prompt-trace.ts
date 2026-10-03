import type { DuelEngineView, DuelPromptOption } from "@yugidraft/shared/duels";

/** Scenario-only, read-only record of each prompt reached after a worker command. */
export interface PromptTraceEntry {
  promptId: string;
  revision: number;
  turn: number;
  turnSeat: number;
  phase: DuelEngineView["phase"];
  promptSeat: number;
  promptType: string;
  kind: string;
  options: DuelPromptOption[];
  chainSeats: number[];
  seats: Array<{ seat: number; handCount: number; deckCount: number }>;
}

export function tracePrompt(view: DuelEngineView): PromptTraceEntry | null {
  const prompt = view.prompt;
  if (!prompt) return null;
  return {
    promptId: prompt.id, revision: view.revision, turn: view.turn, turnSeat: view.turnSeat,
    phase: view.phase, promptSeat: prompt.seat, promptType: prompt.context?.type ?? prompt.kind,
    kind: prompt.kind, options: structuredClone(prompt.options),
    chainSeats: view.chain.map((link) => link.seat),
    seats: view.seats.map((seat) => ({ seat: seat.seat, handCount: seat.hand.length, deckCount: seat.deckCount })),
  };
}
