import { activate, defineScenario, endTurn, expectBoard, expectEliminated, expectNotOffered, expectOffered, zone, expectPrompt, expectPickOptions, select, normalSummon, specialSummon, surrender, pickOpponent, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

const cards = ["Giant Rat", "Dark Magician", "Summoned Skull", "Blue-Eyes White Dragon"];
type RotationScenario = Scenario & { fixture?: string; drawn: Record<DuelistId, number> };

// All cases start on p0's turn. Later-turn cases state each seat's draw count below.
function rotationScenario(scenario: Scenario & { drawn?: Partial<Record<DuelistId, number>> }): RotationScenario {
  return {
    ...defineScenario(scenario),
    drawn: { p0: 0, p1: 0, p2: 0, p3: 0, ...scenario.drawn },
  };
}

export const ROTATE_CONTROL_SCENARIOS: RotationScenario[] = [];
for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  for (const full of [false, true]) {
    const setup: Scenario["setup"] = { format };
    const board: Parameters<typeof expectBoard>[0] = {};
    const steps: Step[] = [activate("Creature Swap", "p0")];
    for (let seat=0; seat<count; seat++) {
      const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
      setup[id] = { monsters: [cards[seat], ...Array(full ? 4 : 1).fill("Mystical Elf")], ...(seat === 0 ? { hand: ["Creature Swap"] } : {}) };
      steps.push(expectPrompt({ by: id, kind: "cards" }), select(cards[seat]));
      board[id] = { monsters: [cards[(seat+count-1)%count], ...Array(full ? 4 : 1).fill("Mystical Elf")], spells: [], grave: seat===0 ? ["Creature Swap"] : [], banished: [] };
    }
    steps.push(expectBoard(board), expectNotOffered("changePosition",cards[count-1],"p0"));
    ROTATE_CONTROL_SCENARIOS.push(rotationScenario({ id: `rotate-control-${format}-${full ? "full" : "open"}-fields`, title: "Each duelist gives one monster to the next living duelist", source: "ADR-0002; owner answers 2026-10-02", rules: ["R-FFA-RESOURCE-ROTATION","R-COMMON-EACH-PLAYER"], tags: ["multiplayer",format,"card:31036355"], setup, steps }));
  }
  const emptySetup: Scenario["setup"] = {
    format,
    p0: { hand: ["Creature Swap"], monsters: [cards[0], "Mystical Elf"] },
    p1: { monsters: [cards[1], "Mystical Elf"] },
    p2: { hand: ["Mystical Elf"] },
    ...(count === 4 ? { p3: { monsters: [cards[3], "Mystical Elf"] } } : {}),
  };
  const emptySteps: Step[] = [expectNotOffered("activate", "Creature Swap", "p0"),
    endTurn("p0"), endTurn("p1"), normalSummon("Mystical Elf", "p2"), zone("p2", "m0", "p2"), endTurn("p2"),
    ...(count === 4 ? [endTurn("p3")] : []), expectOffered("activate", "Creature Swap", "p0"), activate("Creature Swap", "p0")];
  const emptyBoard: Parameters<typeof expectBoard>[0] = {};
  const selected = [cards[0], cards[1], "Mystical Elf", cards[3]];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as DuelistId;
    if (seat !== 2) emptySteps.push(expectPrompt({ by: id, kind: "cards" }), select({ card: selected[seat], owner: id }));
    emptyBoard[id] = { monsters: [selected[(seat + count - 1) % count], ...(seat === 2 ? [] : ["Mystical Elf"])], grave: seat === 0 ? ["Creature Swap"] : [] };
  }
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as DuelistId;
    emptySteps.push(expectPrompt({ by: id, kind: "places" }), zone(id, "m0", id));
    emptyBoard[id]!.zones = { m0: selected[(seat + count - 1) % count] };
  }
  emptySteps.push(expectBoard(emptyBoard));
  ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
    id: `rotate-control-${format}-one-empty-seat`,
    title: "Creature Swap is legal after the empty seat summons a monster",
    source: "Owner answers 2026-10-02; ADR-0002 [R-FFA-RESOURCE-ROTATION]",
    rules: ["R-FFA-RESOURCE-ROTATION"], tags: ["multiplayer", format, "card:31036355"],
    setup: emptySetup, steps: emptySteps,
    drawn: { p0: 1, p1: 1, p2: 1, p3: count === 4 ? 1 : 0 },
  }));
}
ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
  id: "rotate-control-ffa4-p2-turn",
  drawn: { p0: 0, p1: 1, p2: 1, p3: 0 },
  title: "Card and zone choices start with p2 on the turn of p2",
  source: "Owner answers 2026-10-02",
  rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-EACH-PLAYER"],
  tags: ["multiplayer", "ffa4", "card:31036355"],
  setup: {
    format: "ffa4",
    p0: { monsters: [cards[0], "Mystical Elf"] },
    p1: { monsters: [cards[1], "Mystical Elf"] },
    p2: { hand: ["Creature Swap"], monsters: [cards[2], "Mystical Elf"] },
    p3: { monsters: [cards[3], "Mystical Elf"] },
  },
  steps: [
    endTurn("p0"), endTurn("p1"), activate("Creature Swap", "p2"),
    expectPrompt({ by: "p2", kind: "cards" }), select(cards[2]),
    expectPrompt({ by: "p3", kind: "cards" }), select(cards[3]),
    expectPrompt({ by: "p0", kind: "cards" }), select(cards[0]),
    expectPrompt({ by: "p1", kind: "cards" }), select(cards[1]),
    expectPrompt({ by: "p2", kind: "places" }), zone("p2", "m2"),
    expectPrompt({ by: "p3", kind: "places" }), zone("p3", "m3"),
    expectPrompt({ by: "p0", kind: "places" }), zone("p0", "m4"),
    expectPrompt({ by: "p1", kind: "places" }), zone("p1", "m0"),
    expectBoard({
      p0: { monsters: [cards[3], "Mystical Elf"], grave: [], zones: { m0: null, m4: cards[3] } },
      p1: { monsters: [cards[0], "Mystical Elf"], grave: [], zones: { m0: cards[0] } },
      p2: { monsters: [cards[1], "Mystical Elf"], grave: ["Creature Swap"], zones: { m0: null, m2: cards[1] } },
      p3: { monsters: [cards[2], "Mystical Elf"], grave: [], zones: { m0: null, m3: cards[2] } },
    }),
  ],
}));
ROTATE_CONTROL_SCENARIOS.push(rotationScenario({ id: "rotate-control-ffa4-skips-eliminated", drawn: { p0: 0, p1: 0, p2: 1, p3: 0 }, title: "Three living seats rotate and the lost seat stays empty", source: "Owner answers 2026-10-02", rules: ["R-FFA-RESOURCE-ROTATION","R-COMMON-EACH-PLAYER","R-FFA-ELIMINATION"], tags: ["multiplayer","ffa4","card:31036355"], setup: { format: "ffa4", p0: { monsters: [cards[0],"Mystical Elf"] },p2:{hand:["Creature Swap"],monsters:[cards[2],"Mystical Elf"]},p3:{monsters:[cards[3],"Mystical Elf"]} }, steps: [surrender("p1"),endTurn("p0"),expectEliminated("p1"),activate("Creature Swap","p2"),expectPrompt({by:"p2",kind:"cards"}),select(cards[2]),expectPrompt({by:"p3",kind:"cards"}),select(cards[3]),expectPrompt({by:"p0",kind:"cards"}),select(cards[0]),expectBoard({p0:{monsters:[cards[3],"Mystical Elf"],grave:[]},p1:{monsters:[],spells:[],hand:[],grave:[],banished:[],deckCount:0},p2:{monsters:[cards[0],"Mystical Elf"],grave:["Creature Swap"]},p3:{monsters:[cards[2],"Mystical Elf"],grave:[]}})] }));
ROTATE_CONTROL_SCENARIOS.push(rotationScenario({ id: "rotate-control-tag-stock-swap", title: "Tag keeps the two-monster swap and the partner cards stay", source: "ADR-0002 [R-TAG-SHARED-CARDS]", rules: ["R-TAG-SHARED-CARDS"], tags: ["multiplayer","tag","card:31036355"], setup:{format:"tag",p0:{hand:["Creature Swap"],monsters:[cards[0],"Mystical Elf"]},p1:{monsters:[cards[1],"Mystical Elf"]},p2:{monsters:[cards[2]]},p3:{monsters:[]}},steps:[activate("Creature Swap","p0"),select(cards[0]),pickOpponent("p1","p0"),select(cards[1]),expectBoard({p0:{monsters:[cards[1],"Mystical Elf"],grave:["Creature Swap"]},p1:{monsters:[cards[0],"Mystical Elf"],grave:[]},p2:{monsters:[cards[2]],grave:[]},p3:{monsters:[],grave:[]}})]}));

