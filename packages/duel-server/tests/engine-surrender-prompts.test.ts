import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { compileBoard } from "./support/board.js";
import { currentDomainMultiWasm, currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

const cases: [string, DuelPrompt["kind"], string][] = [
  ["idle", "choice", "nil"],
  ["yes-no", "choice", "Duel.SelectYesNo(0,30)"],
  ["effect yes-no", "choice", "Duel.SelectEffectYesNo(0,g:GetFirst(),30)"],
  ["option", "choice", "Duel.SelectOption(0,30,31)"],
  ["cards", "cards", "g:Select(0,1,1,nil)"],
  ["nested card selection", "cards", "g:Select(0,1,1,nil)"],
  ["unselect", "toggle", "g:SelectUnselect(Group.CreateGroup(),0,true,true,1,1)"],
  ["place", "places", "Duel.SelectFieldZone(0,1,LOCATION_MZONE,0,0)"],
  ["disabled places", "places", "Duel.SelectDisableField(0,1,LOCATION_MZONE,0,0)"],
  ["position", "choice", "Duel.SelectPosition(0,g:GetFirst(),POS_FACEUP)"],
  ["sum", "sum", "g:SelectWithSumEqual(0,function() return 1 end,1,1,1)"],
  ["nested sum check", "sum", "Group.FromCards(foreign):SelectWithSumEqual(0,function() return 1 end,1,1,1)"],
  ["sort", "order", "(function() Duel.SortDecktop(0,1,3); return Duel.GetDecktopGroup(1,1):GetFirst():GetCode() end)()"],
  ["race", "cards", "Duel.AnnounceRace(0,1,RACE_ALL)"],
  ["attribute", "cards", "Duel.AnnounceAttribute(0,1,ATTRIBUTE_ALL)"],
  ["card", "announce-card", "Duel.AnnounceCard(0)"],
  ["number", "choice", "Duel.AnnounceNumber(0,1,2,3)"],
  ["tribute", "tribute", "Duel.SelectTribute(0,g:GetFirst(),1,1)"],
  ["counters", "counters", `Duel.RemoveCounter(0,1,0,0x1,1,REASON_EFFECT)`],
  ["counter target leaves", "counters", `Duel.RemoveCounter(0,1,0,0x1,1,REASON_EFFECT)`],
  ["counter fallback", "counters", `(function() Duel.MPWindow(1); local answer=Duel.RemoveCounter(0,0,1,0x1,1,REASON_EFFECT); Duel.MPWindowEnd(); return answer end)()`],
  ["retained token counters", "counters", `Duel.RemoveCounter(0,1,0,0x1,1,REASON_COST)`],
  ["rock-paper-scissors", "choice", "Duel.RockPaperScissors(false)"],
];

function holder(game: EngineGame): number {
  const seat = game.view(null).seats.find((s) => game.view(s.seat).prompt)?.seat;
  expect(seat, "a living seat must hold the next prompt").toBeDefined();
  return seat!;
}
function pass(game: EngineGame): void {
  const seat = holder(game);
  const prompt = game.view(seat).prompt!;
  game.answer(seat, prompt.id, chooseSurrenderedAnswer(prompt, {
    permittedCards: prompt.kind === "announce-card" ? game.searchCards("") : undefined,
  }));
}

describeWithCores("surrender at each required prompt with return cleanup", [needs.multi(currentMultiWasm()), ...needs.domainMulti(dataDirectory, currentDomainMultiWasm())], () => {
  for (const mode of ["normal", "domain"] as const) {
    it.each(cases)(`${mode}: %s accepts surrender and the next living answer`, async (_name, kind, call) => {
      const setup = compileBoard({ mode, format: "ffa4",
        p0: { hand: ["Mystical Elf", "Celtic Guardian", "Battle Ox"], monsters: ["Beaver Warrior", "Gemini Elf"], ...(mode === "domain" ? { deckMaster: "Axe Raider" } : {}) },
        p1: { monsters: _name === "counter fallback" ? [] : Array(5).fill("Dark Magician"), ...(_name === "sort" ? { deck: ["Mystical Elf", "Celtic Guardian", "Battle Ox"] } : {}), ...(mode === "domain" ? { deckMaster: "Giant Soldier of Stone" } : {}) },
        p2: { ...(_name === "counter fallback" ? { monsters: Array(5).fill("Dark Magician") } : {}), ...(mode === "domain" ? { deckMaster: "Summoned Skull" } : {}) },
        p3: { ...(mode === "domain" ? { deckMaster: "Gemini Elf" } : {}) },
      });
      const bytes = readFileSync(mode === "domain" ? currentDomainMultiWasm() : currentMultiWasm());
      const game = await createEngineGame({ ...setup.options, dataDirectory, seed: ["1", "2", "3", "4"],
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        startupScripts: [...setup.options.startupScripts!, { name: "surrender-required-prompt.lua", content: `
local foreign=Debug.AddCard(97017120,1,0,LOCATION_MZONE,2,POS_FACEUP_ATTACK,true)
local control=Effect.CreateEffect(foreign)
control:SetType(EFFECT_TYPE_SINGLE); control:SetCode(EFFECT_SET_CONTROL); control:SetValue(0)
control:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); control:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL)
foreign:RegisterEffect(control)
${["nested card selection", "nested sum check"].includes(_name) ? `local nested=Effect.GlobalEffect()
nested:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); nested:SetCode(EVENT_TO_GRAVE)
nested:SetCondition(function(e,tp,eg) return eg:IsExists(function(c) return c:GetCode()==97017120 end,1,nil) end)
nested:SetOperation(function() ${_name === "nested card selection" ? "Duel.GetFieldGroup(1,LOCATION_MZONE,0):Select(1,1,1,nil)" : "Group.FromCards(foreign):CheckWithSumEqual(function() return 2 end,2,1,1)"} end)
Duel.RegisterEffect(nested,1)` : ""}
${["counter target leaves", "retained token counters"].includes(_name) ? `for i=3,4 do
  local c=Debug.AddCard(${_name === "retained token counters" ? "i==4 and 73915052 or 46986414,i==4 and 1 or 0" : "46986414,1"},0,LOCATION_MZONE,i,POS_FACEUP_ATTACK,true)
  local control=Effect.CreateEffect(c); control:SetType(EFFECT_TYPE_SINGLE)
  control:SetCode(EFFECT_SET_CONTROL); control:SetValue(0); control:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
  control:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL); c:RegisterEffect(control)
end
local removed=Effect.GlobalEffect()
removed:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); removed:SetCode(EVENT_REMOVE_COUNTER+0x1)
removed:SetOperation(function() Duel.SetLP(3,6000) end); Duel.RegisterEffect(removed,3)` : ""}
${_name === "counter fallback" ? `local counter_cards=Group.CreateGroup()
for i=0,1 do
  local c=Debug.AddCard(46986414,2,1,LOCATION_MZONE,i,POS_FACEUP_ATTACK,true)
  local control=Effect.CreateEffect(c); control:SetType(EFFECT_TYPE_SINGLE)
  control:SetCode(EFFECT_SET_CONTROL); control:SetValue(1); control:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
  control:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL); c:RegisterEffect(control); counter_cards:AddCard(c)
end
local removed=Effect.GlobalEffect()
removed:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); removed:SetCode(EVENT_REMOVE_COUNTER+0x1)
removed:SetOperation(function() Duel.SetLP(3,6000) end); Duel.RegisterEffect(removed,3)` : ""}
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START|PHASE_MAIN1)
e:SetCondition(function() return Duel.GetTurnCount()==1 end)
e:SetOperation(function()
  local g=Duel.GetFieldGroup(0,LOCATION_HAND,0)
  ${["counters", "counter target leaves", "retained token counters"].includes(_name) ? `for i=${_name === "counters" ? "0,1" : "3,4"} do
    local c=Duel.GetFieldCard(0,LOCATION_MZONE,i)
    local permit=Effect.CreateEffect(c); permit:SetType(EFFECT_TYPE_SINGLE)
    permit:SetCode(EFFECT_COUNTER_PERMIT+0x1); permit:SetRange(LOCATION_MZONE); permit:SetValue(LOCATION_MZONE)
    c:RegisterEffect(permit); c:AddCounter(0x1,1)
  end` : ""}
  ${_name === "counter fallback" ? `for c in aux.Next(counter_cards) do
    local permit=Effect.CreateEffect(c); permit:SetType(EFFECT_TYPE_SINGLE)
    permit:SetCode(EFFECT_COUNTER_PERMIT+0x1); permit:SetRange(LOCATION_MZONE); permit:SetValue(LOCATION_MZONE)
    c:RegisterEffect(permit); c:AddCounter(0x1,1)
  end` : ""}
  local answer=${call}
  ${["yes-no", "effect yes-no", "option"].includes(_name) ? "Duel.SetLP(2,7000+(answer==true and 1 or type(answer)=='number' and answer or 0))" : ""}
  ${["cards", "sum", "tribute"].includes(_name) ? "Duel.SetLP(2,7000+answer:GetFirst():GetCode()%1000)" : ""}
  ${_name === "unselect" ? "Duel.SetLP(2,7000+(answer and answer:GetCode()%1000 or 0))" : ""}
  ${["place", "disabled places", "position", "race", "attribute", "number", "rock-paper-scissors"].includes(_name) ? "Duel.SetLP(2,7000+answer)" : ""}
  ${["sort", "card"].includes(_name) ? "Duel.SetLP(2,7000+answer%1000)" : ""}
  ${_name === "counters" ? "Duel.SetLP(2,answer and 7001 or 7000)" : ""}
  ${_name === "nested card selection" ? "Duel.SetLP(2,7000+answer:GetFirst():GetCode()%1000)" : ""}
  ${["counter target leaves", "counter fallback", "retained token counters"].includes(_name) ? "Duel.SetLP(2,answer and 7001 or 7000)" : ""}
  ${_name === "nested sum check" ? "Duel.SetLP(2,7000+answer:GetCount())" : ""}
end)
${_name === "idle" ? "" : "Duel.RegisterEffect(e,0)"}` }],
      });
      try {
        // Reach the exact required prompt, without answering it.
        for (let step = 0; step < 40; step++) {
          const prompt = game.view(holder(game)).prompt!;
          if (_name === "idle" && holder(game) === 0 && prompt.context?.type === "action") break;
          if (holder(game) === 0 && prompt.context?.type !== "chain" && prompt.context?.type !== "action") break;
          pass(game);
        }
        expect(holder(game)).toBe(0);
        expect(game.view(0).prompt?.kind).toBe(kind);
        if (_name === "idle") expect(game.view(0).prompt?.context).toEqual({ type: "action", phase: "main" });
        expect(game.view(null).chain ?? []).toHaveLength(0);
        const original = game.view(0).prompt!;
        if (["counter target leaves", "counter fallback", "retained token counters"].includes(_name)) {
          game.eliminate(1, 0);
          expect(game.view(null).seats[0].eliminated).toBe(false);
          expect(game.view(null).seats[1].eliminated).toBe(true);
          if (_name === "retained token counters") expect(game.view(null).seats[0].monsters.map((c) => c?.code)).toContain(73915052);
          game.answer(0, original.id, chooseSurrenderedAnswer(original));
          expect(game.view(null).seats[2].lp).toBe(_name === "retained token counters" ? 7001 : 7000);
          expect(game.view(null).seats[3].lp).toBe(_name === "retained token counters" ? 6000 : 8000);
          if (_name === "counter fallback") expect(game.view(null).seats[2].graveyard.map((c) => c.code)).toEqual([46986414,46986414]);
          expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
          pass(game);
          return;
        }
        const automatic = chooseSurrenderedAnswer(original, {
          permittedCards: original.kind === "announce-card" ? game.searchCards("") : undefined,
        });
        const selected = original.options.find((o) => o.id === (automatic.selected?.[0] ?? automatic.choice));
        // The other seat's Deck stays private in the view; its fixture pins the codes.
        const selectedCode = _name === "sort"
          ? setup.options.decks![1].main[Number(automatic.selected![0].split(":")[1])]
          : selected?.card?.code;
        game.eliminate(0, 0);
        if (_name === "nested card selection") {
          expect(holder(game)).toBe(1);
          expect(game.view(1).prompt?.kind).toBe("cards");
          pass(game);
          expect(selectedCode).toBeDefined();
          expect(game.view(null).seats[2].lp).toBe(7000 + selectedCode! % 1000);
        }
        expect(game.view(null).seats[0].eliminated).toBe(true);
        expect(game.view(0).prompt).toBeNull();
        expect(game.view(null).seats[1].graveyard.map((c) => c.code)).toContain(97017120);
        if (["yes-no", "effect yes-no", "option"].includes(_name)) expect(game.view(null).seats[2].lp).toBe(7000);
        if (_name === "nested sum check") expect(game.view(null).seats[2].lp).toBe(7001);
        if (["cards", "sum", "tribute", "unselect", "sort"].includes(_name)) {
          expect(selectedCode).toBeDefined();
          expect(game.view(null).seats[2].lp).toBe(7000 + selectedCode! % 1000);
        }
        if (["place", "disabled places"].includes(_name)) {
          expect(selected?.sequence).toBeDefined();
          expect(game.view(null).seats[2].lp).toBe(7000 + 2 ** selected!.sequence!);
        }
        if (_name === "position") expect(game.view(null).seats[2].lp).toBe(7001);
        if (["race", "attribute", "number"].includes(_name)) expect(game.view(null).seats[2].lp).toBe(7000 + selected!.values![0]);
        if (_name === "card") expect(game.view(null).seats[2].lp).toBe(7000 + automatic.cardCode! % 1000);
        if (_name === "counters") expect(game.view(null).seats[2].lp).toBe(7000);
        if (_name === "idle") expect(game.view(null).turnSeat).toBe(1);
        expect(holder(game)).not.toBe(0);
        pass(game);
        if (_name === "rock-paper-scissors") expect(game.view(null).seats[2].lp).toBe(7002);
        expect(game.view(null).result ?? null).toBeNull();
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally { game.close(); }
    });
  }
});

