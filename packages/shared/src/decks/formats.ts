// placeholder: backend version wins at merge.
// Minimal stand-in so the deck-import UI branch typechecks. The backend branch owns the real module.

export type DeckSections = { main: number[]; extra: number[]; side: number[]; deckMaster?: number | null };

function encodeSection(codes: number[]): string {
  // No Buffer: the web client imports this module in the browser.
  const view = new DataView(new ArrayBuffer(codes.length * 4));
  codes.forEach((code, index) => view.setUint32(index * 4, code, true));
  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)));
}

/** "ydke://<main>!<extra>!<side>!" in standard base64 of little-endian uint32 passcodes. deckMaster is not part of YDKE and is ignored. */
export function encodeYdke(deck: DeckSections): string {
  return `ydke://${encodeSection(deck.main)}!${encodeSection(deck.extra)}!${encodeSection(deck.side)}!`;
}