for (const format of ["ffa3","ffa4"] as const) {
  const count=format==="ffa3" ? 3 : 4;
  const setup: Scenario["setup"]={format};
  const picks: Step[]=[activate("Creature Swap","p0")];
  const final: Parameters<typeof expectBoard>[0]={};
  const unchanged: Parameters<typeof expectBoard>[0]={};
  for(let seat=0;seat<count;seat++) {
    const id=`p${seat}` as "p0"|"p1"|"p2"|"p3";
    setup[id]={monsters:[cards[seat],"Mystical Elf"],...(seat===0 ? {hand:["Creature Swap"]} : {})};
    picks.push(expectPrompt({by:id,kind:"cards"}),select(cards[seat]));
    final[id]={monsters:[cards[(seat+count-1)%count],"Mystical Elf"],grave:seat===0 ? ["Creature Swap"] : [],lp:7900};
    unchanged[id]={monsters:[cards[seat],"Mystical Elf"],grave:seat===0 ? ["Creature Swap"] : [],lp:8000};
  }
  const make=(id:string,fixture:string,steps:Step[],ownSetup=setup) => ({...rotationScenario({id:`rotate-control-${format}-${id}`,title:id,source:"Owner answers 2026-10-02",rules:id === "control-lock" ? [] : ["R-FFA-RESOURCE-ROTATION","R-COMMON-EACH-PLAYER"],tags:["multiplayer",format,"card:31036355"],setup:ownSetup,steps}),fixture});
  ROTATE_CONTROL_SCENARIOS.push(make("control-change-events", "local e=Effect.GlobalEffect(); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS); e:SetCode(EVENT_CONTROL_CHANGED); e:SetOperation(function(e,tp,eg) for c in aux.Next(eg) do local p=Duel.MPSeatOf(c); Duel.SetLP(p,Duel.GetLP(p)-100) end end); Duel.RegisterEffect(e,0)", [...picks,expectBoard(final)]));
  ROTATE_CONTROL_SCENARIOS.push(make("immunity-stops-whole-rotation", "local c=Duel.GetFieldCard(1,LOCATION_MZONE,0); local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_IMMUNE_EFFECT); e:SetValue(function(e,re) return re:IsActiveType(TYPE_SPELL) end); c:RegisterEffect(e)",[...picks,expectBoard(unchanged)]));
  const locked=structuredClone(setup); locked.p1!.monsters=[cards[1]];
  const before=structuredClone(unchanged); before.p0!.grave=[];before.p1!.monsters=[cards[1]];
  ROTATE_CONTROL_SCENARIOS.push(make("control-lock", "local c=Duel.GetFieldCard(1,LOCATION_MZONE,0); local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_CANNOT_CHANGE_CONTROL); c:RegisterEffect(e)",[expectNotOffered("activate","Creature Swap","p0"),expectBoard(before)],locked));
  const xyzSetup=structuredClone(setup);xyzSetup.p0!.monsters=[{card:"Number 39: Utopia",materials:["Mystical Elf"]},"Mystical Elf"];xyzSetup.p0!.spells=["Axe of Despair"];
  const xyzPicks=picks.map(step => step.op==="select" && step.sels[0]===cards[0] ? select("Number 39: Utopia") : step);
  const xyzBoard=structuredClone(final);for(const seat of Object.values(xyzBoard)) seat!.lp=8000;xyzBoard.p1!.monsters=["Number 39: Utopia","Mystical Elf"];xyzBoard.p1!.zones={m0:{card:"Number 39: Utopia",materials:1,attack:3500}};xyzBoard.p0!.spells=["Axe of Despair"];
  ROTATE_CONTROL_SCENARIOS.push(make("xyz-and-equip", "Debug.PreEquip(Duel.GetFieldCard(0,LOCATION_SZONE,0),Duel.GetFieldCard(0,LOCATION_MZONE,0))",[...xyzPicks,expectBoard(xyzBoard)],xyzSetup));
}

