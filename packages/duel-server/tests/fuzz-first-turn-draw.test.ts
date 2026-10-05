import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadNSource, replaySeats } from "../scripts/failure-to-scenario.js";
import { loadSource, replaySource } from "../scripts/lib/replay-source.js";
import { createEngineGame } from "../src/engine.js";
import { writeDifferentialFailure } from "./differential/failures.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { runDuel } from "./fuzz/driver.js";
import { writeFailure } from "./fuzz/failures.js";
import { viewsHash } from "./fuzz/invariants.js";
import { replayDuel } from "./fuzz/replay.js";
import { readCore } from "./fuzz-n/core.js";
import { playDuel } from "./fuzz-n/driver.js";
import { buildFailureFile, readFailureFile, writeFailureFile } from "./fuzz-n/failures.js";
import { runIsolated } from "./fuzz-n/isolated.js";
import { nViewsHash } from "./fuzz-n/invariants.js";
import { describeWithCores, needs } from "./support/cores.js";

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "fuzz-draw-rule-")); dirs.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describeWithCores("fuzz files retain the first-turn draw rule", [needs.standard(DATA), needs.domain(DATA), needs.installedMulti(DATA),
  ...needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm"))], () => {
  it.each((["normal", "domain"] as const).flatMap((mode) => [false, true].map((firstTurnDraw) => ({ mode, firstTurnDraw }))))
  ("$mode: plain fuzz saves and replays the resolved $firstTurnDraw flag", async ({ mode, firstTurnDraw }) => {
    const outcome = await runDuel({ seed: 10, mode, masterRule: 5, maxSteps: 3 }, DATA, { collectHashes: true, firstTurnDraw });
    const file = writeFailure(outcome, DATA, directory());
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.engine?.firstTurnDraw).toBe(firstTurnDraw);
    const source = loadSource(file);
    const views = await replaySource(source, DATA, outcome.journal.length);
    expect(viewsHash({ v0: views.seats[0], v1: views.seats[1], vs: views.spectator })).toBe(outcome.finalHash);
    expect(await replayDuel(outcome, DATA)).toEqual({ ok: true });
    const output = execFileSync("npx", ["tsx", "scripts/fuzz-repro.ts", "--file", file], { encoding: "utf8" });
    expect(output).toContain(`final views hash ${outcome.finalHash}`);
  }, 30_000);

  it.each([
    { mode: "normal", firstTurnDraw: true },
    { mode: "domain", firstTurnDraw: true },
  ] as const)("$mode: a local saved $firstTurnDraw flag overrides the current rule", async ({ mode, firstTurnDraw }) => {
    const seed = ["1", "2", "3", "4"];
    const decks = Array.from({ length: 2 }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
      ...(mode === "domain" ? { deckMaster: 48305365 } : {}) }));
    const engine = { mode, masterRule: 5 as const, firstTurnDraw, decks, seed };
    const game = await createEngineGame({ ...engine, dataDirectory: DATA });
    const journal = [];
    let expected;
    try {
      for (let actor = 0; actor < 2; actor++) {
        for (let viewer = 0; viewer < 2; viewer++) for (let seat = 0; seat < 2; seat++) {
          const view = game.view(viewer).seats[seat]!;
          const draws = Number(seat <= actor && (seat > 0 || firstTurnDraw));
          expect(view.hand).toHaveLength(5 + draws);
          expect(view.deckCount).toBe(35 - draws);
        }
        const own = game.view(actor);
        expect(own.turnSeat).toBe(actor);
        expect(own.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        const command = { seat: actor, promptId: own.prompt!.id, revision: own.revision, answer: { choice: "to_ep" } };
        game.answer(actor, command.promptId, command.answer);
        journal.push(command);
      }
      expected = { v0: game.view(0), v1: game.view(1), vs: game.view(null) };
    } finally { game.close(); }
    const scenario = { seed: 1, mode, masterRule: 5 as const, maxSteps: 2 };
    const file = writeDifferentialFailure({ mode, seed: 1, recorded: { scenario, engine, journal,
      deckNotes: ["test", "test"], disjoint: false, note: "step cap" },
      diff: { seed: 1, step: 0, kind: "views", message: "test", expected: "a", actual: "b" },
      found: "multi", referenceWasm: "", multiWasm: "", dataDirectory: DATA }, directory());
    const source = loadSource(file);
    expect(source.firstTurnDraw).toBe(firstTurnDraw);
    const replay = await replaySource(source, DATA, journal.length);
    expect(replay.seats).toEqual([expected.v0, expected.v1]);
    const output = execFileSync("npx", ["tsx", "scripts/fuzz-repro.ts", "--file", file], { encoding: "utf8" });
    expect(output).toContain(`final views hash ${viewsHash(expected)}`);
  }, 30_000);

  it.each((["normal", "domain"] as const).flatMap((mode) => [false, true].map((firstTurnDraw) => ({ mode, firstTurnDraw }))))
  ("$mode: FFA3 saves and replays $firstTurnDraw, including the child process", async ({ mode, firstTurnDraw }) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1));
    const scenario = { seed: 10, mode, format: "ffa3" as const, masterRule: 5 as const, maxSteps: 3, eliminateRate: 0 };
    const core = readCore(join(DATA, mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm"));
    const outcome = await playDuel(scenario, { dataDirectory: DATA, multiWasmBinary: core.bytes, firstTurnDraw });
    const file = writeFailureFile(buildFailureFile(outcome, core.info, { invariant: "test", message: "test", step: outcome.steps }), directory());
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.engine?.firstTurnDraw).toBe(firstTurnDraw);
    const source = loadNSource(file);
    const views = await replaySeats(source, DATA, source.commands.length, core.info.path);
    expect(nViewsHash({ seats: views.seats, spectator: views.spectator })).toBe(outcome.finalHash);
    const recorded = readFailureFile(file);
    const replay = await runIsolated(scenario, { dataDirectory: DATA, corePath: core.info.path, timeoutMs: 20_000,
      firstTurnDraw: recorded.engine!.firstTurnDraw, script: { journal: recorded.answers } });
    expect(replay.finalHash).toBe(outcome.finalHash);
  }, 30_000);

  it.each(["fuzz", "differential", "fuzz-n"])("%s: a file with no flag gives one warning", (kind) => {
    const file = join(directory(), "legacy.json");
    const scenario = { seed: 1, mode: "normal", masterRule: 5, format: "ffa3" };
    const raw = { scenario, decks: [], journal: [],
      ...(kind === "differential" ? { engine: { mode: "normal", masterRule: 5 }, differential: {} } : {}),
      ...(kind === "fuzz-n" ? { answers: [], check: {}, wasm: {} } : {}) };
    writeFileSync(file, JSON.stringify(raw));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = kind === "fuzz-n" ? loadNSource(file) : loadSource(file);
    expect(source.firstTurnDraw).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("no saved first-turn draw rule");
    expect(warn.mock.calls[0]![0]).toContain("current rule");
  });
});
