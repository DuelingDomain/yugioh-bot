import { OcgResponseType, type OcgResponse, type SelectFieldPlace } from "ocgcore-wasm";
import { EngineAnswerError } from "./engine-answer-error.js";

/**
 * ocgcore-wasm writes a SORT_CARD response as [length, ...indices]. Both cores read the indices from
 * byte 0 (`returns.at<int8_t>(i)` for each of the m cards, or -1 for "keep the order"), so the length
 * byte makes every answer with an order fail with a RETRY. SELECT_PLACE is the one response type the
 * library writes as plain bytes, so the order goes out as fake places: each place is three bytes.
 * The core ignores the padding after the first m bytes. This changes only wire encoding, not rules.
 *
 * Version 1 accepts client click order (card indices by destination rank) and inverts it to the
 * destination rank of each original card. Version 0 preserves the bytes used by unversioned journals,
 * including their historical wrong deck order. Never invert the persisted client answer itself.
 */
export function sortCardResponse(order: number[] | null, sortOrderVersion: 0 | 1 = 1): OcgResponse {
  if (order !== null && (new Set(order).size !== order.length
    || [...order].some(index => !Number.isInteger(index) || index < 0 || index >= order.length))) {
    throw new EngineAnswerError("Invalid answer");
  }
  if (!order || order.length <= 1) return { type: OcgResponseType.SORT_CARD, order: null };
  const padded = [...order];
  if (sortOrderVersion === 1) order.forEach((cardIndex, rank) => { padded[cardIndex] = rank; });
  while (padded.length % 3 !== 0) padded.push(0);
  const places: SelectFieldPlace[] = [];
  for (let at = 0; at < padded.length; at += 3) {
    places.push({ player: padded[at]!, location: padded[at + 1]!, sequence: padded[at + 2]! } as unknown as SelectFieldPlace);
  }
  return { type: OcgResponseType.SELECT_PLACE, places };
}
