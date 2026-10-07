import { afterEach, expect, it, vi } from "vitest";
import { handleWorkerRequest } from "../src/worker.js";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../src/engine.js", () => ({ createEngineGame: create }));
vi.mock("../src/legacy/index.js", () => ({ createLegacyEngineGame: create }));
const error = { code: 3743515, scriptFile: "c3743515.lua", line: 61, message: "runtime error", index: 1,
  mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "strict" } as const;
afterEach(async () => { await handleWorkerRequest({ id: 0, op: "close" }); create.mockReset(); });

it("deduplicates a recovered creation but distinguishes another failed start's seed", async () => {
  create.mockImplementation(async (options) => { options.onScriptError(error); throw new Error("Strict card error"); });
  async function attempt(id: number, seed: string[], dataDirectory: string) {
    const result = await handleWorkerRequest({ id, op: "create", options: { mode: "normal", decks: [], seed, dataDirectory } });
    await handleWorkerRequest({ id: 0, op: "close" });
    expect(result.ok).toBe(false);
    return result.scriptErrors![0]!.commandHash;
  }
  const first = await attempt(1, ["1", "2", "3", "4"], "/first/path");
  expect(await attempt(99, ["1", "2", "3", "4"], "/recovered/path")).toBe(first);
  expect(await attempt(1, ["5", "6", "7", "8"], "/first/path")).not.toBe(first);
});

it("hashes failed command branches canonically without advancing accepted history", async () => {
  create.mockImplementation(async (options) => ({
    answer() { options.onScriptError(error); throw new Error("Strict card error"); }, close() {},
  }));
  await handleWorkerRequest({ id: 1, op: "create", options: { mode: "normal", decks: [], seed: ["1"], dataDirectory: "unused" } });
  const first = await handleWorkerRequest({ id: 2, op: "answer", seat: 0, promptId: "p1", answer: { choice: "a", finish: true } });
  const retry = await handleWorkerRequest({ id: 3, op: "answer", seat: 0, promptId: "p1", answer: { finish: true, choice: "a" } });
  const other = await handleWorkerRequest({ id: 4, op: "answer", seat: 0, promptId: "p1", answer: { choice: "b", finish: true } });
  expect(retry.scriptErrors![0]!.commandHash).toBe(first.scriptErrors![0]!.commandHash);
  expect(other.scriptErrors![0]!.commandHash).not.toBe(first.scriptErrors![0]!.commandHash);
});
