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
