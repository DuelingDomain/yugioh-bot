import type { DuelEngineView } from "@yugidraft/shared/duels";

export type FieldActivity = { turnSeat: number | null; prioritySeat: number | null };

/** Turn ownership and the pending engine decision are independent, especially during chains. */
export function deriveFieldActivity(engine: DuelEngineView | null, animationsPlaying = false): FieldActivity {
  if (!engine || engine.turn < 1 || engine.result) return { turnSeat: null, prioritySeat: null };
  const onField = (seat: number | null | undefined) =>
    seat != null && engine.seats.some((view) => view.seat === seat) ? seat : null;
  // Legacy snapshots can establish only the visible prompt's owner. Never guess from the turn.
  const pending = engine.prioritySeat === undefined ? engine.prompt?.seat : engine.prioritySeat;
  return {
    turnSeat: onField(engine.turnSeat),
    prioritySeat: animationsPlaying ? null : onField(pending),
  };
}
