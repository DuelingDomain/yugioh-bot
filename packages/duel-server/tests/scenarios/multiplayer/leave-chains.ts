import { activate, defineScenario, eliminate, expectBoard, expectChain, expectEliminated, expectPrompt, pass, pickOpponent, type Scenario } from "../../support/dsl.js";
export type LeaveChainProof = Scenario & { fixture: string };
export const LEAVE_CHAIN_PROOFS: LeaveChainProof[] = ["ffa3", "ffa4"].map((format) => ({
  ...defineScenario({
    id: `leave-chains-${format}-counter-speed`, title: "A removed Counter Trap does not block a living quick response to the surviving Spell",
    source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
    rules: ["R-FFA-ELIMINATION", "R-FFA-CHAIN"], tags: ["multiplayer", "elimination", format],
    setup: { format: format as "ffa3" | "ffa4", p0: { hand: ["Pot of Greed"], spells: [{ card: "Solemn Judgment", pos: "set" }] }, p1: { spells: [{ card: "Solemn Judgment", pos: "set" }] }, p2: { monsters: ["Mystical Elf"] } },
    steps: [activate("Pot of Greed", "p0"), activate("Solemn Judgment", "p1"), eliminate("p1"), expectEliminated("p1"),
      expectChain("Pot of Greed"), pass("p0"), expectPrompt({ by: "p2", context: "chain" }),
      activate("Mystical Elf", "p2"), expectBoard({ p2: { lp: 8100 } })],
  }),
  fixture: `local c=Duel.GetFieldCard(2,LOCATION_MZONE,0)
local saw_removed_event=false
local probe=Effect.CreateEffect(c); probe:SetType(EFFECT_TYPE_QUICK_O); probe:SetRange(LOCATION_MZONE); probe:SetCode(EVENT_CHAINING)
probe:SetCondition(function(e,tp,eg,ep,ev) if Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_EFFECT)==nil then saw_removed_event=true end; return false end); c:RegisterEffect(probe)
local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_QUICK_O); e:SetRange(LOCATION_MZONE); e:SetCode(EVENT_FREE_CHAIN); e:SetCountLimit(1)
e:SetCondition(function() return Duel.GetCurrentChain()==1 and Duel.GetChainInfo(0,CHAININFO_TRIGGERING_CODE)==55144522 end)
e:SetOperation(function(e,tp)
 if not saw_removed_event and Duel.GetCurrentChain()==3 and Duel.MPChainCount()==2 and Duel.MPPreviousChain()==1
  and Duel.GetChainInfo(2,CHAININFO_TRIGGERING_EFFECT)==nil and not Duel.IsChainNegatable(2) and not Duel.IsChainDisablable(2) then
  Duel.Recover(tp,100,REASON_EFFECT)
 end
end); c:RegisterEffect(e)`,
}));

for (const format of ["ffa3", "ffa4"] as const) {
  const source = LEAVE_CHAIN_PROOFS.find((proof) => proof.id === `leave-chains-${format}-counter-speed`)!;
  LEAVE_CHAIN_PROOFS.push({
    ...source,
    ...defineScenario({ ...source,
      id: `leave-chains-${format}-chain-strike-count`, title: "Chain Strike counts living links after removal and retains their original IDs",
      setup: { ...source.setup, p0: { ...source.setup.p0, hand: ["Pot of Greed", "Chain Strike"] } },
      steps: [...source.steps.slice(0, -1), activate("Chain Strike", "p0"), ...(format === "ffa4" ? [pickOpponent("p2", "p0")] : []), pass("p0"), expectBoard({ p2: { lp: 6900 } })],
    }),
  });
}

