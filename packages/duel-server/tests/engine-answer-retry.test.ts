import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DUEL_SEAT_LEFT_ERROR_CODE } from "@yugidraft/shared/duels";
import { OcgResponseType, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame } from "../src/engine.js";

const fake = vi.hoisted(() => ({
  options: [0xfffe0001n, 0xfffe0002n, 0xfffe0003n],
  messages: [] as OcgMessage[],
  buffers: [] as Uint8Array[],
  response: vi.fn(),
  refuse: true,
  reportElimination: true,
}));

// Fake only the core and its resources. Answer validation, retries and views use the real engine.
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async () => ({
    createDuel: () => ({}),
    destroyDuel: () => undefined,
    startDuel: () => undefined,
    duelNewCard: () => undefined,
    loadScript: (_handle: unknown, name: string) => {
      if (name === "duel-eliminate.lua" && fake.reportElimination) {
        // Length-prefixed MSG_DUELIST_ELIMINATED: seat 1, surrender reason 0.
        fake.buffers.push(new Uint8Array([3, 0, 0, 0, 200, 1, 0]));
      }
      return true;
    },
    duelSetResponse: fake.response,
    duelProcess: () => {
      fake.messages = fake.response.mock.calls.length > 0 && fake.refuse
        ? [{ type: actual.OcgMessageType.RETRY }]
        : [{ type: actual.OcgMessageType.SELECT_OPTION, player: 0, options: fake.options }];
      return actual.OcgProcessResult.WAITING;
    },
    duelGetMessage: () => fake.messages,
    duelQueryLocation: () => [],
    duelQueryCount: () => 0,
  }) };
});
vi.mock("../src/cards.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cards.js")>(),
  loadCardDatabase: () => ({
    readScript: () => "-- fake script",
    resolveLabel: () => "Choose an option",
    get: () => undefined,
    cardData: () => null,
  }),
}));
vi.mock("../src/multi-scripts.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/multi-scripts.js")>(),
  loadMultiScriptsFor: () => undefined,
}));
vi.mock("../src/raw-messages.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/raw-messages.js")>(),
  rawMessageCapture: () => ({ take: () => fake.buffers.splice(0) }),
}));

const dataDirectory = mkdtempSync(join(tmpdir(), "engine-answer-retry-"));
afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));
beforeEach(() => {
  fake.options = [0xfffe0001n, 0xfffe0002n, 0xfffe0003n];
  fake.messages = [];
  fake.buffers = [];
  fake.response.mockClear();
  fake.refuse = true;
  fake.reportElimination = true;
});

const open = (format: "ffa4" | "tag" = "ffa4") => createEngineGame({
  mode: "normal", format, dataDirectory,
  decks: Array.from({ length: 4 }, () => ({ main: [], extra: [], side: [] })),
  seed: ["1", "2", "3", "4"], multiWasmBinary: new ArrayBuffer(0),
});

describe("answer after a core retry", () => {
  it.each([true, false])("relabels a removed opponent pick before calling the core (elimination reported: %s)", async (reported) => {
    fake.reportElimination = reported;
    const game = await open();
    try {
      game.eliminate(1, 0);
      const before = game.view(0);
      const prompt = before.prompt!;
      expect(prompt.options.map((option) => option.id)).toEqual(["opt:1", "opt:2"]);
      expect(before.seats[1]).toMatchObject(reported ? { eliminated: true } : { pendingElimination: true });
      expect(() => game.answer(0, prompt.id, { choice: "opt:0" })).toThrowError(
        expect.objectContaining({ message: "That player has left. Pick again.", code: DUEL_SEAT_LEFT_ERROR_CODE }),
      );
      expect(fake.response).not.toHaveBeenCalled();
      expect(game.view(0)).toEqual(before);
      // The same prompt can still accept the surviving opponent.
      fake.refuse = false;
      game.answer(0, prompt.id, { choice: "opt:1" });
      expect(fake.response).toHaveBeenLastCalledWith(expect.anything(), { type: OcgResponseType.SELECT_OPTION, index: 1 });
    } finally { game.close(); }
  });

  it("relabels a core-refused pick when all eligible opponents are leaving", async () => {
    fake.options = [0xfffe0001n, 0xfffe0003n];
    fake.reportElimination = false;
    const game = await open("tag");
    try {
      game.eliminate(1, 0);
      const before = game.view(0);
      expect(before.prompt!.options.map((option) => option.id)).toEqual(["opt:0", "opt:1"]);
      expect(before.seats[1]).toMatchObject({ pendingElimination: true });
      expect(before.seats[3]).toMatchObject({ pendingElimination: true });
      expect(() => game.answer(0, before.prompt!.id, { choice: "opt:0" })).toThrowError(
        expect.objectContaining({ message: "That player has left. Pick again.", code: DUEL_SEAT_LEFT_ERROR_CODE }),
      );
      expect(fake.response).toHaveBeenCalledExactlyOnceWith(expect.anything(), { type: OcgResponseType.SELECT_OPTION, index: 0 });
      expect(game.view(0)).toEqual(before);
    } finally { game.close(); }
  });

  it.each([
    { name: "living opponent", options: [0xfffe0001n, 0xfffe0002n, 0xfffe0003n], choice: "opt:1" },
    { name: "ordinary option", options: [30n, 31n], choice: "opt:0" },
    { name: "direct attack", options: [0xffff0001n, 0xffff0002n, 0xffff0003n], choice: "opt:1" },
    { name: "mixed option types", options: [0xfffe0001n, 31n], choice: "opt:0" },
  ])("keeps Invalid answer for a refused $name", async ({ options, choice }) => {
    fake.options = options;
    const game = await open();
    try {
      game.eliminate(1, 0);
      const before = game.view(0);
      expect(() => game.answer(0, before.prompt!.id, { choice })).toThrowError(
        expect.objectContaining({ message: "Invalid answer", code: undefined }),
      );
      expect(fake.response).toHaveBeenCalledTimes(1);
      expect(game.view(0)).toEqual(before);
    } finally { game.close(); }
  });

  it("keeps a core-accepted pick of a leaving seat accepted", async () => {
    fake.options = [0xfffe0001n, 0xfffe0003n];
    fake.reportElimination = false;
    fake.refuse = false;
    const game = await open("tag");
    try {
      game.eliminate(1, 0);
      const before = game.view(0);
      expect(() => game.answer(0, before.prompt!.id, { choice: "opt:0" })).not.toThrow();
      expect(fake.response).toHaveBeenCalledWith(expect.anything(), { type: OcgResponseType.SELECT_OPTION, index: 0 });
      expect(game.view(0).revision).toBe(before.revision + 1);
    } finally { game.close(); }
  });
});
