import { resolve } from "node:path";

export type CardImageSource = "ygoprodeck" | "ignis";

/** Flat versioned keys remain visible to the existing size-based cache cleanup. */
export function cardImageCachePath(filename: string, source: CardImageSource): string {
  return resolve(process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images", `v2-${source}-${filename}`);
}