for (const format of ["ffa3", "ffa4"] as const) {
  const setter = "SetChainLimitTillChainEnd";
  LEAVE_CHAIN_PROOFS.push({
    ...defineScenario({
      id: `leave-chains-${format}-resolved-${setter}`, title: "A response lock installed by a resolved continuous effect survives its player's removal",
      source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
      rules: ["R-FFA-ELIMINATION", "R-COMMON-ONGOING"], tags: ["multiplayer", "elimination", format],
      setup: { format, p0: { hand: ["Pot of Greed"], spells: [{ card: "Solemn Judgment", pos: "set" }] }, p1: { monsters: ["Mystical Elf"] }, p2: { monsters: ["Mystical Elf"] } },
      steps: [expectBoard({ p1: { lp: 8100 } }), activate("Pot of Greed", "p0"), eliminate("p1"), expectEliminated("p1"), expectChain("Pot of Greed"), pass("p0"),
        expectPrompt({ by: "p0", context: "action" }), expectBoard({ p2: { lp: 8000 } })],
    }),
    fixture: `local source=Duel.GetFieldCard(1,LOCATION_MZONE,0)
local lock=Effect.CreateEffect(source); lock:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); lock:SetRange(LOCATION_MZONE); lock:SetCode(EVENT_PHASE_START|PHASE_MAIN1); lock:SetCountLimit(1)
lock:SetOperation(function(e,tp) Duel.Recover(tp,100,REASON_EFFECT); Duel.${setter}(function() return Duel.MPActionSeat()==128 end) end); source:RegisterEffect(lock)
local c=Duel.GetFieldCard(2,LOCATION_MZONE,0)
local response=Effect.CreateEffect(c); response:SetType(EFFECT_TYPE_QUICK_O); response:SetRange(LOCATION_MZONE); response:SetCode(EVENT_FREE_CHAIN)
response:SetCondition(function() return Duel.GetCurrentChain()>0 end)
response:SetOperation(function(e,tp) Duel.Recover(tp,100,REASON_EFFECT) end); c:RegisterEffect(response)`,
  });
}

for (const format of ["ffa3", "ffa4"] as const) for (const card of ["Performage Flame Eater", "Dream Shark"]) {
  LEAVE_CHAIN_PROOFS.push({
    ...defineScenario({
      id: `leave-chains-${format}-independent-${card.replaceAll(" ", "-")}`, title: "A living response to a removed source keeps its summon and banish-on-leave effect",
      source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
      rules: ["R-FFA-ELIMINATION", "R-FFA-CHAIN"], tags: ["multiplayer", "elimination", format],
      setup: { format, p0: { monsters: ["Mystical Elf"] }, p1: { hand: ["Raigeki"], monsters: ["Mystical Elf"] },
        p2: card === "Dream Shark" ? { grave: [card] } : { hand: [card] } },
      steps: [activate("Mystical Elf", "p0"), pass("p1"), activate(card, "p2"), eliminate("p0"), expectEliminated("p0"), pass("p1"),
        expectBoard({ p2: { lp: card === "Dream Shark" ? 8000 : 7500, zones: { m0: card } } }),
        expectPrompt({ by: "p1", context: "action" }), activate("Raigeki", "p1"), expectBoard({ p2: { banished: [card] } })],
    }),
    fixture: `local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local source=Effect.CreateEffect(c); source:SetType(EFFECT_TYPE_IGNITION); source:SetRange(LOCATION_MZONE); source:SetCategory(CATEGORY_DAMAGE)
source:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk) if chk==0 then return true end; Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,200) end)
source:SetOperation(function(e,tp) Duel.Damage(tp,200,REASON_EFFECT) end); c:RegisterEffect(source)
local hold=Duel.GetFieldCard(1,LOCATION_MZONE,0)
local response=Effect.CreateEffect(hold); response:SetType(EFFECT_TYPE_QUICK_O); response:SetRange(LOCATION_MZONE); response:SetCode(EVENT_FREE_CHAIN)
response:SetCondition(function() return Duel.MPIsAlive(0) and Duel.GetCurrentChain()>0 end)
response:SetOperation(function() end); hold:RegisterEffect(response)`,
  });
}
