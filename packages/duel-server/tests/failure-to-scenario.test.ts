import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogLookup, generate } from "../scripts/failure-to-scenario.js";
import { captureBoard } from "../scripts/lib/board-capture.js";
import { loadSource, replaySource, type ReplayedViews } from "../scripts/lib/replay-source.js";
import { engineDataDirectory } from "./fuzz/config.js";
import { runDuel } from "./fuzz/driver.js";
import { writeFailure } from "./fuzz/failures.js";
import { resolveCard } from "./support/card-catalog.js";
import { runScenario } from "./support/session.js";
import type { BoardSpec, CardEntry } from "./support/board.js";
import { compileBoard } from "./support/board.js";
import { endTurn, expectBoard } from "./support/dsl.js";

const dataDirectory = engineDataDirectory();
const codeOf = (entry: CardEntry | null | undefined): number | null => {
  if (entry == null) return null;
  return resolveCard(typeof entry === "object" ? entry.card : entry, dataDirectory);
};
const codes = (cards: DuelCard[]) => cards.map((card) => card.code).sort((a, b) => a! - b!);

describe("failure-to-scenario on a fuzz failure file", () => {
  let directory = "";
  let file = "";
  let step = -1;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "failure-to-scenario-"));
    // Same file format that the fuzz run writes for a failure. Seed 10 is one of the regression seeds.
    const outcome = await runDuel({ seed: 10, mode: "domain", masterRule: 5, maxSteps: 150 }, dataDirectory);
    file = writeFailure(outcome, dataDirectory, directory);
    // A Main Phase 1 action prompt, turn 2 or later, with monsters on both sides.
    await replaySource(loadSource(file), dataDirectory, outcome.steps, (views: ReplayedViews) => {
      const view = views.seats[0];
      const both = [0, 1].every((seat) => views.seats[seat]!.seats[seat]!.monsters.some(Boolean));
      if (view.turn >= 2 && view.phase === "main1" && view.prompt?.context?.type === "action" && both) {
        step = views.step;
        return true;
      }
      return false;
    });
  }, 30_000);

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("writes a scenario whose board equals the replayed state", async () => {
    expect(step).toBeGreaterThan(0);
    const result = await generate({ file, step, dataDirectory });
    const views = await replaySource(loadSource(file), dataDirectory, step);
    const board = result.capture.board;

    expect(board.mode).toBe("domain");
    for (const seat of [0, 1] as const) {
      const id = seat === 0 ? "p0" : "p1";
      const live = views.seats[seat].seats[seat]!;
      const spec = board[id]!;
      expect(spec.lp, `${id} lp`).toBe(live.lp);
      expect((spec.hand ?? []).map(codeOf).sort((a, b) => a! - b!), `${id} hand`).toEqual(codes(live.hand));
      expect((spec.grave ?? []).map(codeOf).sort((a, b) => a! - b!), `${id} grave`).toEqual(codes(live.graveyard));
      expect((spec.banished ?? []).map(codeOf).sort((a, b) => a! - b!), `${id} banished`).toEqual(codes(live.banished));
      expect((spec.extra ?? []).map(codeOf).sort((a, b) => a! - b!), `${id} extra`).toEqual(codes(live.extra));
      live.monsters.forEach((card, index) => expect(codeOf(spec.monsters?.[index]), `${id} monster zone ${index}`).toBe(card?.code ?? null));
      live.spells.slice(0, 5).forEach((card, index) => expect(codeOf(spec.spells?.[index]), `${id} spell zone ${index}`).toBe(card?.code ?? null));
      expect(codeOf(spec.deckMaster), `${id} deck master`).toBe(live.deckMaster!.card.code);
    }
    expect(board.turn).toBe(views.seats[0].turnSeat === 1 ? "p1" : "p0");

    // The board must have cards on the field, or the case proves little.
    const onField = (["p0", "p1"] as const).flatMap((id) => [...(board[id]?.monsters ?? []), ...(board[id]?.spells ?? [])]).filter(Boolean);
    expect(onField.length).toBeGreaterThan(1);

    // It compiles, and the file carries the header, the warnings and the TODO block.
    expect(() => compileBoard(board, dataDirectory)).not.toThrow();
    expect(result.text).toContain("// TODO expected result");
    expect(result.text).toContain("Source:");
    expect(result.capture.warnings.join("\n")).toMatch(/Once-per-turn|Summon type/);
  }, 20_000);

  it("rebuilds the same state in the engine (the generated scenario passes its own round-trip check)", async () => {
    const result = await generate({ file, step, dataDirectory });
    // Load the rendered text as a module from the temporary directory.
    const out = join(directory, "generated-case.mts");
    writeFileSync(out, result.text.replace(/"..\/..\/support\/dsl.js"/, `"${join(process.cwd(), "tests/support/dsl.ts")}"`));
    const loaded = (await import(/* @vite-ignore */ out)) as { scenarios: Parameters<typeof runScenario>[0][] };
    expect(loaded.scenarios).toHaveLength(1);
    await runScenario(loaded.scenarios[0]!);
    expect(readFileSync(out, "utf8")).toContain(result.name);
  }, 20_000);
});

