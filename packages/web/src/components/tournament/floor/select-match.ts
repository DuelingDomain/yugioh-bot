/*
 * Which of your open matches the field shows. A round robin makes every round at the start, so you can have
 * several open matches. The crosstable and the road sit in other parts of the page than the field, so they ask
 * for a match with a window event and the field (LiveView) listens.
 */

export const SELECT_MATCH_EVENT = "tournament:select-match";

/** Ask the field to show this match. Does nothing when the field is not on the page or the match is not yours. */
export function requestMatch(matchId: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(SELECT_MATCH_EVENT, { detail: matchId }));
}
