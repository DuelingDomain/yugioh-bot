// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/engine-first-seat.test.ts from origin/main (78b8caa)
// with only the import paths changed: engine, views and prompts come from ../../src/legacy, the other sources from ../../src, and
// the data dir helper from ../engine-data-dir.js. Do not edit it to make the legacy engine pass: the legacy engine must match the approved legacy pin. See legacy-1v1/README.md.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { createEngineGame } from "../../src/legacy/engine.js";
import { engineDataDirectory } from "../engine-data-dir.js";

function vanillaDeck(): DuelDeck {
  const cdb = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  try {
    const rows = cdb
      .prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id LIMIT 40")
      .all() as { id: number }[];
    return { main: rows.map((row) => row.id), extra: [], side: [] };
  } finally {
    cdb.close();
  }
}

describe("engine seat order", () => {
  // Series rules rely on it: createNextGame puts the previous loser in seat 0 so that player goes first.
  it("always gives seat 0 the first turn and the first prompt, whatever the seed", async () => {
    const deck = vanillaDeck();
    for (let n = 1; n <= 12; n++) {
      const seed = [String(n), String(n * 7919), String(n * 104729), String(n * 1299709)];
      const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed, dataDirectory: engineDataDirectory });
      try {
        const view = game.view(0);
        expect(view.turn, `seed ${n}`).toBe(1);
        expect(view.turnSeat, `seed ${n}`).toBe(0);
        expect(view.prompt?.seat, `seed ${n}`).toBe(0);
        expect(game.view(1).prompt, `seed ${n}`).toBeNull();
      } finally {
        game.close();
      }
    }
  });
});
