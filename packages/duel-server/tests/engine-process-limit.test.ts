import { expect, it, vi } from "vitest";
import { OcgProcessResult } from "ocgcore-wasm";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const fixture = vi.hoisted(() => ({ calls: 0 }));
vi.mock("ocgcore-wasm", async original => {
  const core = await original<typeof import("ocgcore-wasm")>();
  return { ...core, default: async (...args: Parameters<typeof core.default>) => {
    const lib = await core.default(...args);
    return { ...lib, duelProcess: () => {
      fixture.calls++;
      // Stop a missing production guard from hanging this regression test itself.
      if (fixture.calls > 100_000) throw new Error("Test stopped an unbounded core loop");
      return OcgProcessResult.CONTINUE;
    }, duelGetMessage: () => [] };
  } };
});

describeWithCores("process calls without a prompt", [needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("%s: fails clearly after 100,000 calls instead of looping forever", async engine => {
    fixture.calls = 0;
    await expect((engine === "legacy" ? createLegacyEngineGame : createEngineGame)({
      mode: "normal", decks: Array.from({ length: 2 }, () => ({ main: Array(20).fill(15025844), extra: [], side: [] })),
      seed: ["1", "2", "3", "4"], dataDirectory: DATA,
    }).then(game => { game.close(); })).rejects.toThrow("Engine exceeded 100000 process calls without a player prompt");
    expect(fixture.calls).toBe(100_000);
  });
});