// R-COMMON-SURRENDER-EOT / R-FFA-ELIMINATION (Rulebook v1.4): removal is immediate.
// The living placement stays answerable, but a rotation cannot transfer the removed card.
ROTATE_CONTROL_SCENARIOS.push(rotationScenario({ id: "rotate-control-ffa4-loss-during-placement", title: "Immediate surrender cancels a rotation whose selected monster left", source: "Rulebook v1.4 Removing players from the game; R-COMMON-SURRENDER-EOT", rules: ["R-FFA-RESOURCE-ROTATION","R-COMMON-EACH-PLAYER","R-FFA-ELIMINATION"], tags: ["multiplayer","ffa4","card:31036355"], setup: { format:"ffa4",p0:{hand:["Creature Swap"],monsters:[cards[0],"Mystical Elf"]},p1:{monsters:[cards[1],"Mystical Elf"]},p2:{monsters:[cards[2],"Mystical Elf"]},p3:{monsters:[cards[3],"Mystical Elf"]} }, steps: [activate("Creature Swap","p0"),expectPrompt({by:"p0",kind:"cards"}),select(cards[0]),expectPrompt({by:"p1",kind:"cards"}),select(cards[1]),expectPrompt({by:"p2",kind:"cards"}),select(cards[2]),expectPrompt({by:"p3",kind:"cards"}),select(cards[3]),expectPrompt({by:"p0",kind:"places"}),surrender("p1"),expectPrompt({by:"p0",kind:"places"}),zone("p0","m0"),expectBoard({p0:{monsters:[cards[0],"Mystical Elf"],grave:["Creature Swap"]},p1:{monsters:[],spells:[],hand:[],grave:[],banished:[],deckCount:0},p2:{monsters:[cards[2],"Mystical Elf"],grave:[]},p3:{monsters:[cards[3],"Mystical Elf"],grave:[]}}),expectEliminated("p1")] }));

