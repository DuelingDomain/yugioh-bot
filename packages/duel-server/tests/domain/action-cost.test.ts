import { describe, expect, it } from "vitest";
import { act, gameFor, variants } from "./helpers.js";

const RECALL = 888112001;
const PENDULUM = 15146890; // Dragonpulse Magician, a Main Deck Pendulum monster.
const ECONOMICS = 4259068;
const recall = { id: RECALL, type: 0x20002, lua: `
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_IGNITION)
 e:SetRange(LOCATION_SZONE)
 e:SetOperation(function(e,tp)
  local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_ONFIELD,0,nil,${PENDULUM})
  Duel.SendtoHand(g,nil,REASON_EFFECT)
 end)
 c:RegisterEffect(e)
end` };

for (const variant of variants) describe(`Domain action cost (${variant.name})`, () => {
  const baseLp = variant.format === "tag" ? 16000 : 8000;
  it("Spell Economics keeps the cumulative 500/1000 LP cost of activating a returned Pendulum DM", async () => {
    const game = await gameFor(variant, { p0: { deckMaster: PENDULUM, spells: [ECONOMICS, RECALL] } }, [recall]);
    act(game, PENDULUM);
    expect(game.view(0).seats[0].lp).toBe(baseLp);
    for (let returns = 1; returns <= 2; returns++) {
      act(game, RECALL);
      expect(game.view(0).seats[0].deckMaster).toMatchObject({ inZone: true, returns, nextCost: 500 * returns });
      act(game, PENDULUM);
      expect(game.view(0).seats[0].lp).toBe(baseLp - 500 * returns * (returns + 1) / 2);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(false);
    }
  });

  it("Chain Energy still charges 500 LP for a monster summoned from the hand alongside Spell Economics", async () => {
    const game = await gameFor(variant, { p0: { spells: ["Chain Energy", ECONOMICS], hand: ["Mystical Elf"] } });
    act(game, 15025844, "summon:");
    expect(game.view(0).seats[0].lp).toBe(baseLp - 500);
  });
});
