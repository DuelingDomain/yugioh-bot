import { expect } from "vitest";
import { createEngineGame, type EngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { resolveCard } from "../../support/card-catalog.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { activate, defineScenario, endTurn, expectBoard, expectEliminated, expectPickSeats, expectPrompt, expectTurn, pass, pickOpponent, select,
  type Scenario, type DuelistId, type Step, type BoardExpect } from "../../support/dsl.js";

const LOTUS = "Appointer of the Red Lotus", AXE = "Axe Raider", ELF = "Mystical Elf", FANG = "Silver Fang", OOKAZI = "Ookazi";
type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Case = "dead" | "dead-no-alive-helper" | "count2" | "count2-no-turn-helper";

function proof(format: Format, domain: boolean, kind: Case): Scenario {
  const n = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const seats = (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, n);
  const declared = seats[n - 1];
  const dead = kind.startsWith("dead");
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}),
    ...(kind === "count2-no-turn-helper" ? { withoutCoreFunctions: ["MPTurnSeat"] } : {}),
    ...(kind === "dead-no-alive-helper" ? { withoutCoreFunctions: ["MPIsAlive"] } : {}),
  };
  for (const seat of seats) setup[seat] = {
    hand: seat === "p0" ? [ELF, ...(dead ? [OOKAZI] : [])] : seat === declared ? [AXE, FANG] : [FANG],
    deck: Array(20).fill(ELF), ...(seat === "p0" ? { spells: [{ card: LOTUS, pos: "set" }] } : {}),
    ...(dead && seat === declared ? { lp: 800 } : {}), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  const draws = Array<number>(n).fill(0); draws[0] = Number(domain);
  let used = false, eliminated = false, returned = false, burned = false;
  const board = (): BoardExpect => Object.fromEntries(seats.map((seat, i) => [seat,
    eliminated && seat === declared ? {
      lp: 0, monsters: [], spells: [], grave: [], banished: [], hand: [], deckCount: 0,
      ...(domain ? { deckMaster: { inZone: false, returns: 0, nextCost: 0 } } : {}),
    } : {
      lp: (format === "tag" ? 16000 : dead && seat === declared ? 800 : 8000) - (used && (seat === "p0" || (format === "tag" && seat === "p2")) ? 2000 : 0),
      monsters: [], spells: seat === "p0" && !used ? [LOTUS] : [],
      grave: seat === "p0" ? [...(used ? [LOTUS] : []), ...(burned ? [OOKAZI] : [])] : [],
      // Banishment is the owner's zone, also before the declared seat leaves.
      banished: used && !returned && seat === (dead ? "p1" : declared) ? [AXE] : [],
      hand: [...(seat === "p0" ? [ELF, ...(dead && !burned ? [OOKAZI] : [])]
        : seat === declared ? [...(!used || returned ? [AXE] : []), FANG]
        : [FANG, ...(dead && returned && seat === "p1" ? [AXE] : [])]), ...Array(draws[i]).fill(ELF)],
      deckCount: 20 - draws[i], ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
    },
  ]));
  const steps: Step[] = [expectBoard(board())];
  if (!dead) {
    for (let turn = 2; turn <= n; turn++) {
      const previous = seats[turn - 2], next = seats[turn - 1]; draws[turn - 1]++;
      steps.push(endTurn(previous), expectTurn(next, turn), expectPrompt({ by: next, context: "action" }), expectBoard(board()));
    }
    steps.push(endTurn(declared));
  }
  steps.push(activate(LOTUS, "p0"));
  if (n > 2) steps.push(expectPickSeats(format === "tag" ? ["p1", "p3"] : seats.slice(1), "p0"), pickOpponent(declared, "p0"));
  steps.push(select({ card: AXE, owner: declared })); used = true;
  if (dead) {
    steps.push(expectPrompt({ by: "p0", context: "action" }), expectBoard(board()), activate(OOKAZI, "p0"),
      expectPickSeats(seats.slice(1), "p0"), pickOpponent(declared, "p0"));
    eliminated = true; burned = true;
    steps.push(expectEliminated(declared), expectPrompt({ by: "p0", context: "action" }), expectBoard(board()));
    const living = seats.filter(seat => seat !== declared);
    for (let turn = 2; turn <= living.length + 1; turn++) {
      const previous = living[(turn - 2) % living.length], next = living[(turn - 1) % living.length];
      if (previous === "p1") returned = true;
      draws[seats.indexOf(next)]++;
      steps.push(endTurn(previous), expectTurn(next, turn), expectPrompt({ by: next, context: "action" }), expectBoard(board()));
    }
  } else {
    draws[0]++;
    steps.push(expectTurn("p0", n + 1), expectPrompt({ by: "p0", context: "action" }), expectBoard(board()));
    for (let turn = n + 2; turn <= 2 * n + 1; turn++) {
      const previous = seats[(turn - 2) % n], next = seats[(turn - 1) % n];
      // In FFA, p1 cannot return the card. Tag keeps its next opposing End Phase.
      if (format === "tag" ? previous === "p1" : previous === declared) returned = true;
      draws[seats.indexOf(next)]++;
      steps.push(endTurn(previous), expectTurn(next, turn), expectPrompt({ by: next, context: "action" }), expectBoard(board()));
    }
  }
  return defineScenario({ id: `appointer-followup-${format}-${kind}${domain ? "-domain" : ""}`,
    title: `${format}: ${dead ? "the declared seat leaves; the living owner gets its card at the next living opponent End Phase" : "activation in the declared seat End Phase waits for the next counted End Phase"}`,
    source: "Appointer card text; core-fix5 and appointer-lua reviews LOW-1/LOW-2; owner 2026-10-02 late fallback and 2026-10-03 declared duration",
    rules: format.startsWith("ffa") ? ["R-FFA-OPP-ONE", "R-FFA-DECLARED-DURATION", ...(dead ? ["R-FFA-ELIMINATION", "R-FFA-ORDER"] : [])]
      : format === "tag" ? ["R-TAG-ORDER", "R-COMMON-OPP-PICK", "R-TAG-PARTNER"] : ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "card:43262273", `fixture:${kind}`], setup, steps });
}

