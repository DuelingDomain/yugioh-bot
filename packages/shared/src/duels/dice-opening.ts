export const DUEL_DICE_REVEAL_MS = 3_000;

export interface DuelDiceRound {
  round: number;
  /** Indexed by the lobby seat at the start of the opening. Null means this seat did not re-roll. */
  rolls: Array<number | null>;
}

export interface DuelDiceOpeningState {
  phase: "dice" | "start";
  round: number;
  deadline: number;
  startedBy: number;
  rounds: DuelDiceRound[];
  /** Rank groups, highest first. Only groups with more than one seat roll again. */
  groups: number[][];
  /** Rank to original lobby seat; null while any rank is tied. */
  order: number[] | null;
}

export interface DuelDiceOpeningView {
  phase: "dice" | "start";
  round: number;
  serverNow: number;
  deadlineAt: string;
  rounds: DuelDiceRound[];
  /** Final turn order, expressed as the original lobby seats. */
  order: number[] | null;
  /** Indexed by original lobby seat: the player's public seat after the move. Null until resolved. */
  finalSeats: number[] | null;
}

function rollRound(state: DuelDiceOpeningState, at: number, rollDie: () => number): DuelDiceOpeningState {
  const rolls: Array<number | null> = Array(state.groups.flat().length).fill(null);
  const groups = state.groups.flatMap((group) => {
    if (group.length === 1) return [group];
    const byRoll = new Map<number, number[]>();
    for (const seat of group) {
      const value = rollDie();
      if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error("Invalid d6 roll");
      rolls[seat] = value;
      const tied = byRoll.get(value) ?? [];
      tied.push(seat);
      byRoll.set(value, tied);
    }
    return [...byRoll.entries()].sort(([a], [b]) => b - a).map(([, tied]) => tied);
  });
  const round = state.round + 1;
  return {
    ...state, round, deadline: at + DUEL_DICE_REVEAL_MS,
    rounds: [...state.rounds, { round, rolls }], groups,
    order: groups.every((group) => group.length === 1) ? groups.flat() : null,
  };
}

export function newDiceOpening(startedBy: number, seatCount: number, at: number, rollDie: () => number): DuelDiceOpeningState {
  if (seatCount !== 3 && seatCount !== 4) throw new Error("Dice opening requires FFA3 or FFA4");
  return rollRound({
    phase: "dice", round: 0, deadline: at, startedBy, rounds: [],
    groups: [Array.from({ length: seatCount }, (_, seat) => seat)], order: null,
  }, at, rollDie);
}

export function settleDiceOpening(state: DuelDiceOpeningState, at: number, rollDie?: () => number): DuelDiceOpeningState {
  if (state.phase === "start" || at < state.deadline) return state;
  if (state.order) return { ...state, phase: "start" };
  if (!rollDie) throw new Error("Dice opening requires a server die source");
  return rollRound(state, at, rollDie);
}

export function diceOpeningView(state: DuelDiceOpeningState, serverNow: number): DuelDiceOpeningView {
  const finalSeats = state.order?.map((_, lobbySeat) => state.order!.indexOf(lobbySeat)) ?? null;
  return {
    phase: state.phase, round: state.round, serverNow,
    deadlineAt: new Date(state.deadline).toISOString(), rounds: state.rounds,
    order: state.order, finalSeats,
  };
}