describe("generated snapshot draws", () => {
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "failure-to-scenario-draw-"));
  });

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    { mode: "domain", masterRule: 5, turn: "p0" },
    { mode: "normal", masterRule: 2, turn: "p0" },
    { mode: "domain", masterRule: 5, turn: "p1" },
  ] as const)("$mode MR$masterRule $turn preserves the snapshot and draws on later turns", async ({ mode, masterRule, turn }) => {
    const initial = compileBoard({
      mode, masterRule, turn, deckSize: 4,
      p0: { hand: ["Silver Fang"], deck: ["Beaver Warrior"], ...(mode === "domain" ? { deckMaster: "Blue-Eyes White Dragon" } : {}) },
      p1: { hand: ["Giant Soldier of Stone"], deck: ["Battle Ox"], ...(mode === "domain" ? { deckMaster: "Blue-Eyes White Dragon" } : {}) },
    }, dataDirectory);
    const file = join(directory, `${mode}-${masterRule}-${turn}.json`);
    writeFileSync(file, JSON.stringify({
      scenario: { seed: 1, mode, masterRule }, decks: initial.options.decks, journal: [], failure: { step: 0 },
      engine: { ...initial.options, seed: ["1", "2", "3", "4"] },
    }));
    const result = await generate({ file, step: 0, dataDirectory });
    const out = join(directory, `${result.name}.mts`);
    writeFileSync(out, result.text.replace(/"..\/..\/support\/dsl.js"/, `"${join(process.cwd(), "tests/support/dsl.ts")}"`));
    const loaded = (await import(/* @vite-ignore */ out)) as { scenarios: Parameters<typeof runScenario>[0][] };
    const scenario = loaded.scenarios[0]!;
    const next = turn === "p0" ? "p1" : "p0";
    const setup = scenario.setup[next]!;
    // The generated board is already past its captured Draw Phase. Only the next turn draws a card.
    scenario.steps.push(endTurn(turn), expectBoard({
      [next]: { hand: [...(setup.hand ?? []).map((entry) => typeof entry === "object" ? entry.card : entry), setup.deck![0]!], deckCount: scenario.setup.deckSize! - 1 },
      [turn]: { hand: (scenario.setup[turn]!.hand ?? []).map((entry) => typeof entry === "object" ? entry.card : entry), deckCount: scenario.setup.deckSize },
    }));
    await runScenario(scenario);
  }, 20_000);
});

describe("captureBoard on a hand-made view", () => {
  const card = (over: Partial<DuelCard>): DuelCard => ({ controller: 0, location: 4, sequence: 0, position: 1, ...over });
  const view = (seat: number, cards: Partial<DuelEngineView["seats"][number]>): DuelEngineView => {
    const base = (index: number) => ({
      seat: index, lp: 8000, hand: [], deckCount: 0, extraCount: 0, extra: [],
      monsters: Array.from({ length: 7 }, () => null), spells: Array.from({ length: 8 }, () => null), graveyard: [], banished: [],
    });
    return {
      revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: [{ ...base(0), ...(seat === 0 ? cards : {}) }, { ...base(1), ...(seat === 1 ? cards : {}) }],
      prompt: null, chain: [], events: [], log: [], result: null,
    } as DuelEngineView;
  };
  const lookup = catalogLookup(dataDirectory);

  it("maps positions, Xyz materials and Pendulum Zones, and warns about counters and Equip Spells", () => {
    const library = resolveCard("Royal Magical Library", dataDirectory);
    const equip = resolveCard("Axe of Despair", dataDirectory);
    const elf = resolveCard("Mystical Elf", dataDirectory);
    const monsters = Array.from({ length: 7 }, () => null) as Array<DuelCard | null>;
    monsters[1] = card({ sequence: 1, code: library, position: 1, counters: [{ type: 1, count: 2 }] });
    monsters[2] = card({ sequence: 2, code: elf, position: 8 });
    monsters[3] = card({ sequence: 3, code: elf, position: 4, materials: [card({ code: elf, location: 128 })] });
    const spells = Array.from({ length: 8 }, () => null) as Array<DuelCard | null>;
    spells[0] = card({ location: 8, sequence: 0, code: equip, position: 1, type: 0x40002 });
    const capture = captureBoard(
      { seats: [view(0, { monsters, spells, lp: 4000 }), view(1, {})], mode: "normal", masterRule: 5 },
      lookup,
    );
    const p0 = capture.board.p0!;
    expect(p0.lp).toBe(4000);
    expect(p0.monsters?.[1]).toBe("Royal Magical Library");
    expect(p0.monsters?.[2]).toEqual({ card: "Mystical Elf", pos: "set" });
    expect(p0.monsters?.[3]).toEqual({ card: "Mystical Elf", pos: "def", materials: ["Mystical Elf"] });
    expect(p0.spells?.[0]).toBe("Axe of Despair");
    const warnings = capture.warnings.join("\n");
    expect(warnings).toMatch(/counters 0x1 x2/);
    expect(warnings).toMatch(/Equip Spell/);
  });
});
