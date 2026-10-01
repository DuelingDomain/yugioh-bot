import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import type { EngineGame } from "../../../src/engine.js";
import {
  attack, changePhase, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectNoPrompt, expectPrompt,
  expectResponseOrder, expectResult, pass, pickOpponent, type Scenario, type Step,
} from "../../support/dsl.js";
import { Session, probeSetupDuelists, ScenarioError } from "../../support/session.js";
import { runScenarios } from "../../support/runner.js";

// Layer 1 scenarios for N-seat tables (FFA3, FFA4, Tag). The live scenarios need a multi core that has
// Debug.SetupDuelists: they are skipped until it exists (same probe as tests/engine-nseat.test.ts).
// The DSL step logic is unit-tested below against a fake game, so it needs no core.

const ELF = "Mystical Elf"; // 800 ATK vanilla, also the Deck filler
const ELF_ATK = 800;
const SOURCE = "docs/adr/0002-multiplayer-duel-rules.md";

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
// scenarios also need NSEAT_LIVE=1 until the multi core passes a full round of turns (the T0 build of 16:56 hangs
// when seat 1 ends its turn). NSEAT_WASM picks another core build.
const setupDuelistsAvailable = process.env.NSEAT_LIVE === "1" && (await probeSetupDuelists());

const elfAt = (lp?: number) => ({ monsters: [ELF], ...(lp != null ? { lp } : {}) });
const passTurns = (...seats: Array<"p0" | "p1" | "p2" | "p3">): Step[] => seats.map((seat) => endTurn(seat));

const scenarios: Scenario[] = [
  defineScenario({
    id: "nseat-ffa4-turn-order",
    title: "FFA4: turns go clockwise p0, p1, p2, p3, p0",
    source: `${SOURCE} [R-FFA-ORDER]`,
    tags: ["multiplayer", "turn-order", "ffa4"],
    setup: { format: "ffa4" },
    steps: [
      expectPrompt({ by: "p0" }),
      endTurn("p0"), expectPrompt({ by: "p1" }),
      endTurn("p1"), expectPrompt({ by: "p2" }),
      endTurn("p2"), expectPrompt({ by: "p3" }),
      endTurn("p3"), expectPrompt({ by: "p0" }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-no-first-draw",
    title: "FFA3: the first duelist does not draw on their first turn, the next ones do",
    source: `${SOURCE} [R-FFA-ORDER]`,
    tags: ["multiplayer", "draw", "ffa3"],
    setup: { format: "ffa3", deckSize: 20 },
    steps: [
      expectBoard({ p0: { deckCount: 20, hand: { count: 0 } }, p1: { deckCount: 20 }, p2: { deckCount: 20 } }),
      endTurn("p0"),
      expectBoard({ p0: { deckCount: 20 }, p1: { deckCount: 19, hand: { count: 1 } }, p2: { deckCount: 20 } }),
      endTurn("p1"),
      expectBoard({ p1: { deckCount: 19 }, p2: { deckCount: 19, hand: { count: 1 } } }),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-no-attack-first-round",
    title: "FFA3: no Battle Phase until every duelist had one turn, then p0 may attack on turn 4",
    source: `${SOURCE} [R-FFA-NO-ATTACK]`,
    tags: ["multiplayer", "battle", "ffa3"],
    setup: { format: "ffa3", p0: elfAt(), p1: elfAt(), p2: elfAt() },
    steps: [
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectPrompt({ by: "p1", notOffers: ["to_bp"] }),
      endTurn("p1"), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectPrompt({ by: "p0", offers: ["to_bp"] }),
    ],
  }),
  defineScenario({
    id: "nseat-tag-first-battle-turn-4",
    title: "Tag: the first three duelists cannot attack, the first Battle Phase is turn 4 (p3)",
    source: `${SOURCE} [R-TAG-ORDER]`,
    tags: ["multiplayer", "battle", "tag"],
    setup: { format: "tag", p0: elfAt(), p1: elfAt(), p2: elfAt(), p3: elfAt() },
    steps: [
      expectPrompt({ by: "p0", notOffers: ["to_bp"] }),
      endTurn("p0"), expectPrompt({ by: "p1", notOffers: ["to_bp"] }),
      endTurn("p1"), expectPrompt({ by: "p2", notOffers: ["to_bp"] }),
      endTurn("p2"), expectPrompt({ by: "p3", offers: ["to_bp"] }),
    ],
  }),
  defineScenario({
    id: "nseat-tag-team-lp",
    title: "Tag: a direct attack lowers the LP of the whole team, both partners show it",
    source: `${SOURCE} [R-TAG-LP]`,
    tags: ["multiplayer", "lp", "tag"],
    setup: { format: "tag", p3: elfAt() },
    steps: [
      expectLp({ team: 0 }, 16000),
      expectLp({ team: 1 }, 16000),
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p3"),
      attack(ELF, "direct", "p3"),
      pickOpponent("p0", "p3"),
      expectLp({ team: 0 }, 16000 - ELF_ATK),
      expectLp({ seat: "p2" }, 16000 - ELF_ATK),
      expectLp({ team: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-direct-attack-pick",
    title: "FFA3: a direct attack with two open opponents asks which one, and only that one loses LP",
    source: `${SOURCE} [R-FFA-ATTACK]`,
    tags: ["multiplayer", "battle", "direct-attack", "ffa3"],
    setup: { format: "ffa3", p0: elfAt() },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      expectLp({ seat: "p2" }, 8000 - ELF_ATK),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p0" }, 8000),
    ],
  }),
  defineScenario({
    id: "nseat-ffa3-elimination-and-win",
    title: "FFA3: a duelist at 0 LP is eliminated and the duel goes on, the last one standing wins",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    tags: ["multiplayer", "elimination", "ffa3"],
    setup: { format: "ffa3", p0: { monsters: [ELF, ELF] }, p1: { lp: ELF_ATK }, p2: { lp: ELF_ATK } },
    steps: [
      ...passTurns("p0", "p1", "p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p1"),
      expectLp({ seat: "p1" }, 0),
      attack(ELF, "direct", "p0"),
      pickOpponent("p2", "p0"),
      expectEliminated("p1", "p2"),
      expectResult({ seat: "p0" }),
    ],
  }),
];

describe.skipIf(!setupDuelistsAvailable)("live N-seat scenarios", () => {
  runScenarios("multiplayer/nseat", scenarios);
});

describe("N-seat scenario list", () => {
  it("has unique ids, sources and only multi-seat formats", () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const s of scenarios) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
    }
  });
});
