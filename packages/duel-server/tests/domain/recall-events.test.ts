import { describe, expect, it } from "vitest";
import { act, gameFor, variants } from "./helpers.js";

const MOVE = 888112010;
const OBSERVER = 888112011;
const AXE = 48305365;
const LINK = 98978921;
const destinations = [
  { name: "GY", location: "LOCATION_GRAVE", operation: "Duel.SendtoGrave(g,REASON_EFFECT)" },
  { name: "GY (leave-GY event)", location: "LOCATION_GRAVE", operation: "Duel.SendtoGrave(g,REASON_EFFECT)", event: "EVENT_LEAVE_GRAVE" },
  { name: "banishment", location: "LOCATION_REMOVED", operation: "Duel.Remove(g,POS_FACEUP,REASON_EFFECT)" },
  { name: "hand", location: "LOCATION_HAND", operation: "Duel.SendtoHand(g,nil,REASON_EFFECT)" },
  { name: "Deck", location: "LOCATION_DECK", operation: "Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_EFFECT)" },
  { name: "Extra Deck", location: "LOCATION_EXTRA", operation: "Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_EFFECT)", link: true },
];

for (const variant of variants) describe(`Domain recall events (${variant.name})`, () => {
  for (const destination of destinations) it(`return from ${destination.name} starts a departure trigger chain with the previous zone and rule reason`, async () => {
    const master = destination.link ? LINK : AXE;
    const game = await gameFor(variant, { p0: { deckMaster: master, hand: [OBSERVER], spells: [MOVE], ...(destination.link ? { monsters: ["Mystical Elf"] } : {}) } }, [
      { id: MOVE, type: 0x20002, lua: `
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_IGNITION)
 e:SetRange(LOCATION_SZONE)
 e:SetOperation(function(e,tp)
  local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${master})
  ${destination.operation}
 end)
 c:RegisterEffect(e)
end` },
      { id: OBSERVER, type: 0x21, lua: `
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
 e:SetProperty(EFFECT_FLAG_DELAY)
 e:SetRange(LOCATION_HAND)
 e:SetCode(${destination.event ?? "EVENT_MOVE"})
 e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
  return re==nil and (r&REASON_RULE)~=0 and ep==tp and rp==PLAYER_NONE and eg:IsExists(function(c)
   return c:IsCode(${master}) and c:IsPreviousLocation(${destination.location}) and c:IsLocation(LOCATION_DECKMASTER) and c:IsReason(REASON_RULE) and c:GetReasonEffect()==nil and c:GetReasonPlayer()==rp
  end,1,nil)
 end)
 e:SetOperation(function(e,tp) Duel.Recover(tp,123,REASON_EFFECT) end)
 c:RegisterEffect(e)
end` },
    ]);
    act(game, master, destination.link ? "spsummon:" : "summon:");
    expect(game.view(0).seats[0].monsters.some(card => card?.code === master)).toBe(true);
    const before = game.view(0).seats[0].lp;
    act(game, MOVE);
    expect(game.view(0).seats[0].deckMaster).toMatchObject({ inZone: true, returns: 1 });
    expect(game.view(0).seats[0].lp).toBe(before + 123);
  });
});
