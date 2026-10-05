import { describe, expect, it } from "vitest";
import { resolveCard } from "../../src/presets/catalog.js";
import { act, gameFor, variants, waiting } from "./helpers.js";

const PROBE = 888112020;
function probe(operation: string, ignore = true) {
  return { id: PROBE, type: 0x20002, lua: `
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_IGNITION)
 e:SetRange(LOCATION_SZONE)
 ${ignore ? "e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)" : ""}
 e:SetOperation(function(e,tp)
  local dm=Duel.GetMatchingGroup(nil,tp,LOCATION_DECKMASTER,0,nil):GetFirst()
  assert(dm,"Deck Master must be in its zone")
  ${operation}
 end)
 c:RegisterEffect(e)
end` };
}
for (const variant of variants) describe(`Domain DMZ immunity (${variant.name})`, () => {
  for (const ignore of [false, true]) it(`blocks another card's ${ignore ? "ignore-immunity" : "ordinary"} effect from moving the DM`, async () => {
    const game = await gameFor(variant, { p0: { spells: [PROBE] } }, [probe("Duel.SendtoGrave(dm,REASON_EFFECT)", ignore)]);
    act(game, PROBE);
    expect(game.view(0).seats[0].deckMaster).toMatchObject({ inZone: true, returns: 0 });
    expect(game.view(0).seats[0].graveyard).toEqual([]);
  });

  it("rejects effect targeting even when the other card ignores immunity", async () => {
    const game = await gameFor(variant, { p0: { spells: [PROBE] } }, [probe("if not dm:IsCanBeEffectTarget(e) then Duel.Recover(tp,123,REASON_EFFECT) end")]);
    const before = game.view(0).seats[0].lp;
    act(game, PROBE);
    expect(game.view(0).seats[0].lp).toBe(before + 123);
  });

  it("does not admit another card's summon procedure through the immunity exception", async () => {
    const game = await gameFor(variant, { p0: { spells: [PROBE] } }, [probe(`
     local proc=Effect.CreateEffect(e:GetHandler())
     proc:SetType(EFFECT_TYPE_FIELD)
     proc:SetCode(EFFECT_SPSUMMON_PROC)
     proc:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
     if dm:IsImmuneToEffect(proc) then Duel.Recover(tp,123,REASON_EFFECT) end`)]);
    const before = game.view(0).seats[0].lp;
    act(game, PROBE);
    expect(game.view(0).seats[0].lp).toBe(before + 123);
  });

  for (const check of ["IsImmuneToEffect(domain_foreign_proc)", "IsHasEffect(EFFECT_SUMMON_PROC)==nil", "IsSummonable(true,domain_foreign_proc)==false"]) {
    it(`blocks a foreign-owned procedure registered on the DM: ${check}`, async () => {
      const game = await gameFor(variant, { p0: { spells: [PROBE] } }, [probe(`if dm:${check} then Duel.Recover(tp,123,REASON_EFFECT) end`)], `
local dm=Duel.GetMatchingGroup(nil,0,LOCATION_DECKMASTER,0,nil):GetFirst()
local source=Duel.GetFieldCard(0,LOCATION_SZONE,0)
domain_foreign_proc=Effect.CreateEffect(source)
domain_foreign_proc:SetType(EFFECT_TYPE_SINGLE)
domain_foreign_proc:SetCode(EFFECT_SUMMON_PROC)
domain_foreign_proc:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
domain_foreign_proc:SetCondition(aux.TRUE)
domain_foreign_proc:SetValue(SUMMON_TYPE_NORMAL)
dm:RegisterEffect(domain_foreign_proc,true)`);
      const before = game.view(0).seats[0].lp;
      act(game, PROBE);
      expect(game.view(0).seats[0].lp).toBe(before + 123);
    });
  }

  it("does not offer a foreign-owned field Special Summon procedure registered on the DM", async () => {
    const game = await gameFor(variant, { p0: { spells: [PROBE] } }, [probe("")], `
local dm=Duel.GetMatchingGroup(nil,0,LOCATION_DECKMASTER,0,nil):GetFirst()
local source=Duel.GetFieldCard(0,LOCATION_SZONE,0)
local proc=Effect.CreateEffect(source)
proc:SetType(EFFECT_TYPE_FIELD)
proc:SetCode(EFFECT_SPSUMMON_PROC)
proc:SetRange(LOCATION_HAND)
proc:SetCondition(aux.TRUE)
proc:SetValue(SUMMON_TYPE_SPECIAL)
dm:RegisterEffect(proc,true)`);
    expect(waiting(game).options.some(option => option.id.startsWith("spsummon:") && option.card?.code === resolveCard("Axe Raider"))).toBe(false);
  });

  for (const master of ["Axe Raider", "Summoned Skull", "Jester Confit", "Link Spider", "Flame Swordsman"]) {
    it(`keeps the valid leave method for ${master}`, async () => {
      const fusion = master === "Flame Swordsman";
      const special = master === "Jester Confit" || master === "Link Spider";
      const game = await gameFor(variant, { p0: { deckMaster: master,
        monsters: master === "Summoned Skull" || master === "Link Spider" ? ["Mystical Elf"] : [],
        hand: fusion ? ["Instant Fusion"] : [] } });
      act(game, resolveCard(fusion ? "Instant Fusion" : master), fusion ? "activate:" : special ? "spsummon:" : "summon:");
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(false);
      expect(game.view(0).seats[0].monsters.some(card => card?.code === resolveCard(master))).toBe(true);
    });
  }
});
