import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, defineScenario, endTurn, expectBoard, expectEliminated, expectPickSeats, expectPrompt, expectTurn, pickOpponent,
  type Scenario, type DuelistId, type Step, type BoardExpect } from "../../support/dsl.js";

const SOURCE = "Giant Soldier of Stone", OX = "Battle Ox", ELF = "Mystical Elf";
type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Case = "live" | "dead" | "empty" | "card";

function proof(format: Format, domain: boolean, kind: Case): Scenario {
  const n = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const seats = (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, n);
  const declared = seats[n - 1];
  const ffa = format.startsWith("ffa");
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  for (const seat of seats) setup[seat] = {
    monsters: seat === "p0" ? [SOURCE] : [OX], deck: Array(20).fill(ELF),
    ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  const draws = Array<number>(n).fill(0);
  draws[0] = Number(domain);
  let recovered = 0;
  const board = (): BoardExpect => Object.fromEntries(seats.map((seat, i) => [seat,
    kind === "dead" && seat === declared ? {
      lp: 0, monsters: [], spells: [], grave: [], banished: [], hand: [], deckCount: 0,
      ...(domain ? { deckMaster: { inZone: false, returns: 0, nextCost: 0 } } : {}),
    } : {
      lp: (format === "tag" ? 16000 : 8000) + (seat === "p0" || (format === "tag" && seat === "p2") ? recovered : 0),
      monsters: seat === "p0" ? [SOURCE] : [OX], spells: [], grave: [], banished: [],
      hand: Array(draws[i]).fill(ELF), deckCount: 20 - draws[i],
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
    },
  ]));
  const steps: Step[] = [activate(SOURCE, "p0")];
  if (ffa) steps.push(expectPickSeats(seats.slice(1), "p0"), pickOpponent(declared, "p0"));
  steps.push(expectPrompt({ by: "p0", context: "action" }), expectBoard(board()));
  if (kind === "dead") steps.push(expectEliminated(declared));
  const living = seats.filter(seat => kind !== "dead" || seat !== declared);
  for (let turn = 2; turn <= living.length + 1; turn++) {
    const previous = living[(turn - 2) % living.length];
    const next = living[(turn - 1) % living.length];
    const isOpponent = format === "tag" ? next === "p1" || next === "p3" : next !== "p0";
    // The live FIELD_ONLY player effect counts only its declared seat in FFA.
    // Dead, empty and card-effect controls keep Q1 R3. Tag counts opposing turns.
    if (isOpponent && (!ffa || kind !== "live" || next === declared)) recovered += 100;
    draws[seats.indexOf(next)]++;
    steps.push(endTurn(previous), expectTurn(next, turn), expectPrompt({ by: next, context: "action" }), expectBoard(board()));
  }
  return defineScenario({
    id: `is-turn-player-duration-${format}-${kind}${domain ? "-domain" : ""}`,
    title: `${format}: IsTurnPlayer in a ${kind} declared-duration callback recovers only on counted opponent turns`,
    source: "Core-fix5 review LOW-1; owner 2026-10-03 declared duration and 2026-10-02 late dead-seat fallback and card-effect scope",
    rules: ffa ? ["R-FFA-DECLARED-DURATION", ...(kind === "dead" ? ["R-FFA-ELIMINATION"] : []), ...(kind !== "live" ? ["R-FFA-ORDER"] : [])]
      : format === "tag" ? ["R-TAG-ORDER", "R-TAG-LP"] : [],
    tags: ["multiplayer", `fixture:${kind}`], setup, steps,
  });
}

async function run(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const kind = scenario.tags.find(tag => tag.startsWith("fixture:"))!.slice(8);
  const fixture = readFileSync(new URL("./fixtures/is-turn-player-duration.lua", import.meta.url), "utf8");
  const game = await createEngineGame({ ...compiled.options, firstTurnDraw: scenario.setup.mode === "domain", dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts: [{ name: "is-turn-player-duration.lua", content: `TURN_CASE=${JSON.stringify(kind)}\n${fixture}` }, ...(compiled.options.startupScripts ?? [])],
    seed: ["1", "2", "3", "4"],
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    session.startRecording();
    scenario.steps.forEach((step, i) => session.run(step, i + 1));
  } finally { game.close(); }
}

describeWithCores("IsTurnPlayer declared-duration gate", liveNseat, () => runScenarios("multiplayer/is-turn-player-duration",
  [false, true].flatMap(domain => (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    (format.startsWith("ffa") ? ["live", "dead", "empty", "card"] as const : ["live"] as const).map(kind => proof(format, domain, kind)))), run));
