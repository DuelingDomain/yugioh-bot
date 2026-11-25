import { expect } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";

const BATTLE_OX = 5053103;
const SHATRANGA = 42410161;
const setup = `
local shatranga=Debug.AddCard(${SHATRANGA},1,1,LOCATION_SZONE,0,POS_FACEUP)
local spell=Effect.CreateEffect(shatranga)
spell:SetType(EFFECT_TYPE_SINGLE)
spell:SetCode(EFFECT_CHANGE_TYPE)
spell:SetValue(TYPE_SPELL|TYPE_CONTINUOUS)
shatranga:RegisterEffect(spell)

local function add_activation(seat,kind,code)
  local monster=Debug.AddCard(${BATTLE_OX},seat,seat,LOCATION_MZONE,0,POS_FACEUP_ATTACK)
  local activation=Effect.CreateEffect(monster)
  activation:SetType(kind)
  activation:SetCode(code)
  activation:SetRange(LOCATION_MZONE)
  if kind==EFFECT_TYPE_QUICK_O then
    activation:SetCondition(function() return Duel.MPChainCount()>0 end)
  end
  monster:RegisterEffect(activation)
end
add_activation(0,EFFECT_TYPE_IGNITION,0)
add_activation(2,EFFECT_TYPE_QUICK_O,EVENT_FREE_CHAIN)
`;

itWithCores("Shatranga limits each FFA opponent to five monster activations per turn", [
  needs.installedMulti(), needs.cards(), needs.scripts(),
], async () => {
  const deck = { main: Array<number>(20).fill(BATTLE_OX), extra: [], side: [] };
  const game = await createEngineGame({
    format: "ffa3", mode: "normal", masterRule: 5, dataDirectory: engineDataDirectory,
    decks: [deck, deck, deck], seed: ["1", "2", "3", "4"], firstTurnDraw: false,
    scriptErrorMode: "strict", startupScripts: [{ name: "shatranga-test.lua", content: setup }],
  });
  const activate = (seat: number) => {
    const prompt = game.view(seat).prompt;
    const choice = prompt?.options.find(option => option.card?.code === BATTLE_OX
      && (option.id.startsWith("activate:") || option.id.startsWith("card:")));
    expect(choice, `seat ${seat} can activate its monster effect`).toBeDefined();
    game.answer(seat, prompt!.id, { choice: choice!.id });
  };
  const pass = () => game.answer(2, game.view(2).prompt!.id, { cancel: true });

  try {
    // Five links across both seats: seat 0 still has four activations and seat 2 has one.
    activate(0);
    for (let i = 0; i < 4; i++) activate(2);
    if (game.view(2).prompt) pass();
    for (let i = 0; i < 3; i++) {
      activate(0);
      pass();
    }
    activate(0);
    activate(2);
    // Each opponent has now activated five times. With no legal responses, we return to the idle menu.
    const idle = game.view(0).prompt!;
    expect(idle.options.map(option => option.id)).toContain("to_ep");
    expect(idle.options.some(option => option.id.startsWith("activate:"))).toBe(false);

    game.answer(0, idle.id, { choice: "to_ep" });
    for (const seat of [1, 2]) {
      game.answer(seat, game.view(seat).prompt!.id, { choice: "to_ep" });
    }
    expect(game.view(0).turn).toBe(4);
    activate(0);
    activate(2);
  } finally {
    game.close();
  }
});