// A control change must keep the summon count of a continuous restriction.
for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  const steps: Step[] = [specialSummon("Gilasaurus", "p0"), pickOpponent("p1", "p0"), activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    const chosen = seat === 0 ? "El Shaddoll Winda" : cards[seat];
    setup[id] = {
      monsters: [chosen, "Mystical Elf"],
      ...(seat === 0 ? { hand: ["Creature Swap", "Gilasaurus", "Gilasaurus"] } : {}),
    };
    steps.push(expectPrompt({ by: id, kind: "cards" }), select(chosen));
    board[id] = {
      monsters: [seat === 1 ? "El Shaddoll Winda" : cards[(seat + count - 1) % count], "Mystical Elf", ...(seat === 0 ? ["Gilasaurus"] : [])],
      grave: seat === 0 ? ["Creature Swap"] : [],
    };
  }
  steps.push(expectNotOffered("specialSummon", "Gilasaurus", "p0"), expectBoard(board));
  ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
    id: `rotate-control-${format}-winda-keeps-summon-count`,
    title: "Winda keeps the used Special Summon allowance after it rotates",
    source: "ADR-0002 [R-FFA-RESOURCE-ROTATION]; stock SwapControl",
    rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-ONGOING"],
    tags: ["multiplayer", format, "card:31036355", "card:94977269"],
    setup,
    steps,
  }));
}

