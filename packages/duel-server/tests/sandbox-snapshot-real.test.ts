import { afterEach, expect, it, vi } from "vitest";
import type { OcgCoreSync, OcgDuelHandle } from "ocgcore-wasm";
import { parseSandboxBoard, type SandboxBoard, type SandboxRun } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { readCoreCapabilities } from "../src/core-capabilities.js";
import { compileBoard } from "../src/presets/board.js";
import { readSandboxEngineSnapshot, buildSandboxSnapshot } from "../src/sandbox-snapshot.js";
import { defaultAnswer } from "../src/scripted-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// Retain the core handle in this test only. Production must use a private worker operation.
const cores = vi.hoisted(() => [] as Array<{ lib: OcgCoreSync; handle: OcgDuelHandle }>);
vi.mock("ocgcore-wasm", async (original) => {
  const module = await original<typeof import("ocgcore-wasm")>();
  return { ...module, default: async (...args: Parameters<typeof module.default>) => {
    const lib = await module.default(...args) as OcgCoreSync;
    const create = lib.createDuel.bind(lib);
    lib.createDuel = (options) => { const handle = create(options); if (handle) cores.push({ lib, handle }); return handle; };
    return lib;
  } };
});
const games: EngineGame[] = [];
const run: SandboxRun = { bots: { "1": "manual", "2": "manual", "3": "manual" }, seed: ["1", "2", "3", "4"] };
afterEach(() => { games.splice(0).forEach((game) => game.close()); cores.length = 0; });
async function start(board: SandboxBoard) {
  const compiled = compileBoard(board, DATA);
  const game = await createEngineGame({ ...compiled.options, mode: board.mode ?? "normal", dataDirectory: DATA, seed: run.seed! });
  games.push(game);
  return game;
}
function capture(game: EngineGame, board: SandboxBoard) {
  const { lib, handle } = cores[games.indexOf(game)];
  return buildSandboxSnapshot(readSandboxEngineSnapshot(lib, handle, game.view(0), board.mode === "domain"), board, run);
}
function field(game: EngineGame) {
  return game.view(0).seats.map((seat) => ({ lp: seat.lp, eliminated: seat.eliminated,
    monsters: seat.monsters, spells: seat.spells, graveyard: seat.graveyard, banished: seat.banished }));
}

