import { expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { compileBoard } from "../../support/board.js";
import { createEngineGame } from "../../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../../src/practice-bot.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { CHICKEN_GAME_SCENARIOS } from "./chicken-game.js";
import { createEngineGame as createMultiEngineGame } from "../../../src/engine.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import type { Scenario } from "../../support/dsl.js";

async function runChickenGame(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const preserveEffect = scenario.tags.includes("preserve-change-damage") ? "EFFECT_CHANGE_DAMAGE"
    : scenario.tags.includes("preserve-no-effect-damage") ? "EFFECT_NO_EFFECT_DAMAGE" : null;
  const game = await createMultiEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    seed: ["1", "2", "3", "4"],
    startupScripts: [...compiled.options.startupScripts!, ...(preserveEffect ? [{ name: "pseudo-space-existing-effect.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_FZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD)
e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
e:SetCode(${preserveEffect})
e:SetRange(LOCATION_FZONE)
e:SetOwnerPlayer(Duel.MPActionSeat(1))
e:SetAbsoluteRange(e:GetOwnerPlayer(),1,0)
e:SetValue(0)
c:RegisterEffect(e)
${preserveEffect === "EFFECT_NO_EFFECT_DAMAGE" ? `
-- NO_EFFECT_DAMAGE is a Lua hint, not a core damage replacement. Check that
-- the original effect survives the real copy and mark completion with 100 LP.
local retained=e
local check=Effect.CreateEffect(c)
check:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
check:SetRange(LOCATION_FZONE)
check:SetCode(EVENT_CHAIN_END)
check:SetOperation(function(e)
  local found=false
  for _,owned in ipairs({c:GetOwnEffects()}) do if owned==retained then found=true end end
  assert(found,"Copying Chicken Game removed a pre-existing EFFECT_NO_EFFECT_DAMAGE")
  Duel.Recover(0,100,REASON_EFFECT)
  e:Reset()
end)
c:RegisterEffect(check)
` : ""}
` }] : [])],
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}

describeWithCores("live Chicken Game damage protection", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/chicken-game", CHICKEN_GAME_SCENARIOS, runChickenGame);
});

describeWithCores("legacy 1v1 Chicken Game", [needs.cards(), needs.scripts()], () => {
  it.each([[7000, 8000, 7500], [8000, 7000, 7000], [8000, 8000, 7500]])(
    "keeps stock protection at %i vs %i LP", async (own, other, expected) => {
      const compiled = compileBoard({ skipOpeningDraw: true,
        p0: { lp: own, field: "Chicken Game", hand: ["Hinotama"] }, p1: { lp: other } });
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"] });
      try {
        let activated = false, resolved = false;
        for (let n = 0; n < 100; n++) {
          const view = game.view(null);
          const prompt = [game.view(0).prompt, game.view(1).prompt].find(p => p != null);
          if (!prompt) throw new Error("Expected a waiting prompt");
          if (activated && view.phase === "main1" && prompt.options.some(o => o.id === "to_ep")) {
            resolved = true;
            break;
          }
          const activation = prompt.options.find(o => o.id.startsWith("activate:") && o.card?.code === 46130346);
          if (activation && !activated) {
            activated = true;
            game.answer(prompt.seat, prompt.id, { choice: activation.id });
          } else game.answer(prompt.seat, prompt.id, choosePracticeBotAnswer(prompt));
        }
        expect(activated).toBe(true);
        expect(resolved).toBe(true);
        expect(game.view(null).seats[1].lp).toBe(expected);
        expect(game.view(null).seats[0].lp).toBe(own);
      } finally { game.close(); }
    },
  );
});
