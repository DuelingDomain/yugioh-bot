import { choose, pass, number, attack, position, yes, no, activate, defineScenario, endTurn, normalSummon, expectPickSeats, pickOpponent, expectEliminated, expectNotOffered, expectOffered, expectPickOptions, expectPrompt, select, specialSummon, surrender, zone, type DuelistExpect, type Scenario, type Step, setCard } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const ELF = "Mystical Elf", SPIDER = "Link Spider", IMDUK = "Imduk the World Chalice Dragon";
const SARYUJA = "Saryuja Skull Dread", KNIGHT = "Mekk-Knight Purple Nightfall";
const rule = "R-COMMON-EMZ";
const across = (seat: Seat): Seat => `p${(Number(seat[1]) + 2) % 4}` as Seat;
const slots = (seq: number, card: string) => Array.from({ length: seq + 1 }, (_, i) => i === seq ? card : null);
function createScenarios(mode: "standard" | "domain"): Scenario[] {
const openingHand = (): string[] => mode === "domain" ? [ELF] : [];
const openingDeck = () => mode === "domain" ? 19 : 20;
function scenario(id: string, format: Format, setup: Scenario["setup"], steps: Step[], rules: string[] = [rule]): Scenario {
  const result = defineScenario({ id: `df-shared-zones-${id}`, title: id.replaceAll("-", " "),
    source: rules.length ? `${SOURCE} [${rule}]` : SOURCE, rules, tags: ["multiplayer", format, "link", "column", "ffa-first-draw-included"], setup: { ...setup, format, mode: mode === "domain" ? "domain" : "normal" }, steps });
  return mode === "domain" ? domainVariant(result) : result;
}
function state(format: Format, actor: Seat): Record<Seat, DuelistExpect> {
  const result = {} as Record<Seat, DuelistExpect>;
  for (const [i, seat] of SEATS[format].entries()) result[seat] = {
    hand: i <= Number(actor[1]) && (i > 0 || mode === "domain") ? [ELF] : [],
    deckCount: i <= Number(actor[1]) && (i > 0 || mode === "domain") ? 19 : 20, extra: [],
  };
  return result;
}
function mirror(format: Format, actor: Seat): Scenario {
  const other = format === "ffa3" ? "p2" : across(actor);
  const setup: Scenario["setup"] = { [actor]: { monsters: [ELF], extra: [SPIDER] }, [other]: { monsters: slots(6, SPIDER) } };
  const board = state(format, actor);
  board[other] = { ...board[other], monsters: [SPIDER], zones: { emz0: null, emz1: SPIDER } };
  board[actor] = { ...board[actor], monsters: [SPIDER], grave: [ELF], zones: { emz0: format === "ffa4" ? null : SPIDER, emz1: format === "ffa4" ? SPIDER : null } };
  return scenario(`${format}-mirror-${actor}`, format, setup, [...turnsBefore(format, actor), specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
    ...(format === "ffa4" ? [] : [expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Extra Monster Zone (right)" }], actor), zone(actor, "emz0", actor)]),
    expectPrompt({ by: actor, context: "action" }), everySeat(format, board)]);
}
function arrows(actor: Seat): Scenario {
  const other = across(actor);
  const setup: Scenario["setup"] = { [actor]: { monsters: [ELF], extra: [SPIDER] }, [other]: { monsters: slots(5, IMDUK) } };
  const board = state("ffa4", actor);
  board[other] = { ...board[other], monsters: [IMDUK], zones: { emz0: IMDUK, emz1: null } };
  board[actor] = { ...board[actor], monsters: [SPIDER], grave: [ELF], zones: { m3: SPIDER, emz0: null, emz1: null } };
  return scenario(`ffa4-across-arrow-${actor}`, "ffa4", setup, [...turnsBefore("ffa4", actor), specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
    expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Monster Zone 4" }], actor), zone(actor, "m3", actor), everySeat("ffa4", board)]);
}
function columns(format: Format, actor: Seat): Scenario {
  const other = format === "ffa3" ? "p2" : across(actor);
  const setup: Scenario["setup"] = {
    [actor]: format === "ffa4" ? { hand: [KNIGHT] } : { hand: [KNIGHT, "Dark Hole"], monsters: [ELF], extra: [SPIDER] },
    [other]: { monsters: slots(3, ELF), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] },
  };
  const board = state(format, actor);
  board[other] = { ...board[other], monsters: [ELF], spells: ["Dark Hole"] };
  board[actor] = { ...board[actor], monsters: format === "ffa4" ? [KNIGHT] : [SPIDER, KNIGHT],
    zones: { m1: KNIGHT, ...(format === "ffa4" ? {} : { emz0: SPIDER, s1: { card: "Dark Hole", pos: "set" as const } }) },
    ...(format === "ffa4" ? {} : { grave: [ELF], spells: ["Dark Hole"] }) };
  const steps: Step[] = [...turnsBefore(format, actor)];
  if (format !== "ffa4") {
    // Foreign cards do not make a local column. One local Spell is also not enough.
    steps.push(expectNotOffered("specialSummon", KNIGHT, actor),
      setCard("Dark Hole", actor), zone(actor, "s1", actor),
      expectNotOffered("specialSummon", KNIGHT, actor),
      specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
      expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Extra Monster Zone (right)" }], actor),
      zone(actor, "emz0", actor));
  }
  steps.push(expectOffered("specialSummon", KNIGHT, actor), specialSummon(KNIGHT, actor), everySeat(format, board));
  return scenario(`${format}-across-column-${actor}`, format, setup, steps);
}
function geometry(format: Format, actor: Seat): Scenario {
  const reader = format === "ffa4" ? 95200120 : 95200121;
  const other = format === "ffa3" ? (actor === "p2" ? "p0" : "p2") : across(actor);
  const setup: Scenario["setup"] = { [actor]: { hand: [reader], monsters: [null, IMDUK, null, null, null, SARYUJA] },
    [other]: { monsters: slots(3, IMDUK), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] } };
  const board = state(format, actor);
  board[actor] = { ...board[actor], lp: format === "tag" ? 15500 : 7500, monsters: [IMDUK, SARYUJA], grave: [reader], hand: [...(board[actor].hand as string[]), ELF], deckCount: (board[actor].deckCount ?? 20) - 1 };
  board[other] = { ...board[other], monsters: [IMDUK], spells: ["Dark Hole"] };
  if (format === "ffa4") for (const seat of SEATS.ffa4.filter((s) => s !== actor && s !== other)) {
    setup[seat] = { monsters: slots(3, IMDUK), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] };
    board[seat] = { ...board[seat], monsters: [IMDUK], spells: ["Dark Hole"] };
  }
  return scenario(`${format}-geometry-api-${actor}`, format, setup, [...turnsBefore(format, actor), activate(reader, actor), expectPrompt({ by: actor, context: "action" }), everySeat(format, board)]);
}
function eliminated(actor: Seat): Scenario {
  const other = across(actor);
  const setup: Scenario["setup"] = { [actor]: { monsters: [ELF], extra: [SPIDER], hand: ["Pot of Greed", 95200138] }, [other]: { monsters: slots(6, SPIDER) } };
  const board = state("ffa4", actor);
  board[actor] = { ...board[actor], monsters: [SPIDER], grave: [ELF, "Pot of Greed", 95200138], hand: [...(board[actor].hand as string[]), ELF, ELF, ELF], deckCount: (board[actor].deckCount ?? 20) - 3,
    zones: { emz0: SPIDER, emz1: null } };
  board[other] = { lp: 8000, hand: [], deckCount: 0, extra: [], monsters: [], grave: [], spells: [], banished: [] };
  // Pot of Greed provides a real engine response that lets the pending loss land.
  return scenario(`ffa4-eliminated-across-${actor}`, "ffa4", setup, [...turnsBefore("ffa4", actor), activate(95200138, actor), surrender(other), activate("Pot of Greed", actor),
    expectEliminated(other), specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
    expectPickOptions([{ seat: actor, label: "Extra Monster Zone (left)" }, { seat: actor, label: "Extra Monster Zone (right)" }], actor), zone(actor, "emz0", actor), everySeat("ffa4", board)]);
}
function mask(code: number): Scenario {
  const setup: Scenario["setup"] = { p0: { spells: [null, { card: code, pos: "set" }] } };
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, spells: [code], hand: [...openingHand(), ELF], deckCount: openingDeck() - 1 };
  const steps: Step[] = [activate(code, "p0"), expectPickSeats(["p1", "p2", "p3"], "p0"), pickOpponent("p1", "p0")];
  if ((code === 95200125 || code === 95200129 || code === 95200132)) steps.push(zone("p1", "m3", "p0"));
  steps.push(expectPrompt({ by: "p0", context: "action" }), everySeat("ffa4", board));
  // Real Normal Summon place prompts show the target of each mask at every seat.
  for (const [i, seat] of SEATS.ffa4.entries()) {
    if (i) {
      steps.push(...turnsBefore("ffa4", seat, SEATS.ffa4[i - 1]));
      board[seat] = { ...board[seat], hand: [ELF], deckCount: 19 };
    }
    steps.push(normalSummon(ELF, seat));
    const dynamic = code === 95200122 || code === 95200123 || (code === 95200128 && i === 0) || (code === 95200129 && i > 0);
    const staticColumn = code === 95200126;
    const blocked = seat === "p0" && (dynamic || staticColumn) ? 1 : seat === (dynamic ? "p2" : "p1") ? 3 : -1;
    steps.push(expectPickOptions([0, 1, 2, 3, 4].filter((n) => n !== blocked).map((n) => ({ seat, label: `Monster Zone ${n + 1}` })), seat), zone(seat, "m0", seat));
    board[seat] = { ...board[seat], monsters: [ELF], hand: seat === "p0" ? openingHand() : [], zones: { m0: ELF } };
    steps.push(everySeat("ffa4", board));
  }
  return scenario(`ffa4-zone-mask-${code}`, "ffa4", setup, steps);
}
function linkedMask(): Scenario {
  const code = 95200130;
  const setup: Scenario["setup"] = { p0: { spells: [null, { card: code, pos: "set" }] } };
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, spells: [code], hand: [...openingHand(), ELF], deckCount: openingDeck() - 1 };
  for (const seat of ["p1", "p2", "p3"] as Seat[]) {
    setup[seat] = { monsters: [ELF], extra: [SPIDER] };
    board[seat] = { ...board[seat], monsters: [ELF], extra: [SPIDER] };
  }
  const steps: Step[] = [activate(code, "p0"), expectPickSeats(["p1", "p2", "p3"], "p0"), pickOpponent("p1", "p0"), everySeat("ffa4", board)];
  for (const [i, seat] of (["p1", "p2", "p3"] as Seat[]).entries()) {
    steps.push(...turnsBefore("ffa4", seat, `p${i}` as Seat), specialSummon(SPIDER, seat), select({ card: ELF, owner: seat }));
    const choices = [{ seat, label: "Extra Monster Zone (left)" }, { seat, label: "Extra Monster Zone (right)" }];
    if (seat === "p2") choices.push({ seat, label: "Monster Zone 4" });
    if (seat !== "p3") steps.push(expectPickOptions(choices, seat), zone(seat, seat === "p2" ? "m3" : "emz0", seat));
    board[seat] = { ...board[seat], hand: [ELF], extra: [], grave: [ELF], deckCount: 19, monsters: [SPIDER], zones: { [seat === "p2" ? "m3" : "emz0"]: SPIDER } };
    steps.push(everySeat("ffa4", board));
  }
  return scenario("ffa4-become-linked-zone-across", "ffa4", setup, steps);
}
function extraLink(actor: Seat, linked = true): Scenario {
  const code = linked ? 95200131 : 95200133, other = across(actor), tri = "Tri-Gate Wizard", bridge = "Proxy Dragon";
  const setup: Scenario["setup"] = { [actor]: { hand: [code], monsters: [null, null, null, null, null, IMDUK, IMDUK] } };
  const board = state("ffa4", actor);
  board[actor] = { ...board[actor], lp: 7500, monsters: [IMDUK, IMDUK], hand: [...(board[actor].hand as string[]), ELF], deckCount: (board[actor].deckCount ?? 20) - 1, grave: [code] };
  if (linked) {
    setup[other] = { monsters: [null, tri, bridge, tri] };
    board[other] = { ...board[other], monsters: [tri, bridge, tri] };
  }
  for (const seat of SEATS.ffa4.filter((s) => s !== actor && s !== other)) {
    setup[seat] = { monsters: [null, tri, bridge, tri] };
    board[seat] = { ...board[seat], monsters: [tri, bridge, tri] };
  }
  return scenario(`ffa4-${linked ? "across" : "unrelated"}-extra-link-${actor}`, "ffa4", setup, [...turnsBefore("ffa4", actor), activate(code, actor), expectPrompt({ by: actor, context: "action" }), everySeat("ffa4", board)]);
}
function officialTiamaton(): Scenario {
  const tiam = "Iron Dragon Tiamaton";
  const setup: Scenario["setup"] = { p0: { monsters: [null, tiam] } };
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, monsters: [tiam] };
  const steps: Step[] = [everySeat("ffa4", board)];
  for (const [i, seat] of (["p1", "p2", "p3"] as Seat[]).entries()) {
    steps.push(...turnsBefore("ffa4", seat, `p${i}` as Seat), normalSummon(ELF, seat));
    const blocked = seat === "p2" ? 3 : -1;
    steps.push(expectPickOptions([0, 1, 2, 3, 4].filter((n) => n !== blocked).map((n) => ({ seat, label: `Monster Zone ${n + 1}` })), seat), zone(seat, "m0", seat));
    board[seat] = { ...board[seat], monsters: [ELF], deckCount: 19, zones: { m0: ELF } };
    steps.push(everySeat("ffa4", board));
  }
  return scenario("ffa4-official-tiamaton-across-mask", "ffa4", setup, steps);
}
function deadSelected(): Scenario {
  const code = 95200125;
  const setup: Scenario["setup"] = { p0: { hand: ["Pot of Greed"], spells: [null, { card: code, pos: "set" }] } };
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, hand: [...openingHand(), ELF, ELF, ELF], spells: [code], grave: ["Pot of Greed"], deckCount: openingDeck() - 3, extra: [] };
  board.p1 = { lp: 8000, hand: [], monsters: [], spells: [], grave: [], banished: [], deckCount: 0, extra: [] };
  const steps: Step[] = [activate(code, "p0"), expectPickSeats(["p1", "p2", "p3"], "p0"), pickOpponent("p1", "p0"), zone("p1", "m3", "p0"),
    surrender("p1"), activate("Pot of Greed", "p0"), expectEliminated("p1"), everySeat("ffa4", board), endTurn("p0")];
  for (const seat of ["p2", "p3"] as Seat[]) {
    steps.push(normalSummon(ELF, seat), expectPickOptions([0, 1, 2, 3, 4].map((n) => ({ seat, label: `Monster Zone ${n + 1}` })), seat), zone(seat, "m0", seat));
    board[seat] = { ...board[seat], monsters: [ELF], deckCount: 19, zones: { m0: ELF } };
    steps.push(everySeat("ffa4", board));
    if (seat === "p2") steps.push(endTurn(seat));
  }
  return scenario("ffa4-dead-selected-zone-stays-empty", "ffa4", setup, steps);
}

