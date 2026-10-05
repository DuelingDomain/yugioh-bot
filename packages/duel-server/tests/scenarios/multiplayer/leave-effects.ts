import { activate, choose, defineScenario, eliminate, endTurn, expectBoard, expectEliminated, expectNotOffered, expectOffered, normalSummon, pickOpponent, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

export type LeaveEffectProof = Scenario & { fixture?: string };
export const LEAVE_EFFECT_PROOFS: LeaveEffectProof[] = [];
for (const format of ["ffa3", "ffa4"] as const) {
  const living: DuelistId[] = ["p1", "p2", ...(format === "ffa4" ? ["p3" as const] : [])];
  const round = () => living.map((seat) => endTurn(seat));
  for (const removed of [false, true]) {
    LEAVE_EFFECT_PROOFS.push(defineScenario({
      id: `leave-effects-${format}-heat-wave-${removed ? "removed" : "living"}`,
      title: "Heat Wave lasts until its activator's next Draw Phase, including a skipped turn",
      source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
      rules: ["R-FFA-ELIMINATION", "R-COMMON-ONGOING"], tags: ["multiplayer", "elimination", format],
      setup: { format, p0: { hand: ["Heat Wave"] }, p1: { hand: ["Giant Rat"] }, p2: { hand: ["Giant Rat"] }, ...(format === "ffa4" ? { p3: { hand: ["Giant Rat"] } } : {}) },
      steps: [activate("Heat Wave", "p0"), expectBoard({ p0: { grave: ["Heat Wave"] } }), ...(removed ? [eliminate("p0"), expectEliminated("p0")] : [endTurn("p0")]),
        ...living.flatMap((seat) => [expectNotOffered("normalSummon", "Giant Rat", seat), endTurn(seat)]),
        ...(removed ? [] : [endTurn("p0")]), expectOffered("normalSummon", "Giant Rat", "p1"),
        normalSummon("Giant Rat", "p1"), expectBoard({ p1: { monsters: ["Giant Rat"] } })],
    }));
  }
  LEAVE_EFFECT_PROOFS.push({
    ...defineScenario({
      id: `leave-effects-${format}-two-skipped-draws`, title: "An already resolved effect counts two future Draw Phases of its removed activator",
      source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
      rules: ["R-FFA-ELIMINATION", "R-COMMON-ONGOING"], tags: ["multiplayer", "elimination", format],
      setup: { format, p0: { monsters: ["Mystical Elf"] }, p1: { hand: ["Giant Rat"] } },
      steps: [activate("Mystical Elf", "p0"), eliminate("p0"), expectEliminated("p0"), expectNotOffered("normalSummon", "Giant Rat", "p1"),
        ...round(), expectNotOffered("normalSummon", "Giant Rat", "p1"), ...round(), expectOffered("normalSummon", "Giant Rat", "p1")],
    }),
    fixture: `local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_IGNITION); e:SetRange(LOCATION_MZONE); e:SetCountLimit(1)
e:SetOperation(function(e,tp)
 local lock=Effect.CreateEffect(e:GetHandler()); lock:SetType(EFFECT_TYPE_FIELD); lock:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
 lock:SetCode(EFFECT_CANNOT_SUMMON); lock:SetTargetRange(1,1); lock:SetTarget(function(e,c) return c:IsType(TYPE_EFFECT) end)
 lock:SetReset(RESET_PHASE|PHASE_DRAW|RESET_SELF_TURN,2); Duel.RegisterEffect(lock,tp)
end); c:RegisterEffect(e)`,
  });
  LEAVE_EFFECT_PROOFS.push({
    ...defineScenario({
      id: `leave-effects-${format}-granted-duration`, title: "A resolved grant survives removal and safely expires with its granted effects",
      source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
      rules: ["R-FFA-ELIMINATION", "R-COMMON-ONGOING"], tags: ["multiplayer", "elimination", format],
      setup: { format, p0: { monsters: ["Mystical Elf"] }, p1: { monsters: ["Mystical Elf"] } },
      steps: [activate("Mystical Elf", "p0"), expectBoard({ p1: { zones: { m0: { card: "Mystical Elf", attack: 1500 } } } }),
        eliminate("p0"), expectEliminated("p0"), expectBoard({ p1: { zones: { m0: { card: "Mystical Elf", attack: 1500 } } } }),
        ...round(), expectBoard({ p1: { zones: { m0: { card: "Mystical Elf", attack: 800 } } } })],
    }),
    fixture: `local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_IGNITION); e:SetRange(LOCATION_MZONE); e:SetCountLimit(1)
e:SetOperation(function(e,tp)
 local granted=Effect.CreateEffect(c); granted:SetType(EFFECT_TYPE_SINGLE); granted:SetCode(EFFECT_UPDATE_ATTACK); granted:SetValue(700)
 granted:SetReset(RESET_PHASE|PHASE_DRAW|RESET_SELF_TURN,5)
 local grant=Effect.CreateEffect(c); grant:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_GRANT); grant:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)
 grant:SetLabelObject(granted); grant:SetReset(RESET_PHASE|PHASE_DRAW|RESET_SELF_TURN); Duel.RegisterEffect(grant,tp)
end); c:RegisterEffect(e)`,
  });
  const virusSteps: Step[] = [activate("Eradicator Epidemic Virus", "p0"), pickOpponent("p1", "p0"), choose("opt:0", "p0"), expectBoard({ p0: { grave: ["Dark Magician", "Eradicator Epidemic Virus"] } }),
    eliminate("p0"), expectEliminated("p0")];
  for (let draw = 1; draw <= 4; draw++) {
    virusSteps.push(expectBoard({ p1: { grave: Array(Math.min(draw, 3)).fill("Pot of Greed"), hand: { count: draw === 4 ? 1 : 0 } } }));
    if (draw < 4) virusSteps.push(...round());
  }
  LEAVE_EFFECT_PROOFS.push(defineScenario({
    id: `leave-effects-${format}-eradicator`, title: "Eradicator Epidemic Virus survives its activator and ends after three victim turns",
    source: "Domain Format Complete Rulebook v1.4; owner decision 2026-10-04",
    rules: ["R-FFA-ELIMINATION", "R-FFA-DECLARED-DURATION", "R-COMMON-ONGOING"], tags: ["multiplayer", "elimination", format],
    setup: { format, p0: { monsters: ["Dark Magician"], spells: [{ card: "Eradicator Epidemic Virus", pos: "set" }] }, p1: { deck: Array(20).fill("Pot of Greed") } },
    steps: virusSteps,
  }));
}
