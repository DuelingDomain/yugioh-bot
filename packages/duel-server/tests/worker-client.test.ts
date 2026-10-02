import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptTraceEntry } from "../src/prompt-trace.js";
import { GameWorker } from "../src/worker-client.js";

// Only the thread transport is mocked; prompts go through GameWorker's message handler.
const transports = vi.hoisted(() => [] as import("node:events").EventEmitter[]);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      constructor() { super(); transports.push(this); }
      postMessage() {}
      async terminate() { return 0; }
    },
  };
});

const games: GameWorker[] = [];
afterEach(async () => {
  for (const game of games.splice(0)) await game.close();
  transports.length = 0;
});

function makeWorker() {
  const game = new GameWorker();
  games.push(game);
  const transport = transports.at(-1)!;
  const emitPrompt = (index: number) => transport.emit("message", { id: index, ok: true, promptTrace: prompt(index) });
  return { game, transport, emitPrompt };
}

function prompt(index: number): PromptTraceEntry {
  return {
    promptId: `prompt-${index}`, revision: index, turn: index + 1, turnSeat: 0,
    phase: "main1", promptSeat: 0, promptType: "action", kind: "choice",
    options: [{ id: "to_ep", label: "End turn" }], chainSeats: [],
    seats: [{ seat: 0, handCount: 5, deckCount: 35 }],
  };
}

describe("GameWorker prompt history", () => {
  it("starts empty and records prompts in chronological order", () => {
    const { game, transport, emitPrompt } = makeWorker();
    expect(game.promptLog()).toHaveLength(0);
    transport.emit("message", { id: 0, ok: true });
    for (let index = 0; index < 3; index += 1) emitPrompt(index);
    expect(game.promptLog()).toEqual([prompt(0), prompt(1), prompt(2)]);
  });

  it("keeps only the newest 5,000 prompts in order after multiple wraps", () => {
    const { game, emitPrompt } = makeWorker();
    const total = 10_025;
    for (let index = 0; index < total; index += 1) {
      emitPrompt(index);
      if (index === 4_999) {
        expect(game.promptLog()).toHaveLength(5_000);
        expect(game.promptLog()[0]).toEqual(prompt(0));
      }
      if (index === 5_000) {
        expect(game.promptLog()).toHaveLength(5_000);
        expect(game.promptLog()[0]).toEqual(prompt(1));
      }
    }
    const log = game.promptLog();
    expect(log).toHaveLength(5_000);
    expect(log).toEqual(Array.from({ length: 5_000 }, (_, index) => prompt(total - 5_000 + index)));
    expect(log.at(-1)).toEqual(prompt(total - 1));
  });

  it("ignores consecutive duplicate prompt IDs before and after the cap", () => {
    const { game, emitPrompt } = makeWorker();
    emitPrompt(0);
    emitPrompt(0);
    expect(game.promptLog()).toHaveLength(1);
    for (let index = 1; index <= 5_000; index += 1) emitPrompt(index);
    emitPrompt(5_000);
    expect(game.promptLog()).toHaveLength(5_000);
    expect(game.promptLog()[0]).toEqual(prompt(1));
    expect(game.promptLog().at(-1)).toEqual(prompt(5_000));
    emitPrompt(5_001);
    expect(game.promptLog()[0]).toEqual(prompt(2));
    expect(game.promptLog().at(-1)).toEqual(prompt(5_001));
  });

  it("returns snapshots that remain ordered when later prompts evict entries", () => {
    const { game, emitPrompt } = makeWorker();
    for (let index = 0; index < 5_000; index += 1) emitPrompt(index);
    const snapshot = game.promptLog();
    emitPrompt(5_000);
    expect(snapshot).toHaveLength(5_000);
    expect(snapshot[0]).toEqual(prompt(0));
    expect(snapshot.at(-1)).toEqual(prompt(4_999));
    expect(game.promptLog()[0]).toEqual(prompt(1));
  });

  it.each(["close", "error", "exit"] as const)("clears prompts on %s and ignores late messages", async (event) => {
    const { game, transport, emitPrompt } = makeWorker();
    for (let index = 0; index < 5_001; index += 1) emitPrompt(index);
    const pending = expect(game.view(0)).rejects.toThrow(/Engine worker/);
    if (event === "close") await game.close();
    else if (event === "error") transport.emit("error", new Error("Engine worker failed"));
    else transport.emit("exit", 1);
    await pending;
    expect(game.running).toBe(false);
    expect(game.promptLog()).toHaveLength(0);
    emitPrompt(5_001);
    expect(game.promptLog()).toHaveLength(0);
  });
});