function open(game: EngineGame) {
  for (let seat = 0; seat < game.view(0).seats.length; seat++) {
    const view = game.view(seat); if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

async function run(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const kind = scenario.tags.find(tag => tag.startsWith("fixture:"))!.slice(8);
  if (kind.startsWith("dead")) {
    // A hand exchange can put a living player's card in another hand. Give this
    // board that ownership directly, then run the stock Appointer and Ookazi effects.
    const controller = scenario.setup.format === "ffa3" ? 2 : 3;
    const code = resolveCard(AXE);
    const before = `Debug.AddCard(${code},${controller},${controller},LOCATION_HAND,0,POS_FACEDOWN,false)`;
    const after = `Debug.AddCard(${code},1,${controller},LOCATION_HAND,0,POS_FACEDOWN,false)`;
    let changed = false;
    compiled.options.startupScripts = compiled.options.startupScripts?.map(script => {
      if (!script.content.includes(before)) return script;
      changed = true; return { ...script, content: script.content.replace(before, after) };
    });
    expect(changed, "The loaned Axe Raider has a living owner").toBe(true);
  }
  const game = await createEngineGame({ ...compiled.options, firstTurnDraw: scenario.setup.mode === "domain", dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, i) => {
      const inEndPhase = !kind.startsWith("dead") && step.op === "activate" && step.sel === LOTUS;
      // Decline optional responses during turn changes. Keep the real End Phase
      // chain prompt for the count-2 activation, then check its phase and seat.
      for (let guard = 0; guard < 24; guard++) {
        const current = open(game);
        if (!current || current.prompt.context?.type !== "chain" || current.prompt.context.forced || !current.prompt.cancelable) break;
        if (inEndPhase && current.view.phase === "end") break;
        session.run(pass(`p${current.seat}` as DuelistId), i + 1);
      }
      if (inEndPhase) {
        const current = open(game)!;
        expect(current.view.phase).toBe("end");
        expect(current.view.turnSeat).toBe(current.view.seats.length - 1);
        session.run(expectPrompt({ by: "p0", context: "chain" }), i + 1);
      }
      session.run(step, i + 1);
    });
  } finally { game.close(); }
}

describeWithCores("Appointer duration follow-up", liveNseat, () => runScenarios("multiplayer/appointer-duration-followup",
  [false, true].flatMap(domain => (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    (format.startsWith("ffa") ? ["dead", "dead-no-alive-helper", "count2", "count2-no-turn-helper"] as const : ["count2"] as const).map(kind => proof(format, domain, kind)))), run));
