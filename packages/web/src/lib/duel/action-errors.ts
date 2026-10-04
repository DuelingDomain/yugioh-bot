import { DuelRequestError } from "@/components/duel/api";

/** Server texts (duel-server host.ts) that have a friendlier notice. Matched exactly, so a new server text is shown as sent. */
const NO_ELIMINATE_CORE = "This engine cannot eliminate a surrendering duelist";
const STALE_CHOICE = "That choice is stale. Refresh the current duel state.";
const SEAT_LEFT_ERROR_CODE = "seat_left";
const SEAT_LEFT_NOTICE = "That player has left. Pick again.";

export const SURRENDER_UNSUPPORTED_NOTICE = "This duel can't accept a surrender right now.";
export const CHOICE_CLOSED_NOTICE = "That choice is no longer open.";
export const ANSWER_REJECTED_NOTICE = "That choice is no longer open. Pick again.";

/**
 * Short notice for a failed duel request. `seatPick` is true for an answer to an opponent pick or a direct-attack
 * pick. A seat-left code or exact text gets its notice on any answer. Older servers send a plain 400 for a seat
 * the engine no longer accepts, so the seat-pick fallback stays general. Other errors keep their own text.
 */
export function duelActionErrorText(err: unknown, options: { seatPick?: boolean } = {}): string {
  if (!(err instanceof DuelRequestError)) return err instanceof Error ? err.message : "Action failed";
  if (err.code === SEAT_LEFT_ERROR_CODE || err.message === SEAT_LEFT_NOTICE) return SEAT_LEFT_NOTICE;
  if (err.status === 409 && err.message === NO_ELIMINATE_CORE) return SURRENDER_UNSUPPORTED_NOTICE;
  if (err.status === 409 && err.message === STALE_CHOICE) return CHOICE_CLOSED_NOTICE;
  if (err.status === 400 && options.seatPick) return ANSWER_REJECTED_NOTICE;
  return err.message;
}