describeWithCores("raw sandbox capture with real cores", [needs.standard(DATA), needs.installedMulti(DATA), needs.cards(DATA)], () => {
  it("captures an action and restores the visible field; reports the new draw and unequal Deck sizes", async () => {
    const board: SandboxBoard = { startAt: "draw", deckSize: 4,
      p0: { monsters: [{ card: 15025844, pos: "set" }], spells: [{ card: 83968380, pos: "set" }],
        deck: [89631139, 46986414, 55144522, 5318639] },
      p1: { hand: [15025844], monsters: [null, { card: 15025844, pos: "set" }] } };
    const game = await start(board);
    const first = game.view(0);
    expect(first.prompt).not.toBeNull();
    const activate = first.prompt!.options.find((option) => option.card?.code === 83968380);
    expect(activate).toBeDefined();
    game.answer(first.prioritySeat!, first.prompt!.id, { choice: activate!.id });
    for (let step = 0; step < 12; step++) {
      const visible = game.view(0);
      if (visible.seats[0].graveyard.some((card) => card.code === 83968380)) break;
      const current = game.view(visible.prioritySeat!);
      expect(current.prompt).not.toBeNull();
      game.answer(current.prioritySeat!, current.prompt!.id, defaultAnswer(current.prompt!).answer);
    }
    expect(game.view(0).seats[0].graveyard.map((card) => card.code)).toContain(83968380);
    const before = game.view(0);
    const result = capture(game, board);
    expect(result.board.p0?.deck).toEqual([55144522, 5318639]);
    expect(result.board.p1?.hand).toEqual([15025844]);
    expect(result.board.p1?.monsters?.[1]).toMatchObject({ card: 15025844, pos: "set" });
    expect(game.view(0)).toEqual(before);
    expect(parseSandboxBoard(result.board)).toEqual(result.board);
    const restored = await start(result.board);
    expect(field(restored)).toEqual(field(game));
    expect(result.lost.join("\n")).toContain("Draw Phase");
    expect(result.lost.join("\n")).toContain("unequal Deck sizes");
    expect(restored.view(0).seats[0].hand.length).toBe(before.seats[0].hand.length + 1);
  }, 30_000);

  it.each([5, 6])("captures and restores both FFA4 shared Extra Monster Zone pairs at slot %i", async (slot) => {
    const monsters = [...Array(slot).fill(null), { card: 41999284, pos: "atk" as const }];
    const board: SandboxBoard = { format: "ffa4", startAt: "draw", deckSize: 10,
      p0: { monsters }, p1: { monsters }, p2: { monsters }, p3: { monsters } };
    const game = await start(board);
    const before = game.view(0);
    const shared = readCoreCapabilities(DATA, "ocgcore.multi.wasm", game.coreInfo().wasmSha).ffa4SharedExtraZones;
    const pairs = shared ? [1, 0, 3, 2] : [null, null, null, null];
    expect(before.seats.map(seat => seat.sharedExtraWith)).toEqual(pairs);
    const result = capture(game, board);
    for (const [seat, id] of (["p0", "p1", "p2", "p3"] as const).entries()) {
      expect(before.seats[seat].monsters[slot]).toMatchObject({ code: 41999284, controller: seat, sequence: slot });
      expect(result.board[id]?.monsters?.[slot]).toMatchObject({ card: 41999284, pos: "atk" });
      expect(result.board[id]?.monsters?.filter(Boolean)).toHaveLength(1);
    }
    expect(game.view(0)).toEqual(before);
    expect(parseSandboxBoard(result.board)).toEqual(result.board);
    const restored = await start(result.board);
    expect(field(restored)).toEqual(field(game));
    expect(restored.view(0).seats.map(seat => seat.sharedExtraWith)).toEqual(pairs);
  }, 30_000);

  it("captures an eliminated FFA4 seat with its place and LP intact", async () => {
    const board: SandboxBoard = { format: "ffa4", startAt: "draw", p0: { spells: [{ card: 83968380, pos: "set" }] },
      p2: { monsters: [null, null, { card: 15025844, pos: "def" }] } };
    const game = await start(board);
    game.eliminate(1, 0);
    const result = capture(game, board);
    expect(result.board.eliminated).toEqual(["p1"]);
    expect(result.board.p1).toEqual({ lp: game.view(0).seats[1].lp });
    expect(result.board.p2?.monsters?.[2]).toMatchObject({ card: 15025844, pos: "def" });
    expect(parseSandboxBoard(result.board)).toEqual(result.board);
    // H1 owns pre-start elimination. Reapply the real loss here to test the captured field independently.
    const restored = await start(result.board);
    restored.eliminate(1, 0);
    expect(field(restored)).toEqual(field(game));
  }, 30_000);
});


describeWithCores("Domain sandbox capture", [needs.domain(DATA), needs.cards(DATA)], () => {
  it("queries both Deck Master zones without changing the live state", async () => {
    const board: SandboxBoard = { mode: "domain", startAt: "draw", deckSize: 4,
      p0: { deckMaster: 15025844, spells: [{ card: 83968380, pos: "set" }] },
      p1: { deckMaster: 89631139, hand: [46986414] } };
    const game = await start(board);
    const before = game.view(0);
    const result = capture(game, board);
    expect(result.board.p0?.deckMaster).toBe(15025844);
    expect(result.board.p1?.deckMaster).toBe(89631139);
    expect(result.board.p1?.hand).toEqual([46986414]);
    expect(game.view(0)).toEqual(before);
  }, 30_000);
});
