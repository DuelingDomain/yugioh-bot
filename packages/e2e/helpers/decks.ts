import { cardCode } from "./cards";

export type DeckSpec = {
  /** Main Deck, top card first. With "Not shuffled" the first cards are the opening hand. */
  main: string[];
  extra?: string[];
  /** Domain format only. */
  deckMaster?: string;
};

/** A neutral Normal Monster that has no effect. Pads a deck so the opening hand stays exact. */
export const FILLER = "Gene-Warped Warwolf";

/** Pads the main deck with filler so a deck is long enough for the opening hand and later draws. */
export function withFiller(main: string[], size = 12): string[] {
  return [...main, ...Array.from({ length: Math.max(0, size - main.length) }, () => FILLER)];
}

/** A .ydk upload payload for Playwright `setInputFiles`. */
export function ydkUpload(deck: DeckSpec): { name: string; mimeType: string; buffer: Buffer } {
  const lines = ["#created by yugidraft-e2e", "#main", ...deck.main.map((name) => String(cardCode(name))), "#extra", ...(deck.extra ?? []).map((name) => String(cardCode(name))), "!side"];
  if (deck.deckMaster) lines.push("#deckmaster", String(cardCode(deck.deckMaster)));
  return { name: "e2e-deck.ydk", mimeType: "text/plain", buffer: Buffer.from(lines.join("\n") + "\n") };
}
