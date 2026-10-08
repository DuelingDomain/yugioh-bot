import { expect, it, vi } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { waiting } from "./helpers/script-error-repro.js";
import { queryErrorOptions } from "./helpers/query-error-repro.js";

describeWithCores("card callbacks in views", [needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("%s: repeated queries stay private and three subsequent answers succeed", async (engine) => {
    const report = vi.fn();
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({ ...queryErrorOptions(), onScriptError: report });
    try {
      const first = game.view(null);
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 15025844, source: "query" }));
      for (let i = 0; i < 5; i++) expect(game.view(null)).toEqual(first);
      expect(first.events.filter(event => event.kind === "script-error")).toHaveLength(0);
      for (let i = 0; i < 3; i++) {
        const next = waiting(game);
        expect(() => game.answer(next.seat, next.prompt.id, chooseSurrenderedAnswer(next.prompt))).not.toThrow();
      }
      expect(game.view(null).result).toBeNull();
    } finally { game.close(); }
  });
});
