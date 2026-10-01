import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import { seatCountFor, teamOfSeat, type DuelFormat } from "@yugidraft/shared/duels";
import type { EngineGame } from "../../../src/engine.js";
import {
  defineScenario, eliminate, expectBoard, expectEliminated, expectLabel, expectLp, expectNoPrompt, expectPickOptions, expectPickSeats,
  expectPrompt, expectResponseOrder, expectRetry, expectTurn, expectResult, pass, pickOpponent, surrender, type Scenario, type Step,
} from "../../support/dsl.js";
import { EngineAnswerError } from "../../../src/prompts.js";
import { Session, probeSetupDuelists, ScenarioError } from "../../support/session.js";
import { runScenarios } from "../../support/runner.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { NSEAT_SCENARIOS, SOURCE } from "./nseat-scenarios.js";

// Layer 1 scenarios for N-seat tables (FFA3, FFA4, Tag). The scenarios are in nseat-scenarios.ts (plain data, also read by
// scripts/rule-coverage.ts). The live scenarios need a multi core that has
// Debug.SetupDuelists (same probe as tests/engine-nseat.test.ts) and NSEAT_LIVE=1 (see below).
// Skipped when the gate is closed; with DUEL_REQUIRE_CORES=1 they FAIL instead (tests/support/cores.ts).
// The DSL step logic is unit-tested below against a fake game, so it needs no core.

// ---- Fake game for step unit tests -----------------------------------------------------------

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, deckCount: 20, hand: [], graveyard: [], banished: [], extra: [], monsters: [], spells: [], ...extra,
  } as unknown as DuelSeatView;
}

function chainPrompt(seat: number, id: string): DuelPrompt {
  return {
    id, seat, kind: "choice", title: "Chain", context: { type: "chain", forced: false }, cancelable: true,
    options: [{ id: "no", label: "No response" }],
  } as unknown as DuelPrompt;
}

function attackPrompt(seat: number, targets: number[]): DuelPrompt {
  return {
    id: "pick", seat, kind: "choice", title: "Select a duelist to attack",
    options: targets.map((target, index) => ({ id: `opt:${index}`, label: `Attack Player ${target + 1} directly`, controller: target, values: [index] })),
  } as unknown as DuelPrompt;
}

const RAIGEKI = 12580477;
const DARK_HOLE = 53129443;
const MIRROR_FORCE = 44095762;
const ELF_CODE = 15025844;

/** A card pick: the options are cards on seats. */
function cardPrompt(seat: number, cards: Array<{ controller: number; code: number; label?: string }>): DuelPrompt {
  return {
    id: "cards", seat, kind: "cards", title: "Select the card to destroy", min: 1, max: 1,
    options: cards.map((card, index) => ({
      id: `card:${index}`, label: card.label ?? `Card ${card.code}`, controller: card.controller, card: { code: card.code, name: `Card ${card.code}` },
    })),
  } as unknown as DuelPrompt;
}

interface Fake {
  game: EngineGame;
  answers: Array<{ seat: number; id: string; answer: unknown }>;
  eliminations: Array<{ seat: number; reason: number }>;
}

function fakeGame(options: {
  format: DuelFormat;
  seats?: Array<Partial<DuelSeatView>>;
  prompts?: DuelPrompt[];
  result?: DuelEngineView["result"];
  /** Returns an error message to refuse an answer like the engine does (EngineAnswerError, state and prompt stay). */
  refuse?: (seat: number, id: string, answer: unknown) => string | null;
  /** Also changes the state when it refuses: a broken engine. */
  dirtyRefusal?: boolean;
}): Fake {
  const count = seatCountFor(options.format);
  const seats = Array.from({ length: count }, (_, seat) => seatView(seat, options.seats?.[seat]));
  const queue = [...(options.prompts ?? [])];
  const answers: Fake["answers"] = [];
  const eliminations: Fake["eliminations"] = [];
  const game = {
    view: (seat: number) => ({
      turn: 1, turnSeat: 0, phase: "main1", seats, events: [], chain: [], result: options.result ?? null,
      prompt: queue[0]?.seat === seat ? queue[0] : null,
    }),
    answer: (seat: number, id: string, answer: unknown) => {
      const refusal = options.refuse?.(seat, id, answer) ?? null;
      if (refusal) {
        if (options.dirtyRefusal) seats[0] = seatView(0, { lp: 1 });
        throw new EngineAnswerError(refusal);
      }
      answers.push({ seat, id, answer });
      queue.shift();
    },
    eliminate: (seat: number, reason: number) => {
      eliminations.push({ seat, reason });
    },
    close: () => undefined,
  } as unknown as EngineGame;
  return { game, answers, eliminations };
}