describeWithCores("counter sources changed by surrender", [needs.multi(currentMultiWasm()), ...needs.domainMulti(dataDirectory, currentDomainMultiWasm())], () => {
  for (const mode of ["normal", "domain"] as const) {
    it.each(["partial", "one source", "insufficient effect", "continuous cost", "summon cost", "returned sources", "departed payer cost", "paid payer cost"] as const)(`${mode}: %s`, async (scenario) => {
      const cost = scenario.endsWith("cost");
      const count = scenario.startsWith("insufficient") || cost ? 3 : 1;
      const ownSources = scenario === "one source" ? 1 : 2;
      const setup = compileBoard({ mode, format: "ffa4",
        p0: { hand: ["Axe Raider"], ...(mode === "domain" ? { deckMaster: "Gemini Elf" } : {}) },
        p1: { ...(mode === "domain" ? { deckMaster: "Giant Soldier of Stone" } : {}) },
        p2: { ...(mode === "domain" ? { deckMaster: "Summoned Skull" } : {}) },
        p3: { ...(mode === "domain" ? { deckMaster: "Beaver Warrior" } : {}) },
      });
      const bytes = readFileSync(mode === "domain" ? currentDomainMultiWasm() : currentMultiWasm());
      const game = await createEngineGame({ ...setup.options, dataDirectory, seed: ["1", "2", "3", "4"],
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        startupScripts: [...setup.options.startupScripts!, { name: "surrender-counter-sources.lua", content: `
local sources=Group.CreateGroup()
for i=0,${ownSources} do
  local c=Debug.AddCard(46986414,${scenario === "returned sources" ? "0" : scenario.includes("payer") ? "1" : `i==${ownSources} and 1 or 0`},${scenario === "returned sources" || scenario.includes("payer") ? "1" : "0"},LOCATION_MZONE,i,POS_FACEUP_ATTACK,true)
  if ${scenario === "returned sources" ? "true" : scenario.includes("payer") ? "false" : `i==${ownSources}`} then
    local control=Effect.CreateEffect(c); control:SetType(EFFECT_TYPE_SINGLE)
    control:SetCode(EFFECT_SET_CONTROL); control:SetValue(${scenario === "returned sources" ? "1" : "0"}); control:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
    control:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL); c:RegisterEffect(control)
  end
  sources:AddCard(c)
end
local removed=Effect.GlobalEffect()
removed:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); removed:SetCode(EVENT_REMOVE_COUNTER+0x1)
removed:SetOperation(function() Duel.SetLP(3,6000) ${scenario === "paid payer cost" ? "Duel.SelectYesNo(0,30)" : ""} end); Duel.RegisterEffect(removed,3)
local function pay()
  ${scenario === "returned sources" || scenario.includes("payer") ? "Duel.MPWindow(1)" : ""}
  local answer=Duel.RemoveCounter(${scenario.includes("payer") ? "1,1,0" : scenario === "returned sources" ? "0,0,1" : "0,1,0"},0x1,${count},${cost ? "REASON_COST" : "REASON_EFFECT"})
  ${scenario === "returned sources" || scenario.includes("payer") ? "Duel.MPWindowEnd()" : ""}
  Duel.SetLP(2,answer and 7000+Duel.GetCounter(0,1,0,0x1) or 7100)
end
${scenario === "summon cost" ? `local c=Duel.GetFieldGroup(0,LOCATION_HAND,0):GetFirst()
local proc=Effect.CreateEffect(c); proc:SetType(EFFECT_TYPE_FIELD); proc:SetCode(EFFECT_SPSUMMON_PROC)
proc:SetProperty(EFFECT_FLAG_UNCOPYABLE); proc:SetRange(LOCATION_HAND)
proc:SetCondition(function(e,c) return c==nil or Duel.IsCanRemoveCounter(0,1,0,0x1,3,REASON_COST) end)
proc:SetOperation(pay); c:RegisterEffect(proc)` : ""}
local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START|PHASE_MAIN1); e:SetCondition(function() return Duel.GetTurnCount()==1 end)
e:SetOperation(function()
  for c in aux.Next(sources) do
    local permit=Effect.CreateEffect(c); permit:SetType(EFFECT_TYPE_SINGLE)
    permit:SetCode(EFFECT_COUNTER_PERMIT+0x1); permit:SetRange(LOCATION_MZONE); permit:SetValue(LOCATION_MZONE)
    c:RegisterEffect(permit); c:AddCounter(0x1,1)
  end
  ${scenario === "summon cost" ? "" : "pay()"}
end); Duel.RegisterEffect(e,0)` }],
      });
      try {
        for (let step = 0; step < 40 && game.view(holder(game)).prompt?.kind !== "counters"; step++) {
          const prompt = game.view(holder(game)).prompt!;
          if (scenario === "summon cost" && prompt.kind === "choice" && prompt.context?.type === "action") {
            const option = prompt.options.find((o) => o.id.startsWith("spsummon:"));
            expect(option, "counter-cost summon must be offered").toBeDefined();
            game.answer(0, prompt.id, { choice: option!.id });
          } else pass(game);
        }
        const original = game.view(holder(game)).prompt!;
        expect(original.kind).toBe("counters");
        if (scenario === "paid payer cost") {
          game.answer(1, original.id, chooseSurrenderedAnswer(original));
          const removalEvent = game.view(0).prompt!;
          expect(removalEvent.kind).toBe("choice");
          expect(game.view(null).seats[3].lp).toBe(6000);
          game.eliminate(1, 0);
          game.answer(0, removalEvent.id, { choice: "no" });
          expect(game.view(null).seats[2].lp).toBe(7000);
          expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
          pass(game);
          return;
        }
        game.eliminate(1, 0);
        expect(game.view(null).seats[1].eliminated).toBe(true);
        if (scenario !== "departed payer cost") game.answer(0, original.id, chooseSurrenderedAnswer(original));
        if (scenario === "partial" || scenario === "one source") {
          const refreshed = game.view(0).prompt!;
          expect(refreshed.kind).toBe("counters");
          expect(refreshed.id).not.toBe(original.id);
          if (refreshed.kind !== "counters") throw new Error("missing refreshed counter prompt");
          expect(refreshed.options).toHaveLength(ownSources);
          expect(refreshed.target).toBe(1);
          game.answer(0, refreshed.id, chooseSurrenderedAnswer(refreshed));
          expect(game.view(null).seats[2].lp).toBe(7000 + ownSources - 1);
          expect(game.view(null).seats[3].lp).toBe(6000);
        } else {
          expect(game.view(null).seats[2].lp).toBe(cost ? 8000 : 7100);
          expect(game.view(null).seats[3].lp).toBe(8000);
          if (scenario === "returned sources") expect(game.view(null).seats[0].monsters.filter(Boolean)).toHaveLength(ownSources + 1);
          if (scenario === "summon cost") {
            expect(game.view(0).seats[0].hand.map((c) => c.code)).toContain(48305365);
            expect(game.view(null).seats[0].monsters.filter(Boolean)).toHaveLength(ownSources);
          }
        }
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
        expect(holder(game)).toBe(0);
        pass(game);
      } finally { game.close(); }
    });
  }
});
