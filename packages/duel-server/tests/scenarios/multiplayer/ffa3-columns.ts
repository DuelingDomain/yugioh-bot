import { activate, endTurn, expectBoard, expectEliminated, expectNotOffered, expectOffered, expectPickOptions, expectPickSeats, expectPrompt, normalSummon, number, pickOpponent, pass, position, select, specialSummon, surrender, yes, zone, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { SEATS, turnsBefore, type Seat } from "./seat-kit.js";

const ELF = "Mystical Elf", OX = "Battle Ox", FUSE = "Fuse Line", KNIGHT = "Mekk-Knight Purple Nightfall";
const POT = "Pot of Greed", SCUFFLE = "Small Scuffle", LOW = "Watapon", IMP = "Infinite Impermanence";
const slots = (seq: number, card: string) => Array.from({ length: seq + 1 }, (_, i) => i === seq ? card : null);
function scenario(id: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `ffa3-columns-${id}`, title: id.replaceAll("-", " "),
    source: "Owner decision 2026-10-05 [R-FFA-THREE-COLUMNS]", rules: ["R-FFA-THREE-COLUMNS"],
    tags: ["multiplayer", "ffa3", "column"], setup: { ...setup, format: "ffa3" }, steps });
}
function chosen(peer: "p1" | "p2"): Scenario {
  return scenario(`choose-${peer}-mirrored-only`, {
    p0: { spells: [null, { card: FUSE, pos: "set" }] },
    p1: { monsters: [ELF, null, null, OX], spells: [null, null, null, { card: POT, pos: "set" }] },
    p2: { monsters: [ELF, null, null, OX], spells: [null, null, null, { card: POT, pos: "set" }] },
  }, [activate(FUSE, "p0"), expectPickSeats(["p1", "p2"], "p0"), pickOpponent(peer, "p0"),
    expectPickOptions([{ seat: peer, card: OX }, { seat: peer, label: "Face-down card" }], "p0"), select({ card: OX, owner: peer }),
    expectPrompt({ by: "p0", context: "action" }), expectBoard({
      p0: { grave: [FUSE] }, p1: { monsters: peer === "p1" ? [ELF] : [ELF, OX], grave: peer === "p1" ? [OX] : [] },
      p2: { monsters: peer === "p2" ? [ELF] : [ELF, OX], grave: peer === "p2" ? [OX] : [] },
    })]);
}
function peerLeaves(): Scenario {
  const card = "Sour Scheduling - Red Vinegar Vamoose";
  return scenario("bound-peer-leaves-before-resolution", {
    p0: { spells: [null, { card, pos: "set" }, { card: FUSE, pos: "set" }] },
    p1: { monsters: slots(3, OX) }, p2: { monsters: [null, null, ELF, OX] },
  }, [activate(card, "p0"), expectPickSeats(["p1", "p2"], "p0"), pickOpponent("p1", "p0"),
    expectPrompt({ by: "p0", context: "chain" }), surrender("p1"), expectEliminated("p1"), pass("p0"), pass("p0"),
    expectPrompt({ by: "p0", context: "action" }), expectBoard({ p2: { monsters: [ELF, OX], grave: [], hand: [] } })]);
}
function survivor(actor: Seat, peer: Seat, kind: "knight" | "fuse" | "scuffle"): Scenario {
  const dead = SEATS.ffa3.find(s => s !== actor && s !== peer)!;
  const setup: Scenario["setup"] = { [actor]: { hand: [POT] } };
  const steps: Step[] = [...turnsBefore("ffa3", actor), ...(actor !== "p0" && kind !== "knight" ? Array.from({ length: 5 }, () => pass(actor)) : []), surrender(dead), expectEliminated(dead), activate(POT, actor)];
  if (kind === "knight") {
    setup[actor]!.hand!.push(KNIGHT);
    setup[peer] = { monsters: slots(3, ELF), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] };
    steps.push(expectOffered("specialSummon", KNIGHT, actor), specialSummon(KNIGHT, actor),
      expectPrompt({ by: actor, context: "action" }), expectBoard({ [actor]: { zones: { m1: KNIGHT } }, [peer]: { monsters: [ELF] } }));
  } else if (kind === "fuse") {
    setup[actor]!.spells = [null, { card: FUSE, pos: "set" }];
    setup[actor]!.monsters = slots(1, ELF);
    setup[peer] = { monsters: slots(3, OX), spells: [null, null, null, { card: "Dark Hole", pos: "set" }] };
    steps.push(activate(FUSE, actor), expectPickOptions([{ seat: actor, card: ELF }, { seat: peer, card: OX }, { seat: peer, label: "Face-down card" }], actor),
      select({ card: OX, owner: peer }), expectPrompt({ by: actor, context: "action" }), expectBoard({ [peer]: { monsters: [], grave: [OX] } }));
  } else if (kind === "scuffle") {
    setup[actor]!.spells = [{ card: SCUFFLE, pos: "set" }]; setup[actor]!.hand!.push(LOW);
    setup[peer] = { hand: [LOW] };
    steps.push(activate(SCUFFLE, actor), expectPickOptions([0,1,2,3,4].map(i => ({ seat: actor, label: `Monster Zone ${i + 1}` })), actor),
      zone(actor, "m1", actor), position("atk", actor), yes(peer), position("atk", peer),
      expectPrompt({ by: actor, context: "action" }), expectBoard({ [actor]: { zones: { m1: LOW } }, [peer]: { zones: { m3: LOW } } }));
  }
  return scenario(`${actor}-${peer}-${kind}-after-${dead}-leaves`, setup, steps);
}
const passive = scenario("three-alive-summon-own-field-only", {
  p0: { hand: [KNIGHT, POT] }, p1: { monsters: slots(3, ELF), spells: [null,null,null,{card:POT,pos:"set"}] },
  p2: { monsters: slots(3, ELF), spells: [null,null,null,{card:POT,pos:"set"}] },
}, [activate(POT,"p0"),expectNotOffered("specialSummon", KNIGHT, "p0"), expectBoard({ p0: { monsters: [] }, p1: { monsters: [ELF] }, p2: { monsters: [ELF] } })]);
function impermanence(peer: "p1" | "p2", eliminated: boolean, continuous = false, actor: "p0" | "p1" = "p0"): Scenario {
  const dead = SEATS.ffa3.find(s => s !== actor && s !== peer)!;
  const remedy = "Goblin's Secret Remedy", tenki = "Fire Formation - Tenki", wolf = "Gene-Warped Warwolf";
  return scenario(`impermanence-${actor}-${peer}-${eliminated ? "two" : "three"}-alive-${continuous ? "continuous" : "activation"}`, {
    [actor]: { spells: [null, { card: IMP, pos: "set" }] },
    [peer]: { monsters: ["Giant Rat", null, null, null, wolf], hand: [remedy, POT], ...(continuous ? { spells: [null,null,null,tenki] } : {}) },
  }, [...turnsBefore("ffa3",actor), ...(actor !== "p0" ? Array.from({length:5},()=>pass(actor)) : []), ...(eliminated ? [surrender(dead), expectEliminated(dead)] : []), endTurn(actor), pass(actor),
    activate(IMP, actor), activate(remedy, peer), zone(peer,"s0",peer),
    activate(POT, peer), zone(peer,continuous ? "s0" : "s3",peer), expectPrompt({by:peer,context:"action"}),
    expectBoard({ [peer]: { hand: Array(continuous ? 3 : 1).fill(ELF),
      zones: { m4: {card:wolf,attack: 2000} }, grave:[remedy,POT] } })]);
}
function disablaster(eliminated: boolean): Scenario {
  const card="Disablaster the Negation Fortress", trooper="Card Trooper";
  return scenario(`disablaster-${eliminated ? "two" : "three"}-alive`, {
    p0:{monsters:slots(1,card)},p1:{monsters:slots(3,trooper)},
  }, [...(eliminated ? [surrender("p2"), expectEliminated("p2")] : []),endTurn("p0"),activate(trooper,"p1"),number(3,"p1"),
    expectPrompt({by:"p1",context:"action"}),expectBoard({p1:{zones:{m3:{card:trooper,attack:eliminated ? 400 : 1900}}}})]);
}
function crown(peer: "p1" | "p2", eliminated: boolean): Scenario {
  const card="Magical Musket - Crooked Crown", musket="Magical Musketeer Calamity", haunted="Call of the Haunted";
  const dead=peer === "p1" ? "p2" : "p1";
  return scenario(`crown-${peer}-${eliminated ? "two" : "three"}-alive-prompt-order`, {
    p0:{spells:[null,card],hand:[musket]},[peer]:{spells:[{card:haunted,pos:"set"}],grave:[ELF]},
  }, [...(eliminated ? [surrender(dead),expectEliminated(dead)] : []),activate(card,"p0"),
    ...(eliminated ? [] : [expectPickSeats(["p1","p2"],"p0"),pickOpponent(peer,"p0")]),
    pass(peer),zone("p0","m1","p0"),activate(haunted,peer),
    expectPickOptions([0,1,2,4].map(i=>({seat:peer,label:`Monster Zone ${i+1}`})),peer),zone(peer,"m0",peer),
    expectPrompt({by:"p0",context:"action"}),expectBoard({p0:{zones:{m1:musket}},[peer]:{zones:{m0:ELF,m3:null}}})]);
}
function paranoia(eliminated: boolean): Scenario {
  const card="Distrust Paranoia", twisters="Twin Twisters", raigeki="Raigeki";
  return scenario(`paranoia-immunity-${eliminated ? "two" : "three"}-alive`, {
    p0:{spells:[null,{card,pos:"set"}]},p1:{hand:[twisters,raigeki]},
  }, [...(eliminated ? [surrender("p2"),expectEliminated("p2")] : []),endTurn("p0"),activate(twisters,"p1"),
    select({card:ELF,owner:"p1",from:"hand"}),yes("p0"),zone("p0","m1","p0"),activate(raigeki,"p1"),zone("p1","s3","p1"),
    expectPrompt({by:"p1",context:"action"}),expectBoard({p0:{monsters:eliminated ? [card] : [],grave:eliminated ? [] : [card]}})]);
}
function bingo(peer: "p1" | "p2", eliminated: boolean): Scenario {
  const card="Bingo Card", dead=peer === "p1" ? "p2" : "p1";
  const other={monsters:slots(4,OX),spells:[null,null,null,null,{card:POT,pos:"set" as const}]};
  return scenario(`bingo-${peer}-${eliminated ? "two" : "three"}-alive`, {
    p0:{monsters:[ELF],spells:[{card,pos:"set"}]},p1:other,p2:other,
  }, [...(eliminated ? [surrender(dead),expectEliminated(dead)] : []),activate(card,"p0"),
    ...(eliminated ? [] : [expectPickSeats(["p1","p2"],"p0"),pickOpponent(peer,"p0")]),
    select({card:ELF,owner:"p0"}),expectPrompt({by:"p0",context:"action"}),
    expectBoard({p0:{monsters:[],grave:[ELF,card]},[peer]:{monsters:[],spells:[],grave:[OX,POT]},
      ...(!eliminated ? {[dead]:{monsters:[OX],spells:[POT],grave:[]}} : {})})]);
}
function yajiro(): Scenario {
  const card="Yajiro Invader";
  return scenario("yajiro-two-alive",{p0:{monsters:slots(2,card)},p2:{}},[
    surrender("p1"),expectEliminated("p1"),endTurn("p0"),normalSummon(ELF,"p2"),zone("p2","m4","p2"),
    expectPrompt({by:"p2",context:"action"}),expectBoard({p0:{zones:{m2:null,m1:card}},p2:{zones:{m4:ELF}}})]);
}
function moveColumn(card: string, peer: "p1" | "p2"): Scenario {
  return scenario(`${card.startsWith("Sprind") ? "sprind" : "goldilocks"}-${peer}-choose-before-zone`, {
    p0:{monsters:slots(2,card)},p1:{monsters:slots(3,OX)},p2:{monsters:slots(3,OX)},
  },[activate(card,"p0"),expectPickSeats(["p1","p2"],"p0"),pickOpponent(peer,"p0"),zone("p0","m1","p0"),
    ...(card.startsWith("Sprind") ? [yes("p0")] : []),expectPrompt({by:"p0",context:"action"}),
    expectBoard({p0:{zones:{m1:card,m2:null}},[peer]:{monsters:[],grave:[OX]},[peer === "p1" ? "p2" : "p1"]:{monsters:[OX],grave:[]}})]);
}
function emzColumn(peer: "p1" | "p2"): Scenario {
  const spider="Link Spider";
  return scenario(`choose-${peer}-mirrored-emz`, {
    p0:{spells:[null,{card:FUSE,pos:"set"}]},p1:{monsters:slots(6,spider)},p2:{monsters:slots(6,spider)},
  },[activate(FUSE,"p0"),expectPickSeats(["p1","p2"],"p0"),pickOpponent(peer,"p0"),
    expectPrompt({by:"p0",context:"action"}),expectBoard({[peer]:{monsters:[],grave:[spider]},
      [peer === "p1" ? "p2" : "p1"]:{monsters:[spider],grave:[]}})]);
}
function independentEmzColumn(): Scenario {
  const spider="Link Spider";
  return scenario("last-two-independent-emz-same-column", {
    p0:{monsters:slots(5,spider),hand:[KNIGHT,POT]},p2:{monsters:slots(6,spider)},
  },[surrender("p1"),expectEliminated("p1"),activate(POT,"p0"),specialSummon(KNIGHT,"p0"),
    expectPrompt({by:"p0",context:"action"}),expectBoard({p0:{zones:{emz0:spider,m1:KNIGHT}},p2:{zones:{emz1:spider}}})]);
}
function sour(): Scenario {
  const card="Sour Scheduling - Red Vinegar Vamoose";
  return scenario("sour-condition-before-target",{p0:{spells:[null,{card,pos:"set"}]},p1:{monsters:slots(3,OX)},p2:{monsters:slots(3,OX)}},[
    activate(card,"p0"),expectPickSeats(["p1","p2"],"p0"),pickOpponent("p2","p0"),
    expectPrompt({by:"p0",context:"action"}),expectBoard({p1:{monsters:[OX],hand:[]},p2:{monsters:[],hand:[OX]}})]);
}
function fullEmzColumn(card: "Bingo Card" | "Blasting Fuse", eliminated: boolean, missing: "none" | "own-main" | "peer-spell"): Scenario {
  const spider = "Link Spider";
  return scenario(`${card === "Bingo Card" ? "bingo" : "blasting"}-full-emz-${eliminated ? "two" : "three"}-alive-missing-${missing}`, {
    p0: { hand: [POT], monsters: [null, missing === "own-main" ? null : ELF, null, null, null, spider], spells: [null, { card, pos: "set" }] },
    p1: { monsters: [null, null, null, OX, null, null, spider], spells: missing === "peer-spell" ? [] : [null, null, null, { card: "Dark Hole", pos: "set" }] },
    p2: { monsters: [null, null, null, OX, null, null, spider], spells: missing === "peer-spell" ? [] : [null, null, null, { card: "Dark Hole", pos: "set" }] },
  }, [...(eliminated ? [surrender("p1"), expectEliminated("p1")] : []), activate(POT, "p0"),
    ...(missing !== "none" ? [expectNotOffered("activate", card, "p0"), expectBoard({ p0: { spells: [card] } })] : [
      activate(card, "p0"), ...(eliminated ? [] : [expectPickSeats(["p1", "p2"], "p0"), pickOpponent("p2", "p0")]),
      ...(card === "Bingo Card" ? [select({ card: spider, owner: "p0" })] : []),
      expectPrompt({ by: "p0", context: "action" }),
      expectBoard({ p0: { monsters: [], grave: [POT, ELF, spider, card] }, p2: { monsters: [], spells: [], grave: [OX, spider, "Dark Hole"] },
        ...(!eliminated ? { p1: { monsters: [OX, spider], spells: ["Dark Hole"], grave: [] } } : {}) }),
    ])]);
}
const standard = [peerLeaves(),...(["Bingo Card", "Blasting Fuse"] as const).flatMap(card => [false, true].flatMap(eliminated => (["none", "own-main", "peer-spell"] as const).map(missing => fullEmzColumn(card, eliminated, missing)))),sour(),emzColumn("p1"),emzColumn("p2"),independentEmzColumn(),moveColumn("Sprind the Irondash Dragon","p1"),moveColumn("Sprind the Irondash Dragon","p2"),moveColumn("Goldilocks the Battle Landscaper","p1"),moveColumn("Goldilocks the Battle Landscaper","p2"),crown("p1",false),crown("p2",false),crown("p1",true),crown("p2",true),paranoia(false),paranoia(true),bingo("p1",false),bingo("p2",false),bingo("p1",true),bingo("p2",true),yajiro(),impermanence("p2",true,false,"p1"),impermanence("p2",true,true,"p1"),impermanence("p1",false), impermanence("p1",false,true), impermanence("p1",true), impermanence("p2",true), impermanence("p1",true,true), impermanence("p2",true,true), disablaster(false),disablaster(true),chosen("p1"), chosen("p2"), passive,
  ...([["p0", "p1"], ["p0", "p2"], ["p1", "p2"]] as const).flatMap(([actor, peer]) =>
    (["knight", "fuse", "scuffle"] as const).map(kind => survivor(actor, peer, kind)))];
export const FFA3_COLUMN_SCENARIOS = [...standard, ...standard.map(domainVariant)];