for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  const steps: Step[] = [activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    const chosen = seat === 0 ? "Destiny HERO - Plasma" : cards[seat];
    const other = seat === 1 ? "Sangan" : "Mystical Elf";
    setup[id] = { monsters: [chosen, other], ...(seat === 0 ? { hand: ["Creature Swap"] } : {}) };
    steps.push(expectPrompt({ by: id, kind: "cards" }), select(chosen));
    board[id] = {
      monsters: [seat === 1 ? "Destiny HERO - Plasma" : cards[(seat + count - 1) % count], other],
      grave: seat === 0 ? ["Creature Swap"] : [],
      lp: seat === 1 ? 7900 : 8000,
    };
  }
  steps.push(expectBoard(board));
  ROTATE_CONTROL_SCENARIOS.push({
    ...rotationScenario({
      id: `rotate-control-${format}-plasma-former-target-event`,
      title: "A former target of Plasma can respond to the control change",
      source: "ADR-0002 [R-FFA-RESOURCE-ROTATION]; stock SwapControl",
      rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-ONGOING"],
      tags: ["multiplayer", format, "card:31036355", "card:83965310"],
      setup,
      steps,
    }),
    fixture: `local c=Duel.GetFieldCard(1,LOCATION_MZONE,1)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CONTROL_CHANGED)
e:SetRange(LOCATION_MZONE)
e:SetOperation(function() Duel.SetLP(0,Duel.GetLP(0)-100) end)
c:RegisterEffect(e)`,
  });
}

// A stationary negation aura also changes which selected cards it affects.
for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  const chosen = cards.slice(0, count);
  chosen[count - 1] = "Sangan";
  const steps: Step[] = [activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    const other = seat === 0 ? "Destiny HERO - Plasma" : "Mystical Elf";
    setup[id] = { monsters: [chosen[seat], other], ...(seat === 0 ? { hand: ["Creature Swap"] } : {}) };
    steps.push(expectPrompt({ by: id, kind: "cards" }), select(chosen[seat]));
    board[id] = {
      monsters: [chosen[(seat + count - 1) % count], other],
      grave: seat === 0 ? ["Creature Swap"] : [], lp: seat === 0 ? 7900 : 8000,
    };
  }
  steps.push(expectBoard(board));
  ROTATE_CONTROL_SCENARIOS.push({
    ...rotationScenario({
      id: `rotate-control-${format}-stationary-plasma-target-event`,
      title: "A monster that enters Plasma's field can respond to the control change",
      source: "ADR-0002 [R-FFA-RESOURCE-ROTATION]",
      rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-ONGOING"],
      tags: ["multiplayer", format, "card:31036355", "card:83965310"], setup, steps,
    }),
    fixture: `local c=Duel.GetFieldCard(${count - 1},LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CONTROL_CHANGED)
e:SetRange(LOCATION_MZONE)
e:SetOperation(function() Duel.SetLP(0,Duel.GetLP(0)-100) end)
c:RegisterEffect(e)`,
  });
}

