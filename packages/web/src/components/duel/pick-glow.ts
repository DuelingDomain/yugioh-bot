/**
 * How a legal or selected zone is drawn. Every card glows: a card on the board, in your hand, in a pile or in the
 * Deck Master dock, whether it can be used now or is picked in a pick. Only an empty zone (a place to put a card)
 * keeps its dashed outline, as it is a zone and not a card.
 */
export function zoneMarkLook(zone: { occupied: boolean }): "glow" | "ring" {
  return zone.occupied ? "glow" : "ring";
}
