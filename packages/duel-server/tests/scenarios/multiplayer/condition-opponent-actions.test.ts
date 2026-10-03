import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoMultiScriptsDirectory } from "../../../src/multi-scripts.js";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { activate, choose, changePhase, defineScenario, endTurn, expectBoard, expectNoEvent, expectPickSeats, expectPrompt,
  faceDown, pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag";
const seatsOf = (format: Format): DuelistId[] => format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const dm = { inZone: true, returns: 0, nextCost: 0 };

function inferno(format: Format, domain: boolean, two: boolean): Scenario {
  const seats = seatsOf(format), tag = format === "tag";
  const chosen: DuelistId = tag ? "p3" : seats.at(-1)!;
  const eligible: DuelistId[] = two ? ["p1", chosen] : [chosen];
  const setup: Scenario["setup"] = { format, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const foe = eligible.includes(seat), actor = seat === "p0";
    setup[seat] = { hand: actor ? ["Monster Reborn", "Silver Fang"] : foe ? ["Battle Ox", "Axe Raider"] : [],
      grave: actor ? ["Silver Fang", "Mystical Elf"] : [],
      monsters: foe ? ["Battle Ox", "Axe Raider"] : actor ? [] : [faceDown("Mystical Elf")],
      spells: actor ? [faceDown("Inferno Reckless Summon")] : [], deck: Array(3).fill("Mystical Elf"),
      ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { lp: tag ? 16000 : 8000, hand: foe ? seat === chosen ? ["Axe Raider"] : ["Battle Ox", "Axe Raider"] : [],
      monsters: actor ? ["Silver Fang", "Silver Fang"] : foe ? seat === chosen ? ["Battle Ox", "Axe Raider", "Battle Ox"] : ["Battle Ox", "Axe Raider"] : ["Mystical Elf"],
      spells: [], grave: actor ? ["Mystical Elf", "Monster Reborn", "Inferno Reckless Summon"] : [],
      banished: [], extra: [], deckCount: 3, ...(domain ? { deckMaster: dm } : {}) };
  }
  const steps: Step[] = [activate("Monster Reborn", "p0"), select({ card: "Silver Fang", owner: "p0", from: "grave" }),
    activate("Inferno Reckless Summon", "p0")];
  if (two) steps.push(expectPickSeats(eligible, "p0"), ...(!tag ? [expectNoEvent({ kind: "chain-resolving", card: 12247206 }), expectBoard({ p0: { hand: ["Silver Fang"], monsters: ["Silver Fang"] } })] : []), pickOpponent(chosen, "p0"));
  // The declared opponent chooses its own face-up monster at resolution.
  steps.push(expectPrompt({ by: chosen }), select({ card: "Battle Ox", owner: chosen }),
    expectPrompt({ by: "p0", context: "action" }), expectBoard(board));
  return defineScenario({ id: `condition-actions-inferno-${format}-${two ? "two" : "one"}${domain ? "-domain" : ""}`,
    title: "Inferno Reckless Summon declares before resolution and summons for that opponent",
    source: "ADR 0002 R-FFA-OPP-ONE", rules: tag ? ["R-TAG-SHARED-CARDS"] : ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "card:12247206"], setup, steps });
}

function whelp(format: Format, domain: boolean, two: boolean): Scenario {
  const seats = seatsOf(format), tag = format === "tag";
  const chosen: DuelistId = tag ? "p3" : seats.at(-1)!;
  const eligible: DuelistId[] = two ? ["p1", chosen] : [chosen];
  const setup: Scenario["setup"] = { format, attackFirstTurn: true, deckSize: 3, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const own = seat === "p0";
    const monsters = own ? ["Protector Whelp of the Destruction Swordsman", "Buster Blader", "Buster Blader, the Destruction Swordmaster"]
      : eligible.includes(seat) || tag ? [] : ["Mystical Elf"];
    setup[seat] = { hand: [], monsters, deck: Array(3).fill("Mystical Elf"), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    const damaged = tag ? seat === "p1" || seat === "p3" : seat === chosen;
    board[seat] = { lp: (tag ? 16000 : 8000) - (damaged ? 2600 : 0), hand: [], monsters,
      spells: [], grave: [], banished: [], extra: [], deckCount: 3, ...(domain ? { deckMaster: dm } : {}) };
  }
  const steps: Step[] = [changePhase("battle", "p0"), changePhase("main2", "p0"), yes("p0")];
  if (!tag && two) steps.push(expectPickSeats(eligible, "p0"), expectNoEvent({ kind: "chain-resolving", card: 47158777 }), pickOpponent(chosen, "p0"));
  steps.push(select({ card: "Buster Blader", owner: "p0" }), expectPrompt({ by: "p0", context: "action" }), expectBoard(board));
  return defineScenario({ id: `condition-actions-whelp-${format}-${two ? "two" : "one"}${domain ? "-domain" : ""}`,
    title: "Protector Whelp damages only a declared opponent with no monsters",
    source: "ADR 0002 R-FFA-OPP-ONE and R-FFA-OPP-RESPONSE", rules: tag ? ["R-TAG-LP"] : ["R-FFA-OPP-ONE", "R-FFA-OPP-RESPONSE"],
    tags: ["multiplayer", "card:47158777"], setup, steps });
}

function gamble(format: "ffa3" | "ffa4", domain: boolean, win: boolean): Scenario {
  const seats = seatsOf(format);
  const setup: Scenario["setup"] = { format, deckSize: 6, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const actor = seat === "p0";
    const hand = actor ? [] : Array(6).fill("Silver Fang");
    setup[seat] = { hand, monsters: ["Mystical Elf"], spells: actor ? [faceDown("Gamble")] : [],
      deck: Array(6).fill("Battle Ox"), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    board[seat] = { lp: 8000, hand: actor && win ? Array(5).fill("Battle Ox") : hand,
      monsters: ["Mystical Elf"], spells: [], grave: actor ? ["Gamble"] : [], banished: [], extra: [],
      deckCount: actor && win ? 1 : 6, ...(domain ? { deckMaster: dm } : {}) };
  }
  return defineScenario({ id: `condition-actions-gamble-${format}-${win ? "win" : "skip"}${domain ? "-domain" : ""}`,
    title: "Gamble checks one opponent's hand and gives no opponent pick for its own operation",
    source: "ADR 0002 R-FFA-OPP-ONE condition rule", rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "card:37313786"], setup,
    // With the fixed seed, the real toss is Tails. Check both card branches.
    steps: [activate("Gamble", "p0"), choose(win ? "tails" : "heads", "p0"),
      expectPrompt({ by: "p0", context: "action" }), expectBoard(board),
      ...(!win ? [endTurn("p0"), ...seats.slice(1).flatMap(seat =>
        [expectPrompt({ by: seat, context: "action" }), endTurn(seat)]),
        expectPrompt({ by: "p1", context: "action" }), expectBoard(board)] : [])] });
}

async function run(scenario: Scenario) {
  const compiled = compileBoard(scenario.setup);
  const skip = "local e=Effect.GlobalEffect();e:SetType(EFFECT_TYPE_FIELD);e:SetCode(EFFECT_SKIP_DP);e:SetProperty(EFFECT_FLAG_PLAYER_TARGET);e:SetTargetRange(1,1);Duel.RegisterEffect(e,0)";
  // Keep Inferno's one-opponent operation window. Omit only the explicit
  // target pick request, so the activation must come from the core analyzer.
  const overlay = mkdtempSync(join(tmpdir(), "condition-actions-"));
  cpSync(repoMultiScriptsDirectory(), overlay, { recursive: true });
  writeFileSync(join(overlay, "c12247206.lua"), "s.activate=aux.MPOne(s.activate)\n");
  const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiScriptsDirectory: overlay,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts: [...compiled.options.startupScripts!, { name: "condition-actions-draw-control.lua", content: skip }], seed: ["1", "2", "3", "4"] });
  try { const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, i) => session.run(step, i + 1));
  } catch (error) { if (process.env.CONDITION_ACTIONS_TRACE === "1") console.log(scenario.id, JSON.stringify(game.view(0))); throw error; } finally { game.close(); rmSync(overlay, { recursive: true, force: true }); }
}
describeWithCores("condition opponent actions", [liveNseat, ...needs.domainMulti()], () =>
  runScenarios("condition-opponent-actions", [false, true].flatMap(domain => (['ffa3', 'ffa4', 'tag'] as const).flatMap(format =>
    [...(format === 'tag' ? [] : [gamble(format, domain, true), gamble(format, domain, false)]), ...(format === 'tag' ? [true] : [false, true]).flatMap(two => [inferno(format, domain, two), whelp(format, domain, two)])])), run));
