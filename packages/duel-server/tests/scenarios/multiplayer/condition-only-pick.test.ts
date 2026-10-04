import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { activate, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectPrompt, expectPickSeats, expectNoEvent, pickOpponent, select, xyz, type BoardExpect, type DuelistId, type Scenario } from "../../support/dsl.js";

function proof(format: "ffa3" | "ffa4", domain: boolean, layout: "none" | "joined-only" | "last-only" | "two"): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const succeeds = layout === "last-only" || layout === "two";
  const setup: Scenario["setup"] = { format, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const [i, seat] of seats.entries()) {
    const count = i === 0 || layout === "none" ? 0 : layout === "joined-only" ? 3 : i === seats.length - 1 || (layout === "two" && i === 1) ? 5 : 1;
    const extra = Array(count).fill("Number 39: Utopia");
    setup[seat] = { hand: [], monsters: ["Mystical Elf"], deck: Array(3).fill("Mystical Elf"), extra,
      grave: i === 0 ? ["Re-Cover"] : [], ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { lp: i === 0 && succeeds ? 6000 : 8000, hand: [], spells: [],
      monsters: i === 0 && succeeds ? ["Mystical Elf", "Re-Cover"] : ["Mystical Elf"],
      grave: i === 0 && !succeeds ? ["Re-Cover"] : [], banished: [], extra, deckCount: 3,
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  return defineScenario({ id: `condition-only-${format}-${layout}${domain ? "-domain" : ""}`,
    title: "Re-Cover tests one opponent's Extra Deck without a declaration", source: "ADR 0002 R-FFA-OPP-ONE",
    rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:58695102"], setup,
    steps: [expectPrompt({ by: "p0", context: "action" }),
      ...(succeeds ? [activate("Re-Cover", "p0"), expectPrompt({ by: "p0", context: "action" })] : [expectNotOffered("activate", "Re-Cover", "p0")]),
      expectBoard(board)] });
}
function opponentOperation(format: "ffa3" | "ffa4", domain: boolean): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const setup: Scenario["setup"] = { format, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const hand = seat === "p0" ? [] : ["Battle Ox", "Silver Fang", "Giant Rat", "Axe Raider"];
    setup[seat] = { hand, monsters: [], deck: Array(3).fill("Mystical Elf"),
      spells: seat === "p0" ? [{ card: "Trap Dustshoot", pos: "set" }] : [],
      ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { lp: 8000, hand: seat === "p1" ? hand.slice(1) : hand, monsters: [], spells: [],
      grave: seat === "p0" ? ["Trap Dustshoot"] : [], banished: [], extra: [], deckCount: seat === "p1" ? 4 : 3,
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  return defineScenario({ id: `condition-read-opponent-operation-${format}${domain ? "-domain" : ""}`,
    title: "Trap Dustshoot declares before its indirect opponent-hand operation",
    source: "ADR 0002 R-FFA-OPP-ONE", rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:64697231"], setup,
    steps: [activate("Trap Dustshoot", "p0"), expectPickSeats(seats.slice(1), "p0"),
      expectNoEvent({ kind: "chain-resolving", card: 64697231 }), pickOpponent("p1", "p0"),
      select({ card: "Battle Ox", owner: "p1" }), expectPrompt({ by: "p0", context: "action" }), expectBoard(board)] });
}
function opponentLock(format: "ffa3" | "ffa4", domain: boolean): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const eligible: DuelistId[] = format === "ffa3" ? ["p1", "p2"] : ["p1", "p3"];
  const setup: Scenario["setup"] = { format, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const hand = seat === "p0" ? [] : eligible.includes(seat) ? ["Battle Ox", "Silver Fang", "Giant Rat", "Axe Raider"] : ["Battle Ox", "Silver Fang"];
    setup[seat] = { hand, monsters: seat === "p0" ? ["Mystical Elf"] : [], deck: Array(3).fill("Mystical Elf"),
      spells: seat === "p0" ? [{ card: "Penalty Game!", pos: "set" }] : [],
      ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    const drew = seat === "p2" || (seat === "p0" && domain);
    board[seat] = { lp: 8000, hand: drew ? [...hand, "Mystical Elf"] : hand, monsters: seat === "p0" ? ["Mystical Elf"] : [],
      spells: [], grave: seat === "p0" ? ["Penalty Game!"] : [], banished: [], extra: [], deckCount: drew ? 2 : 3,
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  return defineScenario({ id: `condition-opponent-lock-${format}${domain ? "-domain" : ""}`,
    title: "Penalty Game! declares its eligible opponent before its option and locks only that draw",
    source: "ADR 0002 R-FFA-OPP-ONE", rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:967928"], setup,
    steps: [activate("Penalty Game!", "p0"), expectPickSeats(eligible, "p0"),
      expectNoEvent({ kind: "chain-resolving", card: 967928 }), pickOpponent("p1", "p0"),
      choose("draw", "p0"), expectPrompt({ by: "p0", context: "action" }), endTurn("p0"),
      expectPrompt({ by: "p1", context: "action" }), endTurn("p1"), expectPrompt({ by: "p2", context: "action" }), expectBoard(board)] });
}
function opponentOverlay(format: "ffa3" | "ffa4", domain: boolean): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const eligible: DuelistId[] = format === "ffa3" ? ["p1", "p2"] : ["p1", "p3"];
  const setup: Scenario["setup"] = { format, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    setup[seat] = { hand: seat === "p0" ? ["Xyz Revenge"] : [],
      grave: seat === "p0" ? ["Number 39: Utopia", "Number 17: Leviathan Dragon"] : [],
      monsters: eligible.includes(seat) ? [xyz("Number 39: Utopia", ["Silver Fang", "Battle Ox"])] : [],
      deck: Array(3).fill("Mystical Elf"), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    const hasXyz = seat === "p0" || eligible.includes(seat);
    board[seat] = { lp: 8000, hand: [], monsters: hasXyz ? ["Number 39: Utopia"] : [], spells: [],
      grave: seat === "p0" ? ["Xyz Revenge", "Number 17: Leviathan Dragon"] : [], banished: [], extra: [], deckCount: 3,
      ...(hasXyz ? { zones: { m0: { card: "Number 39: Utopia", materials: seat === "p0" || seat === "p1" ? 1 : 2 } } } : {}),
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  return defineScenario({ id: `condition-opponent-overlay-${format}${domain ? "-domain" : ""}`,
    title: "Xyz Revenge declares before its own target and takes material only from that opponent",
    source: "ADR 0002 R-FFA-OPP-ONE", rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "card:10275411"], setup,
    steps: [activate("Xyz Revenge", "p0"), expectPickSeats(eligible, "p0"),
      expectNoEvent({ kind: "chain-resolving", card: 10275411 }), pickOpponent("p1", "p0"),
      select({ card: "Number 39: Utopia", owner: "p0", from: "grave" }), select({ card: "Silver Fang", owner: "p1" }),
      expectPrompt({ by: "p0", context: "action" }), expectBoard(board)] });
}
async function run(scenario: Scenario) {
  const compiled = compileBoard(scenario.setup);
  const skip = "local e=Effect.GlobalEffect();e:SetType(EFFECT_TYPE_FIELD);e:SetCode(EFFECT_SKIP_DP);e:SetProperty(EFFECT_FLAG_PLAYER_TARGET);e:SetTargetRange(1,1);Duel.RegisterEffect(e,0)";
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts: [...compiled.options.startupScripts!,
      ...(scenario.id.startsWith("condition-opponent-lock-") ? [] : [{ name: "condition-only-draw-control.lua", content: skip }]),
      ...(scenario.id.startsWith("condition-opponent-overlay-") ? [{ name: "condition-overlay-procedure.lua",
        content: "for c in aux.Next(Duel.GetFieldGroup(0,LOCATION_GRAVE,0)) do if c:IsType(TYPE_XYZ) then c:CompleteProcedure() end end" }] : [])], seed: ["1", "2", "3", "4"] });
  try { const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, i) => session.run(step, i + 1));
  } finally { game.close(); }
}
describeWithCores("condition-only eligibility", [liveNseat, ...needs.domainMulti()], () =>
  runScenarios("condition-only-pick", [false, true].flatMap(domain => (["ffa3", "ffa4"] as const).flatMap(format =>
    [...(["none", "joined-only", "last-only", "two"] as const).map(layout => proof(format, domain, layout)), opponentOperation(format, domain),
      opponentLock(format, domain), opponentOverlay(format, domain)])), run));