// This starting legality check remains a negative control with no outcome marker.
function sideColumns(): Scenario {
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, hand: [KNIGHT, ...openingHand()] };
  board.p1 = { ...board.p1, monsters: [ELF], spells: ["Dark Hole"] };
  return scenario("ffa4-side-seat-column-control", "ffa4", { p0: { hand: [KNIGHT] }, p1: { monsters: slots(3, ELF), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] } },
    [expectNotOffered("specialSummon", KNIGHT, "p0"), everySeat("ffa4", board)], []);
}
function sorceress(): Scenario {
  const card = "Summon Sorceress", material = "Balancer Lord", gift = "Widget Kid";
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, monsters: [card], hand: [...openingHand(), ELF], grave: [material, material, material], zones: { emz0: card } };
  board.p2 = { ...board.p2, monsters: [gift], zones: { m3: gift } };
  return scenario("ffa4-official-summon-sorceress-across-only", "ffa4", { p0: { hand: [gift, ELF], monsters: [material, material, material], extra: [card] } },
    [specialSummon(card, "p0"), select({card: material, owner: "p0", seq: 0}, {card: material, owner: "p0", seq: 1}, {card: material, owner: "p0", seq: 2}), zone("p0", "emz0", "p0"),
      yes("p0"), select({card: gift, owner: "p0", from: "hand"}), expectPrompt({by: "p0", context: "action"}), everySeat("ffa4", board)]);
}
function trigger(card: string, victim: "p1" | "p2" | "both"): Scenario {
  const code = victim === "p1" ? 95200134 : victim === "p2" ? 95200135 : 95200136;
  const fire = card === "Firewall Dragon", triggered = victim !== "p1";
  const setup: Scenario["setup"] = { p0: { hand: fire ? [code, "Backup Secretary"] : [code], monsters: slots(5, card) },
    p1: { monsters: slots(3, ELF) }, p2: { monsters: slots(3, ELF) } };
  const board = state("ffa4", "p0");
  board.p0 = { ...board.p0, monsters: triggered && fire ? [card, "Backup Secretary"] : [card],
    hand: [...openingHand(), ...(fire && !triggered ? ["Backup Secretary"] : [])], grave: [code], zones: { emz0: card, ...(triggered && fire ? {m0: "Backup Secretary"} : {}) } };
  for (const seat of ["p1", "p2"] as const) board[seat] = { ...board[seat], monsters: victim === seat || victim === "both" ? [] : [ELF], grave: victim === seat || victim === "both" ? [ELF] : [] };
  const steps: Step[] = [activate(code,"p0")];
  if (triggered) steps.push(yes("p0"));
  steps.push(expectPrompt({by: "p0", context: "action"}), everySeat("ffa4", board));
  if (!fire) steps.push({op: "expectBoard", board: {p0: {zones: {emz0: {card, attack: triggered ? 2600 : 2200}}}}});
  return scenario(`ffa4-official-${fire ? "firewall" : "thunder-ogre"}-${victim}-leaves`, "ffa4", setup, steps);
}
function vector(): Scenario {
  const card="Vector Scare Archfiend";
  const board = state("ffa4", "p0");
  for (const seat of SEATS.ffa4) board[seat] = { hand: seat === "p0" ? [...openingHand(), ELF] : [ELF], deckCount: seat === "p0" ? openingDeck() - 1 : 19, extra: [] };
  board.p0 = {...board.p0, monsters: [card, ELF], zones: {m0: ELF, emz0: card}};
  board.p1 = {...board.p1, grave: [ELF]};
  return scenario("ffa4-official-vector-side-battle-no-foreign-revival", "ffa4", {p0: {monsters: [ELF,null,null,null,null,card]}, p1: {monsters: [{card: ELF, pos: "def"}]}},
    [endTurn("p0"),endTurn("p1"),endTurn("p2"),endTurn("p3"), attack(card,{card: ELF,owner: "p1"},"p0"), expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}
function toBeLinked(): Scenario {
  const code=95200137, board=state("ffa4","p0");
  board.p0={...board.p0,grave:[code],monsters:[SARYUJA],hand:[...openingHand(),ELF],deckCount:openingDeck()-1};
  for (const seat of ["p1","p2"] as const) board[seat]={...board[seat],monsters:[IMDUK]};
  return scenario("ffa4-to-be-linked-side-seat-control","ffa4",{p0:{hand:[code],monsters:[SARYUJA]},p1:{monsters:slots(5,IMDUK)},p2:{monsters:slots(5,IMDUK)}},
    [activate(code,"p0"),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}

function bindingGeometry(): Scenario {
  const proof=geometry("ffa4","p0");
  proof.id=`df-shared-zones-ffa4-mask-binding-all-readers${mode === "domain" ? "-domain" : ""}`;
  proof.title="FFA4: every mask reader keeps the across binding";
  proof.setup.p0={...proof.setup.p0,hand:[95200139]};
  proof.steps=proof.steps.map((step) => step.op==="activate" ? activate(95200139,"p0") : step.op==="expectBoard" ? {...step,board:{...step.board,p0:{...step.board.p0,grave:[95200139]}}} : step);
  return proof;
}

function duelMaskBinding(): Scenario {
  const code=95200142, board=state("ffa4","p0");
  board.p0={...board.p0,monsters:[SARYUJA],grave:[code],hand:[...openingHand(),ELF],deckCount:openingDeck()-1,lp:7500};
  board.p1={...board.p1,monsters:[SARYUJA]};
  return scenario("ffa4-duel-mask-binding-all-readers","ffa4",{p0:{hand:[code],monsters:slots(5,SARYUJA)},p1:{monsters:slots(5,SARYUJA)}},
    [activate(code,"p0"),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}

function disablaster(actor: "p1" | "p2"): Scenario {
  const card="Disablaster the Negation Fortress", trooper="Card Trooper", board=state("ffa4",actor);
  board.p0={...board.p0,monsters:[card]};
  board[actor]={...board[actor],monsters:[trooper],grave:[ELF,ELF,ELF],deckCount:16,zones:{m3:{card:trooper,attack:actor==="p1" ? 1900 : 400}}};
  return scenario(`ffa4-official-disablaster-${actor}-column`,"ffa4",{p0:{monsters:slots(1,card)},[actor]:{monsters:slots(3,trooper)}},
    [...turnsBefore("ffa4",actor),activate(trooper,actor),number(3,actor),expectPrompt({by:actor,context:"action"}),everySeat("ffa4",board)]);
}

function disablasterControlChange(): Scenario {
  const card="Disablaster the Negation Fortress", trooper="Card Trooper", enemy="Enemy Controller", board=state("ffa4","p1");
  board.p0={...board.p0,monsters:[card],hand:[95200141,...openingHand()]};
  board.p1={...board.p1,grave:[ELF,ELF,ELF],deckCount:16};
  board.p2={...board.p2,monsters:[trooper],grave:[ELF,enemy],zones:{m0:{card:trooper,attack:1900}}};
  return scenario("ffa4-official-disablaster-chain-seat-after-control-change","ffa4",{p0:{monsters:slots(1,card),hand:[95200141]},p1:{monsters:slots(3,trooper)},p2:{monsters:[ELF],spells:[{card:enemy,pos:"set"}]}},
    [endTurn("p0"),pass("p2"),pass("p2"),pass("p2"),pass("p2"),pass("p2"),activate(trooper,"p1"),number(3,"p1"),activate(enemy,"p2"),choose("Take control","p2"),expectPrompt({by:"p1",context:"action"}),everySeat("ffa4",board)]);
}

function sideCausesAcross(card: string): Scenario {
  const code=95200140, fire=card==="Firewall Dragon", board=state("ffa4","p1");
  board.p0={...board.p0,monsters:fire ? [card,"Backup Secretary"] : [card],hand:openingHand(),zones:{emz0:{card,...(fire ? {} : {attack:2600})},...(fire ? {m0:"Backup Secretary"} : {})}};
  board.p1={...board.p1,grave:[code]};
  board.p2={...board.p2,grave:[ELF]};
  return scenario(`ffa4-official-${fire ? "firewall" : "thunder-ogre"}-p1-destroys-p2`,"ffa4",{p0:{monsters:slots(5,card),hand:fire ? ["Backup Secretary"] : []},p1:{hand:[code]},p2:{monsters:slots(3,ELF)}},
    [endTurn("p0"),activate(code,"p1"),yes("p0"),expectPrompt({by:"p1",context:"action"}),everySeat("ffa4",board)]);
}
function thunderExtra(actor: "p1" | "p2"): Scenario {
  const card="Gouki Thunder Ogre", board=state("ffa4",actor);
  board.p0={...board.p0,monsters:[card]};
  board[actor]={...board[actor],hand:actor==="p1" ? [ELF,ELF] : [ELF],monsters:actor==="p1" ? [ELF] : [ELF,ELF],zones:{m0:ELF,...(actor==="p2" ? {m3:ELF} : {})}};
  return scenario(`ffa4-official-thunder-ogre-${actor}-extra-normal`,"ffa4",{p0:{monsters:slots(5,card)},[actor]:{hand:[ELF,ELF]}},
    [...turnsBefore("ffa4",actor),normalSummon(ELF,actor),...(actor==="p2" ? [choose("opt:0",actor)] : []),zone(actor,"m0",actor),...(actor==="p1" ? [expectNotOffered("normalSummon",ELF,actor)] : [expectOffered("normalSummon",ELF,actor),normalSummon(ELF,actor)]),everySeat("ffa4",board)]);
}

function orange(victim: "p1" | "p2"): Scenario {
  const code=victim==="p1" ? 95200134 : 95200135, card="Mekk-Knight Orange Sunset", gift="Mekk-Knight Purple Nightfall";
  const board=state("ffa4","p0");
  board.p0={...board.p0,monsters:victim==="p2" ? [card,gift] : [card],hand:[...openingHand(),...(victim==="p2" ? [] : [gift])],grave:[code],zones:{m1:card,...(victim==="p2" ? {m0:gift} : {})}};
  for (const seat of ["p1","p2"] as const) board[seat]={...board[seat],monsters:seat===victim ? [] : [ELF],grave:seat===victim ? [ELF] : []};
  return scenario(`ffa4-review2-orange-${victim}-leaves`,"ffa4",{p0:{hand:[code,gift],monsters:slots(1,card)},p1:{monsters:slots(3,ELF)},p2:{monsters:slots(3,ELF)}},
    [activate(code,"p0"),...(victim==="p2" ? [yes("p0"),zone("p0","m0","p0")] : []),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}
function preErrata(victim: "p1" | "p2"): Scenario {
  const proof=trigger("Firewall Dragon",victim);
  proof.id=`df-shared-zones-ffa4-review2-pre-errata-firewall-${victim}-leaves${mode === "domain" ? "-domain" : ""}`;
  proof.setup.p0={...proof.setup.p0,hand:[...(proof.setup.p0?.hand ?? []),ELF]};
  for(const step of proof.steps) if(step.op==="expectBoard" && step.board.p0 && Array.isArray(step.board.p0.hand))
    step.board.p0.hand=[...step.board.p0.hand,ELF];
  proof.title=`Pre-errata Firewall ${victim} leave filter`;
  proof.setup.p0={...proof.setup.p0,monsters:slots(5,"Firewall Dragon (pre-errata)")};
  if (victim==="p2") proof.steps.splice(2,0,select({card:"Backup Secretary",owner:"p0",from:"hand"}),zone("p0","m0","p0"));
  proof.steps=proof.steps.map(step => step.op==="expectBoard" ? {...step,board:{...step.board,p0:{...step.board.p0,monsters:victim==="p2" ? [5043020,"Backup Secretary"] : [5043020],zones:{emz0:5043020,...(victim==="p2" ? {m0:"Backup Secretary"} : {})}}}} : step);
  return proof;
}
function departedSummon(card: string, victim: "p1" | "p2", utility=false): Scenario {
  const code=utility ? (victim==="p1" ? 95200147 : 95200148) : (victim==="p1" ? 95200143 : 95200144), board=state("ffa4","p0");
  board.p0={...board.p0,monsters:[card],grave:[code],zones:{emz0:card}};
  board[victim]={...board[victim],grave:[ELF]};
  // The Spell sends a real card away, then calls the stock previous-state branch.
  // The assertion controls whether the real Draw operation can complete.
  board.p0={...board.p0,hand:[...openingHand(),ELF],deckCount:openingDeck()-1};
  return scenario(`ffa4-review2-${utility ? "utility-zpt" : card.includes("Gumblar") ? "gumblar" : card.includes("Bomber") ? "bomber" : "flash-charge"}-${victim}-previous-filter`,"ffa4",
    {p0:{monsters:slots(5,card),hand:[code]},[victim]:{monsters:slots(3,ELF)}},
    [activate(code,"p0"),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}

function foreignDeparted(card: string, victim: "p1" | "p2" | "p3", utility=false): Scenario {
  const code=(utility ? 95200151 : 95200148)+Number(victim[1]), board=state("ffa4","p0");
  board.p0={...board.p0,hand:[...openingHand(),ELF],deckCount:openingDeck()-1,grave:[code]};
  const flashSide=card==="Flash Charge Dragon" && victim==="p2";
  board.p1={...board.p1,monsters:[card],zones:{[flashSide ? "m2" : "emz0"]:card}};
  board[victim]={...board[victim],grave:[ELF]};
  return scenario(`ffa4-review2-foreign-link-${utility ? "utility-zpt" : card.includes("Gumblar") ? "gumblar" : card.includes("Bomber") ? "bomber" : "flash-charge"}-${victim}-previous-filter`,"ffa4",
    {p0:{hand:[code]},p1:{monsters:slots(flashSide ? 2 : 5,card)},[victim]:{monsters:victim==="p1" ? [null,ELF,null,null,null,card] : slots(flashSide ? 6 : victim==="p3" ? 3 : 1,ELF)}},
    [activate(code,"p0"),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}

function origin(): Scenario {
  const card="Steelswarm Origin", board=state("ffa4","p0");
  board.p0={...board.p0,monsters:[card],zones:{emz0:card}};
  for (const seat of ["p1","p2"] as const) board[seat]={...board[seat],monsters:[ELF],extra:[SPIDER]};
  const steps: Step[]=[];
  for (const seat of ["p1","p2"] as const) {
    steps.push(endTurn(seat==="p1" ? "p0" : "p1"),specialSummon(SPIDER,seat),select({card:ELF,owner:seat}));
    const choices=seat==="p1" ? [{seat,label:"Extra Monster Zone (left)"},{seat,label:"Extra Monster Zone (right)"}] : [{seat,label:"Extra Monster Zone (left)"},{seat,label:"Monster Zone 4"}];
    steps.push(expectPickOptions(choices,seat),zone(seat,seat==="p1" ? "emz0" : "m3",seat));
    board[seat]={...board[seat],hand:[ELF],deckCount:19,monsters:[SPIDER],grave:[ELF],extra:[],zones:{[seat==="p1" ? "emz0" : "m3"]:SPIDER}};
    steps.push(everySeat("ffa4",board));
  }
  return scenario("ffa4-review2-steelswarm-origin-side-and-across-zones","ffa4",{p0:{monsters:slots(5,card)},p1:{monsters:[ELF],extra:[SPIDER]},p2:{monsters:[ELF],extra:[SPIDER]}},steps);
}
function ownCostTarget(code: number): Scenario {
  const board=state("ffa4","p0");
  board.p0={...board.p0,monsters:[SARYUJA],grave:[code],lp:7500};
  for (const seat of ["p1","p2","p3"] as const) board[seat]={...board[seat],monsters:seat==="p2" ? ["Dark Magician"] : [ELF],grave:seat==="p2" ? [ELF] : []};
  const proof=scenario(`ffa4-review2-own-${code===95200145 ? "link" : "column"}-cost-then-opponent-target`,"ffa4",{p0:{hand:[code],monsters:slots(5,SARYUJA)},p1:{monsters:[ELF]},p2:{monsters:[ELF,"Dark Magician"]},p3:{monsters:[ELF]}},
    [activate(code,"p0"),zone("p0","s0","p0"),expectPickOptions([{seat:"p2",card:ELF},{seat:"p2",card:"Dark Magician"}],"p0"),select({card:ELF,owner:"p2"}),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
  proof.rules=[rule,"R-FFA-OPP-ONE"];
  return proof;
}

function kidbrave(format: Format, caster: Seat): Scenario {
  const kid="Magical Musketeer Kidbrave", musket="Magical Musketeer Caspar", pot="Pot of Greed";
  const match=format!=="ffa4" || caster==="p0" || caster==="p2";
  const board=state(format,caster);
  const ownHand=board.p0.hand as string[];
  board.p0={...board.p0,monsters:[kid],zones:{m1:kid},hand:[...ownHand,...(match ? [ELF,ELF] : [musket])],grave:match ? [musket] : [],deckCount:(board.p0.deckCount ?? 20)-(match ? 2 : 0)};
  if(caster==="p0") board.p0={...board.p0,grave:[musket,pot],hand:[...ownHand,ELF,ELF,ELF,ELF],deckCount:(board.p0.deckCount ?? 20)-2};
  else board[caster]={...board[caster],hand:[ELF,ELF,ELF],grave:[pot],deckCount:17};
  const setup: Scenario["setup"]={p0:{monsters:slots(1,kid),hand:[musket]},[caster]:{...(caster==="p0" ? {monsters:slots(1,kid)} : {}),hand:caster==="p0" ? [musket,pot] : [pot]}};
  return scenario(`${format}-review3-kidbrave-${caster}-spell-column`,format,setup,[...turnsBefore(format,caster),activate(pot,caster),zone(caster,caster==="p0" ? "s1" : "s3",caster),...(match ? [yes("p0")] : []),expectPrompt({by:caster,context:"action"}),everySeat(format,board)]);
}
function impermanence(caster: "p1" | "p2", permanent=false): Scenario {
  const tenki="Fire Formation - Tenki",warwolf="Gene-Warped Warwolf",trap="Infinite Impermanence",rat="Giant Rat",pot="Pot of Greed",remedy="Goblin's Secret Remedy",board=state("ffa4",caster);
  board.p0={...board.p0,grave:[trap],monsters:[],spells:[]};
  board[caster]={...board[caster],monsters:[rat],zones:{m0:rat}};
  board[caster]={...board[caster],lp:8600,hand:caster==="p1" ? [ELF,ELF,ELF] : [ELF],grave:[remedy,pot],deckCount:caster==="p1" ? 17 : 19};
  if(permanent) board[caster]={...board[caster],hand:[ELF,ELF,ELF],deckCount:17,spells:[tenki],monsters:[rat,warwolf],zones:{m0:rat,m4:{card:warwolf,attack:caster==="p1" ? 2100 : 2000},s3:tenki}};
  const advance: Step[]=[endTurn("p0"),pass("p0"),...(caster==="p2" ? [pass("p0"),pass("p0"),pass("p0"),endTurn("p1"),pass("p0"),pass("p0")] : [])];
  return scenario(`ffa4-review3-impermanence-${caster}-${permanent ? "continuous" : "spell"}-column`,"ffa4",{p0:{spells:[null,{card:trap,pos:"set"}]},[caster]:{monsters:permanent ? [rat,null,null,null,warwolf] : [rat],...(permanent ? {spells:[null,null,null,tenki]} : {}),hand:[remedy,pot]}},
    [...advance,activate(trap,"p0"),activate(remedy,caster),zone(caster,"s0",caster),activate(pot,caster),zone(caster,permanent ? "s0" : "s3",caster),expectPrompt({by:caster,context:"action"}),everySeat("ffa4",board)]);
}
function yajiro(caster: "p1" | "p2"): Scenario {
  const card="Yajiro Invader",pot="Pot of Greed",board=state("ffa4",caster);
  board.p0={...board.p0,monsters:[card],zones:{m2:caster==="p1" ? card : null,m1:caster==="p2" ? card : null}};
  board[caster]={...board[caster],monsters:[ELF],hand:[ELF,ELF],grave:[pot],deckCount:17,zones:{m4:ELF}};
  return scenario(`ffa4-review3-yajiro-${caster}-summon-column`,"ffa4",{p0:{monsters:slots(2,card)},[caster]:{hand:[pot]}},
    [...turnsBefore("ffa4",caster),activate(pot,caster),normalSummon(ELF,caster),zone(caster,"m4",caster),expectPrompt({by:caster,context:"action"}),everySeat("ffa4",board)]);
}
function naturalGumblar(caster: "p1" | "p2"): Scenario {
  const gum="Topologic Gumblar Dragon",reborn="Monster Reborn",board=state("ffa4",caster);
  board.p0={...board.p0,monsters:[gum],hand:caster==="p2" ? [] : [ELF],grave:caster==="p2" ? [ELF] : [],zones:{emz0:gum}};
  board[caster]={...board[caster],monsters:[ELF],grave:caster==="p2" ? [reborn,ELF] : [reborn],hand:caster==="p2" ? [] : [ELF],deckCount:19,zones:{m3:ELF}};
  return scenario(`ffa4-review3-natural-gumblar-${caster}-summon`,"ffa4",{p0:{monsters:slots(5,gum),hand:mode==="domain" ? [] : [ELF]},[caster]:{hand:[reborn],grave:[ELF]}},
    [...turnsBefore("ffa4",caster),activate(reborn,caster),zone(caster,"s0",caster),zone(caster,"m3",caster),expectPrompt({by:caster,context:"action"}),everySeat("ffa4",board)]);
}

function foreignColumn(seat: "p1" | "p2" | "p3"): Scenario {
  const code=95200154+Number(seat[1]),board=state("ffa4","p0");
  board.p0={...board.p0,grave:[code],hand:[...openingHand(),ELF],deckCount:openingDeck()-1};
  for(const holder of ["p1","p2","p3"] as const) board[holder]={...board[holder],monsters:[ELF],zones:{[holder==="p3" ? "m3" : "m1"]:ELF}};
  return scenario(`ffa4-review3-foreign-column-${seat}`,"ffa4",{p0:{hand:[code]},p1:{monsters:slots(1,ELF)},p2:{monsters:slots(1,ELF)},p3:{monsters:slots(3,ELF)}},
    [activate(code,"p0"),expectPrompt({by:"p0",context:"action"}),everySeat("ffa4",board)]);
}

const standard = [
  foreignColumn("p1"),foreignColumn("p2"),foreignColumn("p3"),
  ...(["p0","p1","p2","p3"] as const).map(seat=>kidbrave("ffa4",seat)),kidbrave("ffa3","p1"),kidbrave("tag","p1"),
  impermanence("p1"),impermanence("p2"),impermanence("p1",true),impermanence("p2",true),yajiro("p1"),yajiro("p2"),naturalGumblar("p1"),naturalGumblar("p2"),
  orange("p1"),orange("p2"),preErrata("p1"),preErrata("p2"),
  ...["Topologic Bomber Dragon","Topologic Gumblar Dragon","Flash Charge Dragon"].flatMap(card => (["p1","p2"] as const).map(seat => departedSummon(card,seat))),
  departedSummon(SARYUJA,"p1",true),departedSummon(SARYUJA,"p2",true),
  ...["Topologic Bomber Dragon","Topologic Gumblar Dragon","Flash Charge Dragon"].flatMap(card => (["p1","p2","p3"] as const).map(seat => foreignDeparted(card,seat))),
  ...(["p1","p2","p3"] as const).map(seat => foreignDeparted(SARYUJA,seat,true)),
  origin(),ownCostTarget(95200145),ownCostTarget(95200146),
  sideCausesAcross("Firewall Dragon"),sideCausesAcross("Gouki Thunder Ogre"),thunderExtra("p1"),thunderExtra("p2"),
  disablaster("p1"),disablaster("p2"),disablasterControlChange(),
  bindingGeometry(),duelMaskBinding(),
  sideColumns(), sorceress(), vector(), toBeLinked(), ...["Firewall Dragon", "Gouki Thunder Ogre"].flatMap((card) => (["p1", "p2", "both"] as const).map((seat) => trigger(card, seat))),
  ...SEATS.ffa4.flatMap((seat) => [mirror("ffa4", seat), arrows(seat), columns("ffa4", seat), geometry("ffa4", seat)]),
  mirror("ffa3", "p0"), mirror("tag", "p0"), columns("ffa3", "p0"), columns("tag", "p0"),
  geometry("ffa3", "p0"), geometry("ffa3", "p2"), geometry("tag", "p0"), geometry("tag", "p3"),
  eliminated("p0"), eliminated("p1"),
  linkedMask(), officialTiamaton(), deadSelected(), ...SEATS.ffa4.flatMap((seat) => [extraLink(seat), extraLink(seat, false)]),
  ...[95200122, 95200123, 95200124, 95200125, 95200126, 95200127, 95200128, 95200129, 95200132].map(mask),
];
return standard;
}
export const DF_SHARED_ZONE_SCENARIOS = [...createScenarios("standard"), ...createScenarios("domain")];
