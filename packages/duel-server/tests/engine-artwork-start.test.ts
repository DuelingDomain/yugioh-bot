import { expect, it } from "vitest";
import type { DuelDeck, DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const settings = { visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const,
  turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const,
  validateDeck: false, shuffleDeck: false };
const artworks = [46986415, 36996508, 27847700];

// The core inserts every main-deck card before starting; each selected artwork's
// script is exercised even if it is not drawn. Engine script errors throw at start.
for (const engine of ["legacy", "pinned", "ffa3"] as const) {
  const required = [needs.cards(dataDirectory), needs.scripts(dataDirectory)];
  if (engine === "pinned") required.push(needs.standard(dataDirectory));
  if (engine === "ffa3") required.push(needs.installedMulti(dataDirectory));
  describeWithCores(`alternate artwork startup on ${engine}`, required, () => {
    it("starts with all three artwork passcodes without Missing script errors", async () => {
      const format: DuelFormat = engine === "ffa3" ? "ffa3" : "1v1";
      const deck = (): DuelDeck => ({ main: [...artworks, ...Array<number>(37).fill(89631139)], extra: [], side: [] });
      const start = engine === "legacy" ? createLegacyEngineGame : createEngineGame;
      const game = await start({ mode: "normal", format, dataDirectory, settings,
        seed: ["1", "2", "3", "4"], decks: Array.from({ length: format === "ffa3" ? 3 : 2 }, deck) });
      try {
        const view = game.view(0);
        expect(view.turn).toBeGreaterThan(0);
        expect(view.prompt).not.toBeNull();
        expect(JSON.stringify(view.log)).not.toContain("Missing script");
        expect(view.seats).toHaveLength(format === "ffa3" ? 3 : 2);
      } finally { game.close(); }
    });
  });
}
