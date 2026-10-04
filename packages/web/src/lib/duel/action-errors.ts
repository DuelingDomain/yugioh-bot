import { DuelRequestError } from "@/components/duel/api";

/** Server texts (duel-server host.ts) that have a friendlier notice. Matched exactly, so a new server text is shown as sent. */
const NO_ELIMINATE_CORE = "This engine cannot eliminate a surrendering duelist";
const STALE_CHOICE = "That choice is stale. Refresh the current duel state.";

export const SURRENDER_UNSUPPORTED_NOTICE = "This duel can't accept a surrender right now.";
export const CHOICE_CLOSED_NOTICE = "That choice is no longer open.";
export const ANSWER_REJECTED_NOTICE = "That choice is no longer open. Pick again.";

/**
 * Short notice for a failed duel request. `seatPick` is true for an answer to an opponent pick or a direct-attack
 * pick: the server sends a plain 400 for a seat the engine no longer accepts (for example a seat that left), with
 * no code, so the notice stays general. Any other error, and a 400 on any other request, keeps its own text.
 */
export function duelActionErrorText(err: unknown, options: { seatPick?: boolean } = {}): string {
  if (!(err instanceof DuelRequestError)) return err instanceof Error ? err.message : "Action failed";
  if (err.status === 409 && err.message === NO_ELIMINATE_CORE) return SURRENDER_UNSUPPORTED_NOTICE;
  if (err.status === 409 && err.message === STALE_CHOICE) return CHOICE_CLOSED_NOTICE;
  if (err.status === 400 && options.seatPick) return ANSWER_REJECTED_NOTICE;
  return err.message;
}
