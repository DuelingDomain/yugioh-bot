import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface OverlayCard {
  code: number;
  kind?: string;
  /** Text of cNNN.lua. */
  text: string;
}

const made: string[] = [];

/** The stub of the repo (domain-core/multi-scripts/mp-utility.lua): the flag first, then the guard. */
export const STUB_UTILITY = "MP_OVERLAY_ACTIVE = true\nif not Duel.MPBindOpponent then return end\n";

/** Writes an overlay folder (mp-utility.lua, MANIFEST.json, one cNNN.lua per card) into a temp folder. */
export function makeOverlay(cards: OverlayCard[] = [], options: { utility?: string | null; files?: Record<string, string> } = {}): string {
  const directory = mkdtempSync(join(tmpdir(), "multi-scripts-"));
  made.push(directory);
  if (options.utility !== null) writeFileSync(join(directory, "mp-utility.lua"), options.utility ?? STUB_UTILITY);
  const manifest = { version: 1, cards: cards.map((card) => ({ code: card.code, file: `c${card.code}.lua`, kind: card.kind ?? "fix" })) };
  writeFileSync(join(directory, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const card of cards) writeFileSync(join(directory, `c${card.code}.lua`), card.text);
  for (const [name, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

/** Removes every overlay folder made so far. Call it from afterEach / afterAll. */
export function removeOverlays(): void {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
}
