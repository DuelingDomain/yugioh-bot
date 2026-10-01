import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import { seatCountFor, teamOfSeat, type DuelFormat } from "@yugidraft/shared/duels";
import type { EngineGame } from "../../../src/engine.js";
import {
  defineScenario, expectBoard, expectEliminated, expectLp, expectNoPrompt, expectPickSeats, expectPrompt,
  expectResponseOrder, expectTurn, expectResult, pass, pickOpponent, type Scenario, type Step,
} from "../../support/dsl.js";
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

interface Fake {
  game: EngineGame;
  answers: Array<{ seat: number; id: string; answer: unknown }>;
}

function fakeGame(options: {
  format: DuelFormat;
  seats?: Array<Partial<DuelSeatView>>;
  prompts?: DuelPrompt[];
  result?: DuelEngineView["result"];
}): Fake {
  const count = seatCountFor(options.format);
  const seats = Array.from({ length: count }, (_, seat) => seatView(seat, options.seats?.[seat]));
  const queue = [...(options.prompts ?? [])];
  const answers: Fake["answers"] = [];
  const game = {
    view: (seat: number) => ({
      turn: 1, turnSeat: 0, phase: "main1", seats, events: [], chain: [], result: options.result ?? null,
      prompt: queue[0]?.seat === seat ? queue[0] : null,
    }),
    answer: (seat: number, id: string, answer: unknown) => {
      answers.push({ seat, id, answer });
      queue.shift();
    },
    close: () => undefined,
  } as unknown as EngineGame;
  return { game, answers };
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
