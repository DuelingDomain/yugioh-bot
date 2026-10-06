import type { DuelDeck } from "./index.js";

/** Engine-verified family; artwork identity requires the same name and type along every alias edge. */
export interface CardArtworkFamily {
  passcode: number;
  artworks: Array<{ passcode: number; isMain: boolean }>;
}

/** Null means there is no local metadata or cached image for that variant. */
export interface SelectableCardArtwork {
  passcode: number;
  isMain: boolean;
  imageUrl: string | null;
  smallUrl: string | null;
  croppedUrl: string | null;
}

export interface CardArtworksResponse {
  passcode: number;
  artworks: SelectableCardArtwork[];
}

/** One occurrence in an unsaved working deck. Deck Master uses index 0. */
export interface DeckArtworkSwapRequest {
  deck: DuelDeck;
  section: "main" | "extra" | "side" | "deckMaster";
  index: number;
  from: number;
  to: number;
}
