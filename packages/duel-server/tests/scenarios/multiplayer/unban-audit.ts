import {
  activate, changePosition, defineScenario, expectBoard, expectNotOffered, expectPickSeats,
  faceDown, pickOpponent, expectPrompt, raw, endTurn, expectTurn, xyz, select, normalSummon, attack, yes, choose, type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

import { COMPARE_GAP_SCENARIOS } from "./compare-gaps.js";
import { domainProof } from "./proof-domain.js";

type Format = "ffa3" | "ffa4" | "tag";
const FORMATS: Format[] = ["ffa3", "ffa4", "tag"];
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const CARDS = {
  "life-equalizer": [17178486, "Life Equalizer"],
  "creature-seizure": [15305240, "Creature Seizure"],
  "dummy-golem": [13532663, "Dummy Golem"],
  "switcheroroo": [30426226, "Switcheroroo"],
  "morphing-jar": [33508719, "Morphing Jar"],
  "multiple-destruction": [14057297, "Multiple Destruction"],
  "exchange-spirit": [17484499, "Exchange of the Spirit"],
} as const;
type Kind = keyof typeof CARDS;
const HAND = ["Silver Fang", "Battle Ox", "Celtic Guardian", "Axe Raider"];
const DECK = ["Mystical Elf", "Beaver Warrior", "Skull Servant", "Feral Imp"];

function audit(kind: Kind, format: Format, domain = false, invalid = false): Scenario {
  const count = format === "ffa3" ? 3 : 4;
  const seats = SEATS.slice(0, count);
  const [code, card] = CARDS[kind];
  const picked = SEATS[count - 1];
  const lp = format === "tag" ? 16000 : 8000;
  const setup: Scenario["setup"] = { format, deckSize: 10, skipOpeningDraw: true, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    const seat = seats[i];
    setup[seat] = { hand: [HAND[i]], deck: Array(10).fill(DECK[i]), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { lp, hand: [HAND[i]], monsters: [], spells: [], grave: [], banished: [], extra: [], deckCount: 10 };
  }
  const steps: Step[] = [];
  const pair = ["life-equalizer", "creature-seizure", "dummy-golem", "switcheroroo"].includes(kind);
  if (kind === "life-equalizer") {
    setup.p0!.spells = [faceDown(card)];
    for (const seat of seats.slice(1)) {
      setup[seat]!.lp = seat === "p1" ? 4000 : 18000;
      board[seat]!.lp = setup[seat]!.lp;
    }
    if (format === "tag") {
      // Both members read the same team LP. The initial opposing side is 26000.
      setup.p1!.lp = 26000; setup.p3!.lp = 26000;
      board.p1!.lp = 3000; board.p3!.lp = 3000;
      board.p2!.lp = 3000;
    } else board[picked]!.lp = 3000;
    board.p0!.lp = 3000; board.p0!.grave = [card];
    steps.push(activate(card, "p0"));
  } else if (kind === "creature-seizure" || kind === "switcheroroo" || kind === "dummy-golem") {
    for (let i = 0; i < count; i++) {
      setup[seats[i]]!.monsters = [HAND[i]];
      board[seats[i]]!.monsters = [HAND[i]];
    }
    if (kind === "dummy-golem") {
      setup.p0!.monsters = [faceDown(card)];
      board.p0!.monsters = [HAND[count - 1]];
      board[picked]!.monsters = [card];
      steps.push(changePosition(card, "p0"));
    } else {
      if (kind === "creature-seizure") setup.p0!.hand!.push(card);
      else setup.p0!.spells = [faceDown(card)];
      board.p0!.grave = [card];
      board.p0!.monsters = [HAND[count - 1]];
      board[picked]!.monsters = [HAND[0]];
      steps.push(activate(card, "p0"));
    }
    // Tag control swaps have joined-field rules and need dedicated multi-card placement proofs.
    if (format === "tag") throw new Error("Control fixtures use FFA only");
  } else if (kind === "morphing-jar") {
    setup.p0!.monsters = [faceDown(card)]; board.p0!.monsters = [card];
    for (let i = 0; i < count; i++) {
      board[seats[i]]!.grave = [HAND[i]];
      board[seats[i]]!.hand = Array(5).fill(DECK[i]);
      board[seats[i]]!.deckCount = 5;
    }
    steps.push(changePosition(card, "p0"));
  } else if (kind === "multiple-destruction") {
    setup.p0!.spells = [faceDown(card)];
    for (let i = 0; i < count; i++) {
      setup[seats[i]]!.hand = Array(invalid && i === count - 1 ? 2 : 3).fill(HAND[i]);
      board[seats[i]]!.hand = Array(5).fill(DECK[i]);
      board[seats[i]]!.deckCount = 8;
    }
    board.p0!.grave = [card];
    board.p0!.lp = lp - 900 * count;
    if (format === "tag") board.p2!.lp = board.p0!.lp;
    if (invalid) return defineScenario({ id: `unban-audit-${kind}-${format}${domain ? "-domain" : ""}-short-hand`, title: "Every living hand must have three cards",
      source: "Owner 2026-10-18; ADR-0002 R-COMMON-ALL-BOTH", rules: ["R-COMMON-ALL-BOTH"], tags: ["multiplayer", `card:${code}`], setup,
      steps: [expectNotOffered("activate", card, "p0")] });
    steps.push(activate(card, "p0"), ...seats.flatMap(seat => [expectPrompt({ by: seat, kind: "order" }), raw({ selected: ["card:0", "card:1", "card:2"] }, seat)]));
  } else {
    setup.p0!.spells = [faceDown(card)];
    for (let i = 0; i < count; i++) {
      setup[seats[i]]!.grave = Array(invalid && i === count - 1 ? 14 : 15).fill(HAND[i]);
      board[seats[i]]!.grave = [...Array(10).fill(DECK[i]), ...(i === 0 ? [card] : [])];
      board[seats[i]]!.deckCount = 15;
    }
    if (invalid && format === "tag") { setup.p1!.grave = Array(7).fill(HAND[1]); setup.p3!.grave = Array(7).fill(HAND[3]); }
    board.p0!.lp = lp - 1000;
    if (format === "tag") board.p2!.lp = lp - 1000;
    if (invalid) return defineScenario({ id: `unban-audit-${kind}-${format}${domain ? "-domain" : ""}-short-grave`, title: "Every living Graveyard must have fifteen cards",
      source: "Owner 2026-10-18; ADR-0002 R-COMMON-ALL-BOTH", rules: ["R-COMMON-ALL-BOTH"], tags: ["multiplayer", `card:${code}`], setup,
      steps: [expectNotOffered("activate", card, "p0")] });
    steps.push(activate(card, "p0"));
  }
  if (pair && format !== "tag") {
    const opponents = kind === "life-equalizer" ? seats.slice(2) : seats.slice(1);
    if (opponents.length > 1) steps.push(expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"));
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `unban-audit-${kind}-${format}${domain ? "-domain" : ""}`, title: `${card}: ${pair ? "only the selected opponent changes" : "every living duelist takes part"}`,
    source: "Owner 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md", rules: [pair ? "R-FFA-OPP-ONE" : "R-COMMON-ALL-BOTH"],
    tags: ["multiplayer", "unban-audit", `card:${code}`, format], setup, steps });
}
export const UNBAN_AUDIT_SCENARIOS = (Object.keys(CARDS) as Kind[]).flatMap(kind =>
  FORMATS.filter(format => format !== "tag" || !["creature-seizure", "switcheroroo", "dummy-golem"].includes(kind)).flatMap(format =>
    [false, true].flatMap(domain => [audit(kind, format, domain),
      ...(["multiple-destruction", "exchange-spirit"].includes(kind) ? [audit(kind, format, domain, true)] : [])])));

function skipTurnAudit(format: "ffa3" | "ffa4", domain: boolean): Scenario {
  const seats=SEATS.slice(0,format === "ffa3" ? 3 : 4);
  const picked=seats.at(-1)!;
  const card="Tellarknight Ptolemaeus";
  const setup: Scenario["setup"]={format,skipOpeningDraw:true,deckSize:15,...(domain?{mode:"domain"}:{})};
  for (const seat of seats) setup[seat]={...(domain?{deckMaster:"Blue-Eyes White Dragon"}:{})};
  setup.p0!.monsters=[xyz(card,Array(7).fill("Mystical Elf"))];
  const steps: Step[]=[activate(card,"p0"),expectPickSeats(seats.slice(1),"p0"),pickOpponent(picked,"p0"),
    expectBoard({p0:{grave:Array(7).fill("Mystical Elf"),zones:{m0:{card,materials:0}}}}),endTurn("p0")];
  for (const seat of seats.slice(1,-1)) steps.push(expectTurn(seat),endTurn(seat));
  steps.push(expectTurn("p0"),endTurn("p0"));
  for (const seat of seats.slice(1,-1)) steps.push(expectTurn(seat),endTurn(seat));
  steps.push(expectTurn(picked));
  return defineScenario({id:`unban-audit-ptolemaeus-${format}${domain?"-domain":""}`,title:"Only the declared opponent skips its next turn, then returns",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-ONE",rules:["R-FFA-OPP-ONE"],tags:["multiplayer","unban-audit","card:18326736",format],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...(["ffa3","ffa4"] as const).flatMap(f=>[false,true].map(domain=>skipTurnAudit(f,domain))));

function simpleSetup(format: Format, domain: boolean, deckSize=12): Scenario["setup"] {
  const setup: Scenario["setup"]={format,skipOpeningDraw:true,deckSize,...(domain?{mode:"domain"}:{})};
  for (const seat of SEATS.slice(0,format==="ffa3"?3:4)) setup[seat]={...(domain?{deckMaster:"Blue-Eyes White Dragon"}:{})};
  return setup;
}
function skullInvitation(format: Format, domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),tag=format==="tag";
  const setup=simpleSetup(format,domain);
  setup.p0!.hand=["Dark Hole"];setup.p0!.spells=[{card:"Skull Invitation",pos:"atk"}];
  const board: BoardExpect={};
  for (let i=0;i<seats.length;i++) {
    setup[seats[i]]!.monsters=[HAND[i]];
    board[seats[i]]={lp:tag?(i%2===0?15100:15400):i===0?7400:7700,hand:[],monsters:[],
      spells:i===0?["Skull Invitation"]:[],grave:[HAND[i],...(i===0?["Dark Hole"]:[])],deckCount:12};
  }
  return defineScenario({id:`unban-audit-skull-invitation-${format}${domain?"-domain":""}`,title:"Every real owner takes damage for cards sent to the GY together",
    source:"Owner 2026-10-18; ADR-0002 R-COMMON-ALL-BOTH",rules:["R-COMMON-ALL-BOTH"],tags:["multiplayer","unban-audit","card:98139712",format],setup,
    steps:[activate("Dark Hole","p0"),expectPrompt({by:"p0",context:"action"}),expectBoard(board)]});
}
function convulsion(format: Format, domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),setup=simpleSetup(format,domain,3);
  const board: BoardExpect={};
  for (let i=0;i<seats.length;i++) setup[seats[i]]!.deck=[HAND[i],DECK[i],"Mammoth Graveyard"];
  setup.p0!.hand=["Convulsion of Nature","De-Spell"];
  const steps: Step[]=[activate("Convulsion of Nature","p0"),expectPrompt({by:"p0",context:"action"}),endTurn("p0")];
  for (const seat of seats.slice(1)) steps.push(endTurn(seat));
  for (const seat of seats) board[seat]={hand:["Mammoth Graveyard",...(seat==="p0"?["De-Spell"]:[])],deckCount:2};
  steps.push(expectBoard(board),activate("De-Spell","p0"),endTurn("p0"));
  for (const seat of seats.slice(1)) steps.push(endTurn(seat));
  steps.push(expectBoard(Object.fromEntries(seats.map((seat,i)=>[seat,{hand:["Mammoth Graveyard",HAND[i]],deckCount:1,
    ...(i===0?{spells:[],grave:["Convulsion of Nature","De-Spell"]}:{})}]))));
  return defineScenario({id:`unban-audit-convulsion-${format}${domain?"-domain":""}`,title:"All Decks reverse while active and return when it leaves",
    source:"Owner 2026-10-18; core patch 0008 helpers processor part 3",rules:["R-COMMON-ALL-BOTH"],tags:["multiplayer","unban-audit","card:62966332",format],setup,steps});
}
function sixShinobi(format: "ffa3"|"ffa4", domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),picked=seats.at(-1)!,setup=simpleSetup(format,domain,20);
  setup.p0!.spells=[faceDown("The Six Shinobi")];
  setup.p0!.monsters=["The Six Samurai - Zanji","The Six Samurai - Yaichi","The Six Samurai - Yariza","The Six Samurai - Nisashi","The Six Samurai - Kamon","Legendary Six Samurai - Shi En"];
  const steps: Step[]=[activate("The Six Shinobi","p0"),expectPickSeats(seats.slice(1),"p0"),pickOpponent(picked,"p0"),endTurn("p0")];
  for (const seat of seats.slice(1,-1)) steps.push(expectTurn(seat),endTurn(seat));
  steps.push(expectTurn("p0"),endTurn("p0"));
  for (const seat of seats.slice(1,-1)) steps.push(expectTurn(seat),endTurn(seat));
  steps.push(expectTurn(picked));
  return defineScenario({id:`unban-audit-six-shinobi-${format}${domain?"-domain":""}`,title:"Only the declared opponent skips one turn",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-ONE",rules:["R-FFA-OPP-ONE"],tags:["multiplayer","unban-audit","card:6357341",format],setup,steps});
}
function doomVirus(format: "ffa3"|"ffa4", domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),picked=seats.at(-1)!,setup=simpleSetup(format,domain,20);
  setup.p0!.hand=["The Fang of Critias","Crush Card Virus"];setup.p0!.extra=["Doom Virus Dragon"];
  for (const seat of seats.slice(1)) setup[seat]={...setup[seat],hand:["Blue-Eyes White Dragon"],monsters:["Blue-Eyes White Dragon"],deck:Array(20).fill("Blue-Eyes White Dragon")};
  const steps: Step[]=[activate("The Fang of Critias","p0"),expectPickSeats(seats.slice(1),"p0"),pickOpponent(picked,"p0"),
    expectBoard({p0:{monsters:["Doom Virus Dragon"],grave:["The Fang of Critias","Crush Card Virus"]},[picked]:{hand:[],monsters:[],grave:Array(2).fill("Blue-Eyes White Dragon")}})];
  for (let turn=1;turn<=4;turn++) {
    steps.push(endTurn("p0"));
    for (const seat of seats.slice(1)) {
      steps.push(expectTurn(seat));
      if (seat===picked) steps.push(expectBoard({[picked]:{hand:turn<=3?[]:["Blue-Eyes White Dragon"],grave:Array(2+Math.min(turn,3)).fill("Blue-Eyes White Dragon")}}));
      else steps.push(expectBoard({[seat]:{hand:Array(turn+1).fill("Blue-Eyes White Dragon"),monsters:["Blue-Eyes White Dragon"]}}));
      steps.push(endTurn(seat));
    }
  }
  return defineScenario({id:`unban-audit-doom-virus-${format}${domain?"-domain":""}`,title:"The chosen opponent loses draws for three of its turns, then draws normally",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-ONE",rules:["R-FFA-OPP-ONE"],tags:["multiplayer","unban-audit","card:22804644",format],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...FORMATS.flatMap(format=>[false,true].flatMap(domain=>[skullInvitation(format,domain),convulsion(format,domain)])),
  ...(["ffa3","ffa4"] as const).flatMap(format=>[false,true].flatMap(domain=>[sixShinobi(format,domain),doomVirus(format,domain)])));
function controlTag(kind: "creature-seizure" | "dummy-golem", domain: boolean): Scenario {
  const card=CARDS[kind][1],setup=simpleSetup("tag",domain);
  for (let i=0;i<4;i++) setup[SEATS[i]]!.monsters=[HAND[i]];
  if (kind==="creature-seizure") setup.p0!.hand=[card];
  else setup.p0!.monsters=[faceDown(card)];
  const steps: Step[]=[kind==="creature-seizure"?activate(card,"p0"):changePosition(card,"p0")];
  if (kind==="creature-seizure") steps.push(expectPrompt({by:"p0",kind:"cards"}),select({card:HAND[2],owner:"p2"}));
  steps.push(expectPickSeats(["p1","p3"],"p0"),pickOpponent("p3","p0"),expectPrompt({by:"p3",kind:"cards"}),select({card:HAND[1],owner:"p1"}));
  const board: BoardExpect={p0:{monsters:kind==="creature-seizure"?[HAND[0]]:[HAND[1]],grave:kind==="creature-seizure"?[card]:[]},
    p1:{monsters:[kind==="creature-seizure"?HAND[2]:card]},p2:{monsters:[kind==="creature-seizure"?HAND[1]:HAND[2]]},p3:{monsters:[HAND[3]]}};
  steps.push(expectBoard(board));
  return defineScenario({id:`unban-audit-${kind}-tag${domain?"-domain":""}`,title:"The opposing member chooses from its joined field; actual controller seats swap",
    source:"Owner 2026-10-18; ADR-0002 R-TAG-SHARED-CARDS",rules:["R-TAG-SHARED-CARDS"],tags:["multiplayer","unban-audit",`card:${CARDS[kind][0]}`,"tag"],setup,steps});
}
function counterSpell(format: "ffa3"|"ffa4", domain: boolean, negative: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),attacker=seats.at(-1)!,setup=simpleSetup(format,domain,20);
  setup.p0!.spells=[faceDown(100200298)];setup.p0!.monsters=["Mystical Elf"];
  setup.p1!.monsters=negative?["Mystical Elf","Silver Fang","Beaver Warrior"]:["Mystical Elf"];
  setup[attacker]!.monsters=negative?["Battle Ox"]:["Battle Ox","Axe Raider"];
  const steps: Step[]=[...seats.slice(0,-1).map(seat=>endTurn(seat)),attack("Battle Ox",{card:"Mystical Elf",owner:"p1"},attacker)];
  if (negative) steps.push(expectPrompt({by:attacker,context:"action"}),expectBoard({p0:{spells:[100200298],grave:[]}}));
  else steps.push(activate(100200298,"p0"),expectPrompt({by:attacker,context:"action",notOffers:["to_bp"]}),expectBoard({p0:{spells:[],grave:[100200298],monsters:["Mystical Elf"],lp:8000},p1:{monsters:["Mystical Elf"],lp:8000},[attacker]:{monsters:["Battle Ox","Axe Raider"],lp:8000}}));
  return defineScenario({id:`unban-audit-counter-spell-${format}${domain?"-domain":""}${negative?"-other-monsters-do-not-qualify":""}`,title:"Attack branch uses the actual attacker, including when a third seat responds",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-RESPONSE",rules:["R-FFA-OPP-RESPONSE"],tags:["multiplayer","unban-audit","card:100200298",format],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...(["creature-seizure","dummy-golem"] as const).flatMap(kind=>[false,true].map(domain=>controlTag(kind,domain))),
  ...(["ffa3","ffa4"] as const).flatMap(format=>[false,true].flatMap(domain=>[false,true].map(negative=>counterSpell(format,domain,negative)))));
function grisaille(format: "ffa3"|"ffa4", domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),picked=seats.at(-1)!,setup=simpleSetup(format,domain,20),card="Grisaille Prison";
  setup.p0!.hand=["Summoned Skull"];setup.p0!.spells=[faceDown(card)];setup.p0!.monsters=["Mystical Elf","Number 39: Utopia"];
  for (const seat of seats.slice(1)) setup[seat]!.monsters=["Number 39: Utopia"];
  const locked=Object.fromEntries(seats.map(seat=>[seat,{zones:{[seat==="p0"?"m1":"m0"]:{card:"Number 39: Utopia",negated:true}}}]));
  const clear=Object.fromEntries(seats.map(seat=>[seat,{zones:{[seat==="p0"?"m1":"m0"]:{card:"Number 39: Utopia",negated:false}}}]));
  const steps: Step[]=[normalSummon("Summoned Skull","p0"),select({card:"Mystical Elf",owner:"p0"}),activate(card,"p0"),expectPickSeats(seats.slice(1),"p0"),pickOpponent(picked,"p0"),expectBoard(locked),endTurn("p0")];
  for (const seat of seats.slice(1)) steps.push(expectTurn(seat),expectBoard(locked),endTurn(seat));
  steps.push(expectTurn("p0"),expectBoard(clear));
  return defineScenario({id:`unban-audit-grisaille-${format}${domain?"-domain":""}`,title:"All Synchro/Xyz restrictions last until the declared opponent ends its next turn",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-ONE",rules:["R-FFA-OPP-ONE","R-COMMON-ALL-BOTH"],tags:["multiplayer","unban-audit","card:22888900",format],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...(["ffa3","ffa4"] as const).flatMap(format=>[false,true].flatMap(domain=>[grisaille(format,domain)])));
function multipleOffTurn(format: "ffa3"|"ffa4", domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),setup=simpleSetup(format,domain,10);
  for (let i=0;i<seats.length;i++) setup[seats[i]]={...setup[seats[i]],hand:Array(3).fill(HAND[i]),deck:Array(10).fill(DECK[i])};
  setup.p0!.hand!.push("Sparks");setup.p2!.spells=[faceDown("Multiple Destruction")];
  const board: BoardExpect={};
  for (let i=0;i<seats.length;i++) board[seats[i]]={hand:Array(5).fill(DECK[i]),deckCount:8,lp:i===2?8000-900*seats.length:i===1?7800:8000,grave:i===0?["Sparks"]:i===2?["Multiple Destruction"]:[],spells:[]};
  return defineScenario({id:`unban-audit-multiple-destruction-off-turn-${format}${domain?"-domain":""}`,title:"p2 responds to p0; all sorting starts with the real turn player",
    source:"Owner 2026-10-18; ADR-0002 R-COMMON-EACH-PLAYER",rules:["R-COMMON-EACH-PLAYER"],tags:["multiplayer","unban-audit","card:14057297",format],setup,
    steps:[activate("Sparks","p0"),pickOpponent("p1","p0"),activate("Multiple Destruction","p2"),
      ...seats.flatMap(seat=>[expectPrompt({by:seat,kind:"order"}),raw({selected:["card:0","card:1","card:2"]},seat)]),expectBoard(board)]});
}
function gambleAudit(format: Format, domain: boolean, result: "win"|"lose"|"short"): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),setup=simpleSetup(format,domain,20),tag=format==="tag";
  setup.p0!.spells=[faceDown("Gamble")];
  for (const seat of seats.slice(1)) setup[seat]!.hand=Array(result==="short"?3:seat===seats.at(-1)?6:1).fill("Silver Fang");
  const steps: Step[]=result==="short"?[expectNotOffered("activate","Gamble","p0")]:[
    activate("Gamble","p0"),choose(result==="win"?"tails":"heads","p0"),expectPrompt({by:"p0",context:"action"}),
    expectBoard({p0:{hand:result==="win"?Array(5).fill("Mystical Elf"):[],deckCount:result==="win"?15:20,grave:["Gamble"]}})];
  if (result==="lose") {
    steps.push(endTurn("p0"));
    for (const seat of seats.slice(1)) { steps.push(expectTurn(seat)); if (seat===seats.at(-1)) steps.push(normalSummon({card:"Silver Fang",nth:0},seat)); steps.push(endTurn(seat)); }
    steps.push(expectTurn("p1"));
    for (const seat of seats.slice(1)) { if (seat===seats.at(-1)) steps.push(normalSummon({card:"Silver Fang",nth:0},seat)); steps.push(endTurn(seat)); }
    steps.push(expectTurn("p0"));
  }
  return defineScenario({id:`unban-audit-gamble-${format}-${result}${domain?"-domain":""}`,title:result==="short"?"Opponent hands cannot add together to qualify":"The coin changes only the activator's draw or its own next turn",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-ONE",rules:[tag?"R-TAG-PARTNER":"R-FFA-OPP-ONE"],tags:["multiplayer","unban-audit","card:37313786",format],setup,steps});
}
function switcherTagUnsupported(domain: boolean): Scenario {
  const setup=simpleSetup("tag",domain);
  for (let i=0;i<4;i++) setup[SEATS[i]]!.monsters=[HAND[i]];
  setup.p0!.spells=[faceDown("Switcheroroo")];
  return defineScenario({id:`unban-audit-switcheroroo-tag-unsupported${domain?"-domain":""}`,title:"Joined Tag groups with multiple real controllers cannot be swapped",
    source:"Native SwapControl rejects mixed-controller groups; core patch 0024 keeps this stock contract",rules:["R-TAG-SHARED-CARDS"],tags:["multiplayer","unban-audit","unsupported-control","card:30426226","tag"],setup,
    steps:[activate("Switcheroroo","p0"),expectPrompt({by:"p0",context:"action"}),expectBoard({p0:{monsters:[HAND[0]],grave:["Switcheroroo"]},p1:{monsters:[HAND[1]]},p2:{monsters:[HAND[2]]},p3:{monsters:[HAND[3]]}})]});
}
UNBAN_AUDIT_SCENARIOS.push(...(["ffa3","ffa4"] as const).flatMap(format=>[false,true].map(domain=>multipleOffTurn(format,domain))),
  ...FORMATS.flatMap(format=>[false,true].flatMap(domain=>(["win","lose","short"] as const).map(result=>gambleAudit(format,domain,result)))),
  ...[false,true].map(domain=>switcherTagUnsupported(domain)));
function foreignMultiple(format: Format, domain: boolean): Scenario {
  const scenario=audit("multiple-destruction",format,domain);
  scenario.id=`unban-audit-multiple-destruction-foreign-hand-${format}${domain?"-domain":""}`;
  scenario.title="A foreign-owned hand card returns to its real owner's Deck and that owner sorts it";
  scenario.tags=[...scenario.tags,"foreign-owned-hand"];
  scenario.setup.p0!.hand=Array(2).fill(HAND[0]);
  scenario.steps=scenario.steps.map(step=>{
    if (step.op==="raw" && step.by==="p0") return raw({selected:["card:0","card:1"]},"p0");
    if (step.op==="raw" && step.by==="p2") return raw({selected:["card:0","card:1","card:2","card:3"]},"p2");
    if (step.op==="expectBoard") return expectBoard({...step.board,p0:{...step.board.p0,deckCount:7},p2:{...step.board.p2,deckCount:9}});
    return step;
  });
  return scenario;
}
function counterMonster(format: Format, domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),actor=seats.at(-1)!,defender=format==="tag"?"p2":"p1",setup=simpleSetup(format,domain,20);
  setup.p0!.spells=[faceDown(100200298)];setup.p0!.monsters=["Mystical Elf","Beaver Warrior"];
  setup[defender]!.monsters=["Mystical Elf"];
  setup[actor]!.monsters=[xyz("Number 39: Utopia",["Mystical Elf","Silver Fang"])];
  const steps: Step[]=[...seats.slice(0,-1).map(seat=>endTurn(seat)),attack("Number 39: Utopia",{card:"Mystical Elf",owner:defender},actor),
    yes(actor),select({card:"Mystical Elf",owner:actor}),activate(100200298,"p0"),
    expectBoard({p0:{spells:[],grave:[100200298],monsters:["Mystical Elf","Beaver Warrior"]},[actor]:{monsters:[],grave:["Number 39: Utopia","Mystical Elf","Silver Fang"]},[defender]:{monsters:["Mystical Elf"]}})];
  return defineScenario({id:`unban-audit-counter-monster-${format}${domain?"-domain":""}`,title:"The third seat negates and destroys the actual opponent's monster effect during battle",
    source:"Owner 2026-10-18; ADR-0002 R-FFA-OPP-RESPONSE",rules:["R-FFA-OPP-RESPONSE"],tags:["multiplayer","unban-audit","card:100200298",format],setup,steps});
}
function counterAttackTag(domain: boolean, negative: boolean): Scenario {
  const setup=simpleSetup("tag",domain,20);
  setup.p0!.spells=[faceDown(100200298)];setup.p0!.monsters=["Mystical Elf"];
  setup.p1!.monsters=["Silver Fang"];
  setup.p2!.monsters=negative?["Mystical Elf","Beaver Warrior"]:["Mystical Elf"];
  setup.p3!.monsters=negative?["Battle Ox"]:["Battle Ox","Axe Raider"];
  const steps: Step[]=[endTurn("p0"),endTurn("p1"),endTurn("p2"),attack("Battle Ox",{card:"Mystical Elf",owner:"p2"},"p3")];
  if (negative) steps.push(expectPrompt({by:"p3",context:"action"}),expectBoard({p0:{spells:[100200298],grave:[]}}));
  else steps.push(activate(100200298,"p0"),expectPrompt({by:"p3",context:"action",notOffers:["to_bp"]}),expectBoard({p0:{grave:[100200298],spells:[],lp:16000},p2:{monsters:["Mystical Elf"],lp:16000},p3:{monsters:["Battle Ox","Axe Raider"],lp:16000}}));
  return defineScenario({id:`unban-audit-counter-spell-tag${domain?"-domain":""}${negative?"-joined-own-team-does-not-qualify":""}`,title:"The comparison uses joined Tag fields and ends the actual attacker's Battle Phase",
    source:"Owner 2026-10-18; ADR-0002 R-TAG-SHARED-CARDS",rules:["R-TAG-SHARED-CARDS"],tags:["multiplayer","unban-audit","card:100200298","tag"],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...FORMATS.flatMap(format=>[false,true].flatMap(domain=>[foreignMultiple(format,domain),counterMonster(format,domain)])),
  ...[false,true].flatMap(domain=>[false,true].map(negative=>counterAttackTag(domain,negative))));

const kaiserOriginal=COMPARE_GAP_SCENARIOS.find(s=>s.id==="compare-gaps-ffa3-kaiser-colosseum-limit-counts-the-summoner-only")!;
for (const format of ["ffa3","ffa4"] as const) {
  const scenario: Scenario={...kaiserOriginal,id:`unban-audit-kaiser-colosseum-${format}`,title:"The Tribute limit counts the summoning duelist alone",
    setup:{...kaiserOriginal.setup,format,...(format==="ffa4"?{p3:{monsters:["Axe Raider"]}}:{})},
    steps:kaiserOriginal.steps.map(step=>step.op==="expectBoard" && format==="ffa4"?expectBoard({...step.board,p3:{monsters:["Axe Raider"],hand:[],grave:[],spells:[],lp:8000,deckCount:20}}):step)};
  UNBAN_AUDIT_SCENARIOS.push(scenario,domainProof(scenario,"Mystical Elf"));
}
function counterDraw(format: Format, domain: boolean): Scenario {
  const seats=SEATS.slice(0,format==="ffa3"?3:4),setup=simpleSetup(format,domain,20);
  setup.p0!.hand=["Battle Ox"];setup.p0!.grave=[100200298];
  const steps: Step[]=[endTurn("p0")];
  for (const seat of seats.slice(1)) steps.push(expectPrompt({by:seat,context:"action"}),endTurn(seat));
  steps.push(yes("p0"),select({card:"Battle Ox",owner:"p0",from:"hand"}),expectBoard({p0:{hand:["Mystical Elf"],monsters:["Battle Ox"],grave:[],banished:[100200298],deckCount:19}}));
  return defineScenario({id:`unban-audit-counter-own-draw-${format}${domain?"-domain":""}`,title:"Only the controller's normal draw offers the GY summon, including in Tag",
    source:"Counter Spell normal draw effect; ADR-0002 R-TAG-PARTNER",rules:[format==="tag"?"R-TAG-PARTNER":"R-FFA-OPP-ONE"],tags:["multiplayer","unban-audit","card:100200298",format],setup,steps});
}
UNBAN_AUDIT_SCENARIOS.push(...FORMATS.flatMap(format=>[false,true].map(domain=>counterDraw(format,domain))));
