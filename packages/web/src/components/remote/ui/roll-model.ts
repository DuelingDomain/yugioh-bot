import type { RemoteEvent } from "@yugidraft/shared/remote";

/** The spin or tumble of a coin or die, from the roll time on the server clock. */
export const ROLL_SPIN_MS = 1200;
/** How long a coin or die shows on every screen: the spin, about 2 s of result, and a short fade. */
export const ROLL_HOLD_MS = 3500;
export type RollHold = { eventId: string; seat: number; kind: "coin" | "die"; result: number; at: number; until: number };

const COIN_FACE = ["", "Heads", "Tails"] as const;
/** The words of a result: "Heads", "Tails" or the die number. */
export const rollWord = (kind: "coin" | "die", result: number) => kind === "coin" ? COIN_FACE[result] ?? "?" : String(result);
/** The log line of a roll. `who` is the roller's name. */
export const rollLine = (who: string, kind: "coin" | "die", result: number) => kind === "coin" ? `${who} flipped a coin: ${rollWord(kind, result)}` : `${who} rolled a die: ${result}`;

/** The newest roll that still shows. `now` is on the server clock, like `event.at`.  A roll cannot be undone. */
export function activeRoll(events: readonly RemoteEvent[], now: number): RollHold | null {
  const event = events.findLast(item => item.action.type === "random.roll");
  const action = event?.action;
  if (!event || action?.type !== "random.roll" || action.result === undefined || event.actorSeat === null) return null;
  const until = event.at + ROLL_HOLD_MS;
  return until > now ? { eventId: event.id, seat: event.actorSeat, kind: action.kind, result: action.result, at: event.at, until } : null;
}