for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  const steps: Step[] = [activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    const monsters = [cards[seat], ...Array(4).fill("Mystical Elf")];
    setup[id] = { monsters, ...(seat === 0 ? { hand: ["Creature Swap"] } : {}) };
    steps.push(expectPrompt({ by: id, kind: "cards" }), select(cards[seat]));
    board[id] = { monsters, grave: seat === 0 ? ["Creature Swap"] : [] };
  }
  steps.push(expectBoard(board));
  ROTATE_CONTROL_SCENARIOS.push({
    ...rotationScenario({
      id: `rotate-control-${format}-blocked-destination-is-atomic`,
      title: "A disabled outgoing slot stops the entire rotation on full fields",
      source: "ADR-0002 [R-FFA-RESOURCE-ROTATION]; stock zone checks",
      rules: ["R-FFA-RESOURCE-ROTATION"],
      tags: ["multiplayer", format, "card:31036355"], setup, steps,
    }),
    fixture: `local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD)
e:SetCode(EFFECT_DISABLE_FIELD)
e:SetValue(1)
Duel.RegisterEffect(e,1)`,
  });

  const extraSetup: Scenario["setup"] = { format };
  const extraBoard: Parameters<typeof expectBoard>[0] = {};
  const extraSteps: Step[] = [activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    const chosen = seat === 0 ? "Invoked Oceanus" : cards[seat];
    extraSetup[id] = {
      monsters: seat === 0 ? [null, "Mystical Elf", null, null, null, chosen] : [chosen, "Mystical Elf"],
      ...(seat === 0 ? { hand: ["Creature Swap"] } : {}),
    };
    extraSteps.push(expectPrompt({ by: id, kind: "cards" }), select(chosen));
    const received = seat === 1 ? "Invoked Oceanus" : cards[(seat + count - 1) % count];
    extraBoard[id] = {
      monsters: [received, "Mystical Elf"], grave: seat === 0 ? ["Creature Swap"] : [],
      zones: { m0: received, emz0: null, emz1: null }, lp: seat === 0 ? 7900 : 8000,
    };
  }
  extraSteps.push(expectBoard(extraBoard));
  ROTATE_CONTROL_SCENARIOS.push({
    ...rotationScenario({
      id: `rotate-control-${format}-extra-to-main-range`,
      title: "An Extra Monster Zone monster rotates to a Main Monster Zone with the correct effects",
      source: "ADR-0002 [R-FFA-RESOURCE-ROTATION]; Invoked Oceanus official script",
      rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-ONGOING"],
      tags: ["multiplayer", format, "card:31036355", "card:6772168"],
      setup: extraSetup, steps: extraSteps,
    }),
    fixture: `local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CONTROL_CHANGED)
e:SetOperation(function()
 local c=Duel.GetFieldCard(2,LOCATION_MZONE,0)
 if c:IsHasEffect(EFFECT_CANNOT_SELECT_BATTLE_TARGET) and not c:IsHasEffect(EFFECT_TO_GRAVE_REDIRECT) then
  Duel.SetLP(0,7900)
 end
end)
Duel.RegisterEffect(e,0)`,
  });
}

for (const format of ["ffa3", "ffa4"] as const) {
  const count = format === "ffa3" ? 3 : 4;
  const positions = ["def", "set", "atk", "def"] as const;
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  const steps: Step[] = [activate("Creature Swap", "p0")];
  for (let seat = 0; seat < count; seat++) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    setup[id] = { monsters: [{ card: cards[seat], pos: positions[seat] }, "Mystical Elf"], ...(seat === 0 ? { hand: ["Creature Swap"] } : {}) };
    steps.push(expectPrompt({ by: id, kind: "cards" }), select(cards[seat]));
    const from = (seat + count - 1) % count;
    board[id] = { monsters: [cards[from], "Mystical Elf"], grave: seat === 0 ? ["Creature Swap"] : [], zones: { m0: { card: cards[from], pos: positions[from] } } };
  }
  steps.push(expectBoard(board));
  ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
    id: `rotate-control-${format}-keeps-battle-positions`,
    title: "The rotation keeps face-down and Defense Position monsters in their positions",
    source: "Creature Swap official script; ADR-0002 [R-FFA-RESOURCE-ROTATION]",
    rules: ["R-FFA-RESOURCE-ROTATION"],
    tags: ["multiplayer", format, "card:31036355"], setup, steps,
  }));
}


