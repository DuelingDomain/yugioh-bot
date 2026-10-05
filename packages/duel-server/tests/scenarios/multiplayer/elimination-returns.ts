import { activate, defineScenario, endTurn, expectBoard, expectChain, expectEliminated, expectPrompt, expectResult, pass, pickOpponent, select, surrender, type Scenario, type Step } from "../../support/dsl.js";

export type ReturnProof = Scenario & { fixture?: string; faceUpExtra?: { seat: number; code: number } };
const empty = { monsters: [], spells: [], grave: [], banished: [] };
const finishBoard = (format: "ffa3" | "ffa4" | "tag", board: Parameters<typeof expectBoard>[0], turnThrough = 1) =>
  Object.fromEntries(Object.entries(board).map(([seat, state]) => {
    const index = Number(seat.slice(1));
    const lost = index === 0 || (format === "tag" && index === 2);
    const drawn = format !== "tag" && index > 0 && index <= turnThrough;
    return [seat, { lp: format === "tag" ? 16000 : 8000, extra: [],
      hand: lost || !drawn ? [] : ["Mystical Elf"], deckCount: lost ? 0 : drawn ? 19 : 20, ...state }];
  }));
const add = (code: number, owner: number, controller: number, location: string, sequence = 0, position = "POS_FACEUP_ATTACK") =>
  `(function() local c=Debug.AddCard(${code},${owner},${controller},${location},${sequence},${position},true); if c and c:IsLocation(LOCATION_MZONE) and ${owner}~=${controller} then local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_SET_CONTROL); e:SetValue(${controller}); e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); e:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_CONTROL); c:RegisterEffect(e) end return c end)()`;
const proof = (id: string, format: "ffa3" | "ffa4" | "tag", fixture: string, board: Parameters<typeof expectBoard>[0], setup: Scenario["setup"] = {}, steps: Step[] = [surrender("p0")]): ReturnProof => ({
  ...defineScenario({ id: `elimination-returns-${format}-${id}`, title: `Elimination: ${id}`, source: "ADR-0002; owner answers 2026-10-02", rules: format === "tag" ? ["R-TAG-LOSS"] : ["R-FFA-ELIMINATION", "R-FFA-RETURN-OWNED-CARDS"], tags: ["multiplayer", "elimination", format], setup: { format, ...setup }, steps: [...steps, expectEliminated(...(format === "tag" ? ["p0", "p2"] as const : ["p0"] as const)), expectBoard(finishBoard(format, board, steps.some((step) => step.op === "phase" && step.by === "p1") ? 2 : 1))] }), fixture,
});

