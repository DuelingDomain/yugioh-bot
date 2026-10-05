/** All card art uses the server cache, timeout and card-back fallback. */
export function cardImageUrl(id: number, variant: "full" | "small" | "cropped" = "full"): string {
  return `/api/cards/${id}/image?variant=${variant}`;
}

/** Draft instance IDs identify picks; their printed passcode identifies the artwork. */
export function cardArtworkId(card: { id: number; passcode?: number }): number {
  return card.passcode ?? card.id;
}