// Stock SwapControl and SelfDestroyUnique let the new controller choose either copy.
for (const keep of ["incoming", "existing"] as const) {
  ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
    id: `rotate-control-ffa3-unique-conflict-new-controller-keeps-${keep}`,
    title: `The new controller chooses to keep the ${keep} Amazoness Tiger`,
    source: "Amazoness Tiger official script; stock SwapControl / SelfDestroyUnique; same as 1v1",
    rules: ["R-FFA-RESOURCE-ROTATION", "R-COMMON-ONGOING"],
    tags: ["multiplayer", "ffa3", "card:31036355", "card:10979723"],
    setup: {
      format: "ffa3",
      p0: { hand: ["Creature Swap"], monsters: ["Amazoness Tiger", "Mystical Elf"] },
      p1: { monsters: ["Dark Magician", "Amazoness Tiger"] },
      p2: { monsters: ["Summoned Skull", "Mystical Elf"] },
    },
    steps: [
      activate("Creature Swap", "p0"),
      expectPrompt({ by: "p0", kind: "cards" }), select("Amazoness Tiger"),
      expectPrompt({ by: "p1", kind: "cards" }), select("Dark Magician"),
      expectPrompt({ by: "p2", kind: "cards" }), select("Summoned Skull"),
      expectPrompt({ by: "p0", kind: "places" }), zone("p0", "m0"),
      expectPrompt({ by: "p1", kind: "places" }), zone("p1", "m0"),
      expectPrompt({ by: "p2", kind: "places" }), zone("p2", "m0"),
      expectPrompt({ by: "p1", kind: "cards", title: "Select the card(s) to keep on the field" }),
      expectPickOptions([{ seat: "p1", card: "Amazoness Tiger" }, { seat: "p1", card: "Amazoness Tiger" }], "p1"),
      select({ card: "Amazoness Tiger", from: "mzone", seq: keep === "incoming" ? 0 : 1 }),
      expectBoard({
        p0: { monsters: ["Summoned Skull", "Mystical Elf"], grave: keep === "incoming" ? ["Creature Swap"] : ["Creature Swap", "Amazoness Tiger"] },
        p1: { monsters: ["Amazoness Tiger"], grave: keep === "incoming" ? ["Amazoness Tiger"] : [], zones: { m0: keep === "incoming" ? "Amazoness Tiger" : null, m1: keep === "existing" ? "Amazoness Tiger" : null } },
        p2: { monsters: ["Dark Magician", "Mystical Elf"], grave: [] },
      }),
    ],
  }));
}

ROTATE_CONTROL_SCENARIOS.push(rotationScenario({
  id: "rotate-control-1v1-stock-unique-conflict-new-controller-chooses",
  title: "Stock Creature Swap lets the new controller keep the incoming Tiger",
  source: "Amazoness Tiger official script; stock SwapControl / SelfDestroyUnique; same as FFA",
  rules: ["R-COMMON-ONGOING"],
  tags: ["1v1", "card:31036355", "card:10979723"],
  setup: {
    format: "1v1",
    p0: { hand: ["Creature Swap"], monsters: ["Amazoness Tiger", "Mystical Elf"] },
    p1: { monsters: ["Dark Magician", "Amazoness Tiger"] },
  },
  steps: [
    activate("Creature Swap", "p0"),
    expectPrompt({ by: "p0", kind: "cards" }), select("Amazoness Tiger"),
    expectPrompt({ by: "p1", kind: "cards" }), select("Dark Magician"),
    expectPrompt({ by: "p0", kind: "places" }), zone("p0", "m0"),
    expectPrompt({ by: "p1", kind: "places" }), zone("p1", "m0"),
    expectPrompt({ by: "p1", kind: "cards", title: "Select the card(s) to keep on the field" }),
    expectPickOptions([{ seat: "p1", card: "Amazoness Tiger" }, { seat: "p1", card: "Amazoness Tiger" }], "p1"),
    select({ card: "Amazoness Tiger", from: "mzone", seq: 0 }),
    expectBoard({
      p0: { monsters: ["Dark Magician", "Mystical Elf"], grave: ["Creature Swap"] },
      p1: { monsters: ["Amazoness Tiger"], grave: ["Amazoness Tiger"], zones: { m0: "Amazoness Tiger", m1: null } },
    }),
  ],
}));
