import { expect, it, vi } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { waiting } from "./helpers/script-error-repro.js";

describeWithCores("repeated runtime errors", [needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("%s: coalesces an error flood and continues later answers", async engine => {
    const report = vi.fn();
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({
      mode: "normal", decks: Array.from({ length: 2 }, () => ({ main: Array(20).fill(15025844), extra: [], side: [] })),
      seed: ["1", "2", "3", "4"], dataDirectory: DATA, onScriptError: report,
      startupScripts: [{ name: "noise-fixture.lua", content: `assert(load([=[
for i=1,40 do
 local e=Effect.GlobalEffect()
 e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
 e:SetCode(EVENT_ADJUST)
 e:SetOperation(function() noise_fixture_missing.failure() end)
 Duel.RegisterEffect(e,0)
end
]=], 'c15025844.lua'))()` }],
    });
    try {
      expect(game.view(null).events.filter(event => event.kind === "script-error")).toHaveLength(1);
      expect(report).toHaveBeenCalledTimes(20);
      for (let i = 0; i < 3; i++) {
        const before = game.view(null).events.filter(event => event.kind === "script-error").length;
        const next = waiting(game);
        game.answer(next.seat, next.prompt.id, chooseSurrenderedAnswer(next.prompt));
        expect(game.view(null).events.filter(event => event.kind === "script-error").length - before).toBeLessThanOrEqual(1);
        expect(game.view(null).result).toBeNull();
      }
      expect(report).toHaveBeenCalledTimes(20);
    } finally { game.close(); }
  });
});
