import { activate, changePhase, defineScenario, eliminate, endTurn, expectBoard, expectEliminated, expectPrompt, expectTurn, yes, type Scenario } from "../../support/dsl.js";

export type LeaveTurnProof = Scenario & { fixture: string };
export const LEAVE_TURN_PROOFS: LeaveTurnProof[] = [];
for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  for (const [reason, name] of [[0, "surrender"], [1, "lp"], [2, "deck"], [3, "timeout"]] as const) {
    LEAVE_TURN_PROOFS.push({
      ...defineScenario({
        id: `leave-turns-${format}-${name}`, title: "Living seats can activate in Main Phase 2 and End Phase of the removed turn player",
        source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
        rules: ["R-FFA-ELIMINATION", "R-COMMON-SURRENDER-EOT"], tags: ["multiplayer", "elimination", format],
        setup: { format, p1: { monsters: ["Mystical Elf"] } },
        steps: [endTurn("p0"), endTurn("p1"), endTurn("p2"), ...(format === "ffa4" ? [endTurn("p3")] : []),
          changePhase("battle", "p0"), eliminate("p0", reason), expectEliminated("p0"), expectTurn("p0", count + 1),
          expectPrompt({ by: "p1", context: "chain" }), activate("Mystical Elf", "p1"), expectBoard({ p1: { lp: 8100 } }),
          expectPrompt({ by: "p1", kind: "choice" }), yes("p1"),
          expectBoard({ p1: { lp: 8300 } }), expectTurn("p1", count + 2),
          endTurn("p1"), endTurn("p2"), ...(format === "ffa4" ? [endTurn("p3")] : []), expectTurn("p1", count * 2 + 1)],
      }),
      fixture: `local c=Duel.GetFieldCard(1,LOCATION_MZONE,0)
for _,entry in ipairs({{EVENT_FREE_CHAIN,100,EFFECT_TYPE_QUICK_O,PHASE_MAIN2},{EVENT_PHASE+PHASE_END,200,EFFECT_TYPE_TRIGGER_O,PHASE_END}}) do
 local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_FIELD|entry[3]); e:SetRange(LOCATION_MZONE)
 e:SetCode(entry[1]); e:SetCountLimit(1)
 local phase=entry[4]; e:SetCondition(function() return Duel.GetTurnCount()==${count + 1} and Duel.GetCurrentPhase()==phase end)
 local amount=entry[2]; e:SetOperation(function(e,tp) Duel.Recover(tp,amount,REASON_EFFECT) end); c:RegisterEffect(e)
end`,
    });
  }
}