function scenarioOf(format: DuelFormat, steps: Step[] = []): Scenario {
  return defineScenario({ id: "fake", title: "fake", source: SOURCE, tags: [], setup: { format }, steps });
}

function session(format: DuelFormat, fake: Fake): Session {
  const s = new Session(scenarioOf(format), fake.game);
  s.startRecording();
  return s;
}

const run = (s: Session, ...steps: Step[]) => steps.forEach((step, index) => s.run(step, index + 1));

describe("N-seat DSL steps (no core)", () => {
  it("expectEliminated names exactly the eliminated seats", () => {
    const fake = fakeGame({ format: "ffa4", seats: [{}, { eliminated: true }, {}, { eliminated: true }] });
    const s = session("ffa4", fake);
    run(s, expectEliminated("p1", "p3"));
    run(s, expectEliminated(["p3", "p1"]));
    expect(() => run(s, expectEliminated("p1"))).toThrow(/p3 is eliminated/);
    expect(() => run(s, expectEliminated("p1", "p2", "p3"))).toThrow(/p2 is not eliminated/);
  });

  it("expectEliminated rejects a seat the format does not have", () => {
    const s = session("ffa3", fakeGame({ format: "ffa3" }));
    expect(() => run(s, expectEliminated("p3"))).toThrow(/not a seat of format "ffa3"/);
  });

  it("expectLp reads a seat or a whole team", () => {
    const fake = fakeGame({ format: "tag", seats: [{ lp: 15200 }, { lp: 16000 }, { lp: 15200 }, { lp: 16000 }] });
    const s = session("tag", fake);
    run(s, expectLp({ seat: "p1" }, 16000), expectLp({ team: 0 }, 15200), expectLp({ team: 1 }, 16000));
    expect(() => run(s, expectLp({ team: 0 }, 16000))).toThrow(/Team 0 LP/);
    expect(() => run(s, expectLp({ seat: "p0" }, 1))).toThrow(/p0.lp: expected 1, got 15200/);
    expect(() => run(s, expectLp({ team: 2 }, 1))).toThrow(/no team 2/);
  });

  it("expectLp catches partners that disagree on the team LP", () => {
    const s = session("tag", fakeGame({ format: "tag", seats: [{ lp: 15200 }, {}, { lp: 16000 }, {}] }));
    expect(() => run(s, expectLp({ team: 0 }, 15200))).toThrow(/p0=15200, p2=16000/);
  });

  it("expectResult keeps the 1v1 form and adds the object form", () => {
    const won = fakeGame({ format: "1v1", result: { winnerSeat: 1, reason: "Life Points reached 0" } });
    const s = session("1v1", won);
    run(s, expectResult("p1", "life points"), expectResult({ seat: "p1" }), expectResult({ team: 1, reason: "points" }));
    expect(() => run(s, expectResult("p0"))).toThrow(/Winner is p1/);
    expect(() => run(s, expectResult({ team: 0 }))).toThrow(/Winning team is 1/);
    expect(() => run(s, expectResult({ reason: "deck" }))).toThrow(/expected it to contain "deck"/);
    const draw = session("ffa3", fakeGame({ format: "ffa3", result: { winnerSeat: null, reason: "Draw" } }));
    run(draw, expectResult(null), expectResult({ seat: null }), expectResult({ team: null }));
  });

  it("expectResult in Tag accepts any seat of the winning team", () => {
    const fake = fakeGame({ format: "tag", result: { winnerSeat: 1, winnerTeam: 1, reason: "Life Points reached 0" } });
    const s = session("tag", fake);
    run(s, expectResult("p1"), expectResult("p3"), expectResult({ seat: "p3", team: 1 }));
    expect(() => run(s, expectResult("p0"))).toThrow(/Winner is p1/);
    expect(() => run(s, expectResult("p2"))).toThrow(/Winner is p1/);
  });

  it("expectResult fails while the duel is open", () => {
    const s = session("ffa3", fakeGame({ format: "ffa3" }));
    expect(() => run(s, expectResult({ seat: "p0" }))).toThrow(/not over/);
  });

  it("expectResponseOrder lists the seats that answered chain prompts, then the open one", () => {
    const fake = fakeGame({ format: "ffa4", prompts: [chainPrompt(1, "a"), chainPrompt(2, "b"), chainPrompt(3, "c"), chainPrompt(0, "d")] });
    const s = session("ffa4", fake);
    run(s, pass("p1"), pass("p2"), pass("p3"));
    // p0 still has the open prompt: it counts as the last one.
    run(s, expectResponseOrder("p1", "p2", "p3", "p0"));
    expect(fake.answers.map((answer) => answer.seat)).toEqual([1, 2, 3]);
    // The cursor moved: the open p0 prompt was counted once, and answering it adds p0 to the next window.
    run(s, pass("p0"), expectResponseOrder(["p0"]), expectNoPrompt());
  });

  it("expectResponseOrder fails with the two orders", () => {
    const fake = fakeGame({ format: "ffa3", prompts: [chainPrompt(2, "a"), chainPrompt(1, "b")] });
    const s = session("ffa3", fake);
    run(s, pass("p2"));
    expect(() => run(s, expectResponseOrder("p1", "p2"))).toThrow(/expected: p1 -> p2\n\s+actual:\s+p2 -> p1/);
  });

  it("expectResponseOrder with no chain prompt expects an empty order", () => {
    const s = session("ffa3", fakeGame({ format: "ffa3" }));
    run(s, expectResponseOrder());
    expect(() => run(s, expectResponseOrder("p1"))).toThrow(/actual:\s+\(none\)/);
  });

  it("pickOpponent answers the direct-attack pick for the named seat", () => {
    const fake = fakeGame({ format: "ffa4", prompts: [attackPrompt(0, [1, 2, 3])] });
    const s = session("ffa4", fake);
    run(s, expectPrompt({ by: "p0", title: "duelist to attack" }), pickOpponent("p2", "p0"));
    expect(fake.answers).toEqual([{ seat: 0, id: "pick", answer: { choice: "opt:1" } }]);
  });

  it("expectTurn compares the turn seat and, when given, the turn number", () => {
    const s = session("ffa4", fakeGame({ format: "ffa4" }));
    run(s, expectTurn("p0"), expectTurn("p0", 1));
    expect(() => run(s, expectTurn("p1"))).toThrow(/turn of p0 \(turn 1\), expected p1/);
    expect(() => run(s, expectTurn("p0", 4))).toThrow(/turn 1 \(p0\), expected turn 4/);
  });

  it("expectPickSeats compares the set of seats the open prompt offers, in any order", () => {
    const s = session("ffa4", fakeGame({ format: "ffa4", prompts: [attackPrompt(0, [3, 1, 2])] }));
    run(s, expectPickSeats(["p1", "p2", "p3"], "p0"), expectPickSeats(["p3", ["p1", "p2"]], "p0"));
    expect(() => run(s, expectPickSeats(["p1", "p2"], "p0"))).toThrow(/offers seats p1, p2, p3, expected exactly p1, p2/);
    expect(() => run(s, expectPickSeats(["p1", "p2", "p3"], "p1"))).toThrow(/p1/);
  });

  it("eliminate sends the win-reason code to the engine and surrender sends 0", () => {
    const fake = fakeGame({ format: "ffa3" });
    const s = session("ffa3", fake);
    run(s, surrender("p1"), eliminate("p2", 7), eliminate("p0"));
    expect(fake.eliminations).toEqual([{ seat: 1, reason: 0 }, { seat: 2, reason: 7 }, { seat: 0, reason: 0 }]);
  });

  it("eliminate fails with the engine message, with no prompt dump when no prompt is open", () => {
    const fake = fakeGame({ format: "ffa3" });
    (fake.game as unknown as { eliminate: () => void }).eliminate = () => {
      throw new EngineAnswerError("Seat is already eliminated");
    };
    expect(() => run(session("ffa3", fake), eliminate("p1", 3))).toThrow(/The engine refused the surrender: Seat is already eliminated/);
  });

  it("expectPickOptions with an array wants exactly these options, in any order, by seat, card or label", () => {
    const fake = fakeGame({ format: "ffa4", prompts: [attackPrompt(0, [3, 1, 2])] });
    const s = session("ffa4", fake);
    run(s, expectPickOptions([{ seat: "p1" }, { seat: "p2" }, { seat: "p3" }], "p0"), expectPickOptions([{ label: "player 4" }, { seat: "p1" }, { id: "opt:2" }]));
    expect(() => run(s, expectPickOptions([{ seat: "p1" }, { seat: "p2" }]))).toThrow(/unexpected option opt:0 "Attack Player 4 directly" \[p3\]/);
    expect(() => run(s, expectPickOptions([{ seat: "p1" }, { seat: "p2" }, { seat: "p3" }, { seat: "p0" }]))).toThrow(/no option left for \{"seat":"p0"\}/);
    expect(() => run(s, expectPickOptions([{ seat: "p1" }, { seat: "p1" }, { seat: "p2" }]))).toThrow(/no option left for/);
    expect(() => run(s, expectPickOptions([{ seat: "p1" }, { seat: "p2" }, { seat: "p3" }], "p2"))).toThrow(/for p0/);
  });

  it("expectPickOptions matches overlapping refs without a greedy mistake", () => {
    const fake = fakeGame({ format: "ffa3", prompts: [cardPrompt(0, [{ controller: 1, code: RAIGEKI }, { controller: 1, code: DARK_HOLE }])] });
    // The first ref fits both options. A greedy match would give it option 0 and strand the second ref.
    run(session("ffa3", fake), expectPickOptions([{ seat: "p1" }, { seat: "p1", card: RAIGEKI }]));
  });

  it("expectPickOptions include, exclude and count check cards of one opponent in a card pick", () => {
    const fake = fakeGame({ format: "ffa3", prompts: [cardPrompt(0, [{ controller: 1, code: RAIGEKI }, { controller: 1, code: DARK_HOLE }, { controller: 1, code: MIRROR_FORCE }])] });
    const s = session("ffa3", fake);
    run(s, expectPickOptions({ include: [{ card: RAIGEKI }, { card: MIRROR_FORCE }], exclude: [{ seat: "p2" }], count: 3 }, "p0"));
    expect(() => run(s, expectPickOptions({ exclude: [{ seat: "p1" }] }))).toThrow(/must not be offered, but card:0/);
    expect(() => run(s, expectPickOptions({ count: 2 }))).toThrow(/expected 2 option\(s\), got 3/);
    expect(() => run(s, expectPickOptions({ include: [{ card: ELF_CODE }] }))).toThrow(/no option left for/);
  });

  it("expectPickOptions fails with no open prompt", () => {
    expect(() => run(session("ffa3", fakeGame({ format: "ffa3" })), expectPickOptions([]))).toThrow(/Expected an open prompt/);
  });

  it("expectLabel compares the label text of exactly one option", () => {
    const fake = fakeGame({ format: "ffa4", prompts: [attackPrompt(0, [1, 2, 3])] });
    const s = session("ffa4", fake);
    run(s, expectLabel({ seat: "p2" }, "Attack Player 3 directly", "p0"), expectLabel({ seat: "p3" }, "PLAYER 4"), expectLabel({ id: "opt:0" }, "player 2"));
    expect(() => run(s, expectLabel({ seat: "p2" }, "Player 2"))).toThrow(/label of option opt:1 is "Attack Player 3 directly"/);
    expect(() => run(s, expectLabel({ label: "Player" }, "x"))).toThrow(/3 options match/);
    expect(() => run(s, expectLabel({ seat: "p0" }, "x"))).toThrow(/No option matches \{"seat":"p0"\}/);
  });

  it("expectRetry passes when the engine refuses the answer and nothing changes", () => {
    const fake = fakeGame({
      format: "ffa4", prompts: [attackPrompt(0, [1, 2])],
      refuse: (seat, _id, answer) => (seat !== 0 ? "Wrong seat" : (answer as { choice?: string }).choice === "opt:0" || (answer as { choice?: string }).choice === "opt:1" ? null : "Invalid answer"),
    });
    const s = session("ffa4", fake);
    run(s, expectRetry({ choice: "opt:3" }, { error: "Invalid answer", by: "p0" }), expectRetry({ choice: "opt:0" }, { as: "p3", error: "Wrong seat" }));
    expect(fake.answers).toEqual([]);
    run(s, pickOpponent("p1", "p0"), expectNoPrompt());
  });

  it("expectRetry fails when the engine takes the answer", () => {
    const fake = fakeGame({ format: "ffa3", prompts: [attackPrompt(0, [1, 2])] });
    expect(() => run(session("ffa3", fake), expectRetry({ choice: "opt:0" }))).toThrow(/took the answer \{"choice":"opt:0"\} from p0\. It must refuse it/);
  });

  it("expectRetry fails on another error, on a wrong message and on a refusal that changes the state", () => {
    const refused = (message: string, dirty = false) => fakeGame({ format: "ffa3", prompts: [attackPrompt(0, [1, 2])], refuse: () => message, dirtyRefusal: dirty });
    expect(() => run(session("ffa3", refused("Invalid answer")), expectRetry({ choice: "x" }, { error: "Stale prompt" }))).toThrow(/error is "Invalid answer", expected it to contain "Stale prompt"/);
    expect(() => run(session("ffa3", refused("Invalid answer", true)), expectRetry({ choice: "x" }))).toThrow(/state of the duel changed/);
    const broken = fakeGame({ format: "ffa3", prompts: [attackPrompt(0, [1, 2])] });
    (broken.game as unknown as { answer: () => void }).answer = () => {
      throw new Error("core crashed");
    };
    expect(() => run(session("ffa3", broken), expectRetry({ choice: "x" }))).toThrow(/failed with Error: core crashed/);
  });

  it("the three prompt-inspection steps keep a routine zone prompt open", () => {
    const zonePrompt = {
      id: "zone", seat: 0, kind: "places", title: "Select a zone for Raigeki",
      options: [{ id: "place:0", label: "Zone 1", controller: 1, location: 4, sequence: 0 }, { id: "place:1", label: "Zone 2", controller: 2, location: 4, sequence: 0 }],
    } as unknown as DuelPrompt;
    const fake = fakeGame({ format: "ffa3", prompts: [zonePrompt], refuse: (_seat, _id, answer) => ((answer as { selected?: string[] }).selected?.[0] === "place:9" ? "Invalid answer" : null) });
    const s = session("ffa3", fake);
    run(s, expectPickOptions([{ seat: "p1" }, { seat: "p2" }]), expectLabel({ seat: "p2" }, "Zone 2"), expectRetry({ selected: ["place:9"] }, { error: "Invalid answer" }));
    expect(fake.answers).toEqual([]);
  });

  it("pickOpponent fails for a seat that is not offered, or for the wrong answering seat", () => {
    const s = session("ffa4", fakeGame({ format: "ffa4", prompts: [attackPrompt(0, [1, 3])] }));
    expect(() => run(s, pickOpponent("p2"))).toThrow(/does not offer to attack p2/);
    expect(() => run(s, pickOpponent("p1", "p3"))).toThrow(/for p0/);
  });

  it("expectBoard accepts p2 and p3 when the format has them and rejects them otherwise", () => {
    const ffa = session("ffa3", fakeGame({ format: "ffa3", seats: [{}, {}, { lp: 500 }] }));
    run(ffa, expectBoard({ p2: { lp: 500 }, p1: { lp: 8000, deckCount: 20 } }));
    expect(() => run(ffa, expectBoard({ p3: { lp: 8000 } }))).toThrow(/no such seat/);
    const duel = session("1v1", fakeGame({ format: "1v1" }));
    expect(() => run(duel, expectBoard({ p2: { lp: 8000 } }))).toThrow(ScenarioError);
  });
});

