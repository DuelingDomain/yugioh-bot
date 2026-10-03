import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { playDuel } from "./fuzz-n/driver.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Fix the board input, because a generated deck can change with the card pool.
// The driver and checker still use the real Domain core and read every view.
const fixture = await vi.hoisted(async () => {
  const { compileBoard } = await import("./support/board.js");
  const { TAG_CHAIN_STALL_BOARD } = await import("./fixtures/tag-chain-stall-board.js");
  const { options } = compileBoard(TAG_CHAIN_STALL_BOARD);
  options.startupScripts![0]!.content += `
Duel.GetFieldGroup(0,LOCATION_GRAVE,0):Filter(Card.IsCode,nil,27096833):GetFirst():CompleteProcedure()
`;
  return options;
});
vi.mock("./fuzz-n/decks.js", () => ({
  buildSeatDecks: () => ({ decks: fixture.decks, disjoint: false, notes: ["Fixed optional-chain board"] }),
}));
vi.mock("../src/engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine.js")>();
  return { ...actual, createEngineGame: (options: Parameters<typeof actual.createEngineGame>[0]) =>
    actual.createEngineGame({ ...options, ...fixture }) };
});
vi.mock("./fuzz/answers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fuzz/answers.js")>();
  return { ...actual, planAnswer: (...args: Parameters<typeof actual.planAnswer>) => {
    const [prompt] = args;
    const effect = prompt.context?.type === "chain" && prompt.options.find((option) => option.card?.code === 27096833);
    return effect
      ? { candidates: [{ choice: effect.id }], exact: true, note: "Repeat Liberator's optional effect" }
      : actual.planAnswer(...args);
  } };
});

describeWithCores("Domain fuzz can leave an optional chain loop", [liveNseat, ...needs.domainMulti()], () => {
  it("Tag Liberator/Metaion board leaves the optional-chain loop and reaches a result", async () => {
    const bytes = readFileSync(currentDomainMultiWasm());
    const previousNow = Date.now;
    Date.now = () => Date.UTC(2026, 0, 1);
    try {
      const result = await playDuel({ format: "tag", seed: 60, mode: "domain", masterRule: 5, maxSteps: 1000, eliminateRate: 0.5 }, {
        dataDirectory: engineDataDirectory,
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      expect(result.failure).toBeNull();
      expect(result.status).toBe("ended");
      expect(result.result).not.toBeNull();
      expect(result.stats["chain-stall-passes"]).toBeGreaterThan(0);
    } finally { Date.now = previousNow; }
  }, 30_000);
});