export const ELIMINATION_RETURN_PROOFS: ReturnProof[] = [];
for (const format of ["ffa3", "ffa4"] as const) {
  const all = { p0: empty, p1: empty, p2: empty, ...(format === "ffa4" ? { p3: empty } : {}) };
  ELIMINATION_RETURN_PROOFS.push({
    ...defineScenario({ id: `elimination-returns-${format}-change-of-heart`, title: "Change of Heart: the borrowed Giant Rat returns to its owner", source: "ADR-0002; owner answers 2026-10-02", rules: ["R-FFA-ELIMINATION", "R-FFA-RETURN-OWNED-CARDS"], tags: ["multiplayer", "elimination", format, "card:53129443"], setup: { format, p0: { hand: ["Change of Heart"] }, p1: { monsters: [{ card: "Giant Rat", pos: "def" }] }, p2: { monsters: ["Summoned Skull"] } }, steps: [activate("Change of Heart", "p0"), pickOpponent("p1", "p0"),  expectBoard({ p0: { monsters: ["Giant Rat"] }, p1: { monsters: [] } }), surrender("p0"), expectEliminated("p0"), expectBoard(finishBoard(format, { ...all, p1: { ...empty, zones: { m0: { card: "Giant Rat", pos: "def" } }, monsters: ["Giant Rat"] }, p2: { ...empty, monsters: ["Summoned Skull"] } }))] }),
  });
  ELIMINATION_RETURN_PROOFS.push(proof("same-slot", format, add(97017120,1,0,"LOCATION_MZONE",2,"POS_FACEDOWN_DEFENSE"), { ...all, p1: { ...empty, zones: { m2: { card: "Giant Rat", pos: "set" } }, monsters: ["Giant Rat"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("occupied-slot", format, add(97017120,1,0,"LOCATION_MZONE",2,"POS_FACEUP_DEFENSE"), { ...all, p1: { ...empty, zones: { m0: { card: "Giant Rat", pos: "def" }, m2: "Dark Magician" }, monsters: ["Giant Rat","Dark Magician"] } }, { p1: { monsters: [null,null,"Dark Magician"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("full-field", format, add(97017120,1,0,"LOCATION_MZONE",2), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: ["Giant Rat"] } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("piles", format, [add(97017120,1,0,"LOCATION_HAND"),add(89631139,1,0,"LOCATION_GRAVE"),add(70781052,2,0,"LOCATION_REMOVED",0,"POS_FACEDOWN")].join(";\n"), { ...all, p0: { ...empty, hand: [] }, p1: { ...empty, hand: { include: ["Giant Rat"], count: 2 }, grave: [89631139] }, p2: { ...empty, banished: ["Summoned Skull"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("token-other-field", format, add(73915052,0,2,"LOCATION_MZONE",1,"POS_FACEUP_DEFENSE"), { ...all, p2: { ...empty, zones: { m1: { card: "Sheep Token", pos: "def" } }, monsters: ["Sheep Token"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("equip-stays", format, `local m=${add(97017120,1,0,"LOCATION_MZONE",2)}\nlocal e=${add(40619825,2,0,"LOCATION_SZONE",1,"POS_FACEUP")}\nDebug.PreEquip(e,m)`, { ...all, p1: { ...empty, zones: { m2: { card: "Giant Rat", attack: 2400 } }, monsters: ["Giant Rat"] }, p2: { ...empty, zones: { s1: "Axe of Despair" }, spells: ["Axe of Despair"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("equip-lost-target", format, `local m=${add(64631466,0,0,"LOCATION_MZONE",2)}
local e=${add(97017120,1,0,"LOCATION_SZONE",1,"POS_FACEUP")}
local limit=Effect.CreateEffect(e); limit:SetType(EFFECT_TYPE_SINGLE); limit:SetCode(EFFECT_EQUIP_LIMIT); limit:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); limit:SetValue(function(_,c) return c==m end); e:RegisterEffect(limit)
Debug.PreEquip(e,m)`, { ...all, p1: { ...empty, grave: ["Giant Rat"] } }, {}, [expectBoard({p0:{monsters:["Relinquished"],spells:["Giant Rat"]},p1:{grave:[]}}),surrender("p0")]));
  ELIMINATION_RETURN_PROOFS.push(proof("macro-cosmos-fallback", format, add(97017120,1,0,"LOCATION_MZONE",2), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), banished: ["Giant Rat"] }, p2: { ...empty, spells: ["Macro Cosmos"] } }, { p1: { monsters: Array(5).fill("Dark Magician") }, p2: { spells: ["Macro Cosmos"] } }));
  for (const order of ["monster-first", "macro-first"]) {
    const monster = add(97017120,1,0,"LOCATION_MZONE",2);
    const macro = add(30241314,2,0,"LOCATION_SZONE",1,"POS_FACEUP");
    ELIMINATION_RETURN_PROOFS.push(proof(`macro-leaves-with-fallback-${order}`, format,
      (order === "monster-first" ? [monster, macro] : [macro, monster]).join(";\n"),
      { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: ["Giant Rat"] },
        p2: { ...empty, spells: Array(5).fill("Monster Reborn"), grave: ["Macro Cosmos"] } },
      { p1: { monsters: Array(5).fill("Dark Magician") }, p2: { spells: Array(5).fill({ card: "Monster Reborn", pos: "set" }) } }));
  }
  ELIMINATION_RETURN_PROOFS.push(proof("dimensional-fissure-fallback", format, add(97017120,1,0,"LOCATION_MZONE",2), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), banished: ["Giant Rat"] }, p2: { ...empty, spells: ["Dimensional Fissure"] } }, { p1: { monsters: Array(5).fill("Dark Magician") }, p2: { spells: ["Dimensional Fissure"] } }));
  // expectLog checks these lines in order, so a shuffle after p1's draw fails.
  ELIMINATION_RETURN_PROOFS.push(proof("deck-return-shuffles", format, add(97017120,1,0,"LOCATION_DECK",1,"POS_FACEDOWN"), { ...all, p1: { ...empty, deckCount:20, hand:{count:1} } }, {}, [surrender("p0"), {op:"expectLog",lines:["Player 2 shuffled their deck", "Player 2 drew 1 card(s)"]}]));
  // A rejected send leaves a face-up card with a stale face-down send parameter.
  // GetExtraTopGroup must exclude the returned face-up Pendulum from the hidden Extra Deck.
  ELIMINATION_RETURN_PROOFS.push({ ...proof("extra-return-face-up", format, `local c=${add(16178681,1,0,"LOCATION_EXTRA",0,"POS_FACEUP")}
local lock=Effect.CreateEffect(c); lock:SetType(EFFECT_TYPE_SINGLE); lock:SetCode(EFFECT_CANNOT_REMOVE); lock:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); c:RegisterEffect(lock)
local prepare=Effect.GlobalEffect(); prepare:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); prepare:SetCode(EVENT_PREDRAW); prepare:SetOperation(function(e,tp,eg,ep) if ep==0 then Duel.Remove(c,POS_FACEDOWN,REASON_EFFECT) end end); Duel.RegisterEffect(prepare,0)
local check=Effect.GlobalEffect(); check:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); check:SetCode(EVENT_ADJUST); check:SetOperation(function() if c:IsControler(1) and c:IsLocation(LOCATION_EXTRA) and Duel.GetExtraTopGroup(1,1):IsContains(c) then Duel.SetLP(1,7900) end end); Duel.RegisterEffect(check,1)`, { ...all, p1: { ...empty, extra:["Number 39: Utopia","Odd-Eyes Pendulum Dragon"] } }, {p1:{extra:["Number 39: Utopia"]}}, [expectBoard({p0:{extra:["Odd-Eyes Pendulum Dragon"]},p1:{extra:["Number 39: Utopia"]}}),surrender("p0")]), faceUpExtra:{seat:1,code:16178681} });
  ELIMINATION_RETURN_PROOFS.push(proof("xyz-returns", format, [add(84013237,1,0,"LOCATION_MZONE",2),add(89631139,2,0,"LOCATION_MZONE",2),add(70781052,0,0,"LOCATION_MZONE",2)].join(";\n"), { ...all, p1: { ...empty, zones: { m2: { card: "Number 39: Utopia", materials: 1 } }, monsters: ["Number 39: Utopia"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("pendulum-full-field", format, add(16178681,1,0,"LOCATION_MZONE",2), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: [], extra: ["Odd-Eyes Pendulum Dragon"] } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("removed-zone-lock", format, `${add(97017120,1,0,"LOCATION_MZONE",2)};\nlocal g=Debug.AddCard(90502999,0,0,LOCATION_SZONE,0,POS_FACEUP,true); g:GetCardEffect(EFFECT_DISABLE_FIELD):GetLabelObject():SetLabel(0x180000)`, { ...all, p1: { ...empty, monsters: [...Array(3).fill("Dark Magician"),"Giant Rat"], zones: { m3: "Giant Rat" } } }, { p1: { monsters: Array(3).fill("Dark Magician") } }));
  const temporaryToken = `local c=Debug.AddCard(73915052,0,2,LOCATION_MZONE,1,POS_FACEUP_DEFENSE,true); local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_SET_CONTROL); e:SetValue(2); e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); e:SetReset(RESET_PHASE|PHASE_END); c:RegisterEffect(e)`;
  const tokenBoard = { ...all, p2: { ...empty, zones: { m1: { card: "Sheep Token", pos: "def" as const } }, monsters: ["Sheep Token"] } };
  ELIMINATION_RETURN_PROOFS.push(proof("token-temporary-control", format, temporaryToken, tokenBoard, {}, [surrender("p0"),endTurn("p1")]));
  ELIMINATION_RETURN_PROOFS.push(proof("token-remove-brainwashing", format, temporaryToken, { ...tokenBoard, p1: { ...empty, spells: ["Remove Brainwashing"] } }, { p1: { spells: [{card:"Remove Brainwashing",pos:"set"}] } }, [surrender("p0"),activate("Remove Brainwashing","p1")]));
  ELIMINATION_RETURN_PROOFS.push(proof("foreign-token-full-field", format, add(73915052,1,0,"LOCATION_MZONE",2), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician") } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("sangan-fallback-no-response", format, `${add(26202165,1,0,"LOCATION_MZONE",2)};
for _,event in ipairs({EVENT_LEAVE_FIELD_P,EVENT_LEAVE_FIELD,EVENT_TO_GRAVE,EVENT_MOVE}) do
 local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); e:SetCode(event)
 e:SetOperation(function(e,tp,eg) if eg:IsExists(Card.IsCode,1,nil,26202165) then Duel.SetLP(1,Duel.GetLP(1)-100) end end); Duel.RegisterEffect(e,1)
end`, { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: ["Sangan"], lp:8000 } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("pendulum-fallback-event", format, `${add(16178681,1,0,"LOCATION_MZONE",2)}; local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); e:SetCode(EVENT_TO_GRAVE); e:SetOperation(function(e,tp,eg) if eg:IsExists(Card.IsCode,1,nil,16178681) then Duel.SetLP(1,Duel.GetLP(1)-100) end end); Duel.RegisterEffect(e,1)`, { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: [], extra:["Odd-Eyes Pendulum Dragon"],lp:8000 } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("extra-monster-zone", format, add(84013237,1,0,"LOCATION_MZONE",5), { ...all, p1: { ...empty, monsters: ["Number 39: Utopia"], zones: { emz0: "Number 39: Utopia" } } }));
  ELIMINATION_RETURN_PROOFS.push(proof("field-zone", format, add(59197169,1,0,"LOCATION_FZONE",0,"POS_FACEUP"), { ...all, p1: { ...empty, spells: ["Yami"], zones: { f: "Yami" } } }));
  ELIMINATION_RETURN_PROOFS.push(proof("occupied-field-zone", format, add(59197169,1,0,"LOCATION_FZONE",0,"POS_FACEUP"), { ...all, p1: { ...empty, spells: ["Forest"], grave: ["Yami"], zones: { f: "Forest" } } }, { p1: { field: "Forest" } }));
  ELIMINATION_RETURN_PROOFS.push(proof("spell-zone", format, add(83764718,1,0,"LOCATION_SZONE",3,"POS_FACEDOWN"), { ...all, p1: { ...empty, zones: { s3: { card: "Monster Reborn", pos: "set" } }, spells: ["Monster Reborn"] } }));
  ELIMINATION_RETURN_PROOFS.push(proof("full-spell-zone", format, add(83764718,1,0,"LOCATION_SZONE",3,"POS_FACEDOWN"), { ...all, p1: { ...empty, spells: Array(5).fill("Monster Reborn"), grave: ["Monster Reborn"] } }, { p1: { spells: Array(5).fill({ card: "Monster Reborn", pos: "set" }) } }));
  ELIMINATION_RETURN_PROOFS.push(proof("xyz-full-field", format, [add(84013237,1,0,"LOCATION_MZONE",2),add(89631139,2,0,"LOCATION_MZONE",2)].join(";\n"), { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: ["Number 39: Utopia"] }, p2: { ...empty, grave: ["Blue-Eyes White Dragon"] } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("equip-full-field", format, `local m=${add(97017120,1,0,"LOCATION_MZONE",2)}\nlocal e=${add(40619825,2,0,"LOCATION_SZONE",1,"POS_FACEUP")}\nDebug.PreEquip(e,m)`, { ...all, p1: { ...empty, monsters: Array(5).fill("Dark Magician"), grave: ["Giant Rat"] }, p2: { ...empty, grave: ["Axe of Despair"] } }, { p1: { monsters: Array(5).fill("Dark Magician") } }));
  ELIMINATION_RETURN_PROOFS.push(proof("xyz-removed", format, [add(84013237,0,1,"LOCATION_MZONE",2),add(89631139,2,1,"LOCATION_MZONE",2)].join(";\n"), { ...all, p2: { ...empty, grave: [89631139] } }));
}
ELIMINATION_RETURN_PROOFS.push(proof("team-loss-keeps-stock", "tag", add(97017120,1,0,"LOCATION_MZONE",2), { p0: empty, p1: empty, p2: empty, p3: empty }));

// A real chain leaves the lost seat's activated Trap in leave_confirmed on the base.
// Query the underlying zones in the Domain runner as well as the views of all seats.
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  ELIMINATION_RETURN_PROOFS.push({
    fixture: format === "tag" ? "" : `local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CHAIN_SOLVED)
e:SetOperation(function(e,tp,eg,ep,ev,re) if re:GetHandler():IsCode(60082869) then Duel.SetLP(2,7777) end end)
Duel.RegisterEffect(e,2)`,
    ...defineScenario({
      id: `elimination-returns-${format}-removed-chain-card-stays-out`,
      title: format === "tag" ? "Tag surrender ends the duel before the chain resolves" : "A surrendered duelist's unresolved link is removed and living links still resolve",
      source: "ADR-0002; remove-eliminated-chain-cards",
      rules: format === "tag" ? ["R-TAG-LOSS", "R-COMMON-SURRENDER-EOT"] : ["R-FFA-ELIMINATION", "R-FFA-CHAIN", "R-COMMON-SURRENDER-EOT"],
      tags: ["multiplayer", "elimination", "chain", format],
      setup: { format, p0: { hand: ["Pot of Greed"], spells: ["Swords of Revealing Light"] }, p1: { spells: [{ card: "Dust Tornado", pos: "set" }] }, p2: { spells: [{ card: "Dust Tornado", pos: "set" }] } },
      steps: [activate("Pot of Greed", "p0"), activate("Dust Tornado", "p1"),
        ...(format === "tag" ? [] : [pickOpponent("p0", "p1")]), select("Swords of Revealing Light"),
        expectPrompt({ by: "p2", context: "chain" }), surrender("p1"),
        ...(format === "tag" ? [] : [expectChain("Pot of Greed"), expectPrompt({ by: "p2", context: "chain" }), pass("p2")]),
        expectEliminated(...(format === "tag" ? ["p1", "p3"] as const : ["p1"] as const)),
        ...(format === "tag" ? [expectResult({ team: 0 })] : []),
        expectBoard({
          // Standard MR5 skips the opening draw. The surviving Pot of Greed draws two cards.
          p0: { ...empty, lp: format === "tag" ? 16000 : 8000, extra: [], hand: { count: format === "tag" ? 0 : 2 }, deckCount: format === "tag" ? 20 : 18,
            spells: format === "tag" ? ["Swords of Revealing Light", "Pot of Greed"] : ["Swords of Revealing Light"], grave: format === "tag" ? [] : ["Pot of Greed"] },
          p1: { ...empty, lp: format === "tag" ? 16000 : 8000, extra: [], hand: [], deckCount: 0 }, p2: { ...empty, lp: format === "tag" ? 16000 : 8000, extra: [], spells: ["Dust Tornado"], hand: [], deckCount: 20 },
          ...(format === "ffa3" ? {} : { p3: { ...empty, lp: format === "tag" ? 16000 : 8000, extra: [], hand: [], deckCount: format === "tag" ? 0 : 20 } }),
        }),
      ],
    }),
  });
}