// ---- Live scenarios (need the N-seat core) ---------------------------------------------------

// The core runs synchronously: a core bug that loops forever cannot be stopped by a test timeout. So the live
// scenarios also need NSEAT_LIVE=1 until the merged multi core is installed and passes a full round of turns (the T0
// build of 16:56 hung when seat 1 ends its turn). NSEAT_WASM picks another core build; the default is the current
// multi core (tests/support/cores.ts). REMOVE the gate (needs.liveNseat) when the merged core is installed.
const liveNseat = needs.liveNseat(process.env.NSEAT_LIVE === "1" && (await probeSetupDuelists()));

describeWithCores("live N-seat scenarios", liveNseat, () => {
  runScenarios("multiplayer/nseat", NSEAT_SCENARIOS);
});

describe("N-seat scenario list", () => {
  it("has unique ids, sources and only multi-seat formats", () => {
    expect(new Set(NSEAT_SCENARIOS.map((s) => s.id)).size).toBe(NSEAT_SCENARIOS.length);
    for (const s of NSEAT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
    }
  });

  it("declares the rules it proves and asserts an outcome after an action (the rule-coverage marker)", () => {
    for (const s of NSEAT_SCENARIOS) {
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("asks for an opponent pick only while the attacker has two or more opponents alive", () => {
    // With one opponent left the core offers no pick: a pickOpponent step then waits for a prompt that never comes
    // and the checks after it never run (the old step 10 of the FFA3 elimination scenario).
    const seatOf = (id: string) => Number(id.slice(1));
    for (const s of NSEAT_SCENARIOS) {
      const format = s.setup.format ?? "1v1";
      const dead = new Set<number>();
      for (const step of s.steps) {
        if (step.op === "expectEliminated") step.seats.forEach((id) => dead.add(seatOf(id)));
        if (step.op !== "pickOpponent") continue;
        expect(step.by, `${s.id}: pickOpponent names the attacker`).toBeDefined();
        const attacker = seatOf(step.by!);
        const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
          (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, attacker) && !dead.has(seat),
        );
        expect(opponents.length, `${s.id}: opponents alive for ${step.by}`).toBeGreaterThanOrEqual(2);
        expect(opponents, s.id).toContain(seatOf(step.seat));
      }
    }
  });

  it("the FFA3 elimination scenario ends with the checks that used to never run", () => {
    const steps = NSEAT_SCENARIOS.find((s) => s.id === "nseat-ffa3-elimination-and-win")!.steps;
    expect(steps.map((step) => step.op).slice(-3)).toEqual(["expectNoPrompt", "expectEliminated", "expectResult"]);
    expect(steps.filter((step) => step.op === "pickOpponent")).toHaveLength(1);
  });
});
