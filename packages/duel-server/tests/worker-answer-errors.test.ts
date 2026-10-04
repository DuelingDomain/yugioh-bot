import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUEL_SEAT_LEFT_ERROR_CODE } from "@yugidraft/shared/duels";
import { EngineAnswerError } from "../src/prompts.js";
import { GameWorker } from "../src/worker-client.js";
import { handleWorkerRequest } from "../src/worker.js";

const { answer } = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("../src/engine.js", () => ({ createEngineGame: async () => ({ answer, close: vi.fn() }) }));
vi.mock("../src/legacy/index.js", () => ({ createLegacyEngineGame: vi.fn() }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    parentPort: null,
    Worker: class extends EventEmitter {
      postMessage(request: Parameters<typeof handleWorkerRequest>[0]) {
        void handleWorkerRequest(request).then((response) => this.emit("message", response));
      }
      async terminate() { return 0; }
    },
  };
});

describe("answer errors through the engine worker", () => {
  let worker: GameWorker;
  beforeEach(async () => {
    answer.mockReset();
    worker = new GameWorker();
    await worker.create({ mode: "normal", decks: [], seed: [], dataDirectory: "unused" });
  });
  afterEach(async () => {
    await handleWorkerRequest({ id: 0, op: "close" });
    await worker.close();
  });

  it("keeps the seat-left code and text across both worker boundaries", async () => {
    answer.mockImplementation(() => {
      throw new EngineAnswerError("That player has left. Pick again.", DUEL_SEAT_LEFT_ERROR_CODE);
    });
    await expect(worker.answer(0, "p1", { choice: "opt:0" })).rejects.toMatchObject({
      code: "seat_left", message: "That player has left. Pick again.",
    });
  });

  it("keeps a normal invalid answer error without a code", async () => {
    answer.mockImplementation(() => { throw new EngineAnswerError("Invalid answer"); });
    const error = await worker.answer(0, "p1", { choice: "invalid" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "Invalid answer" });
    expect(error).not.toHaveProperty("code");
  });
});
