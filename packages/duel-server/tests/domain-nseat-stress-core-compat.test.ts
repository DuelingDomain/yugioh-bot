import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createEngineGame, registerDomainCoreFactory } from "../src/engine.js";
import { createDomainCore } from "../src/domain-core.js";
import { compileBoard } from "./support/board.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { Session } from "./support/session.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { scenarios as TWO_SEAT_CASES } from "./scenarios/cases/domain.js";
import { DOMAIN_NSEAT_STRESS_CHAIN } from "./scenarios/multiplayer/domain-nseat-stress-chain.js";
import { SEATS, type Format } from "./scenarios/multiplayer/seat-kit.js";
import type { Scenario, Step } from "./support/dsl.js";

// Capture the real Standard core, without adding a production query hook.
const captured = vi.hoisted(() => ({ lib: null as import("ocgcore-wasm").OcgCoreSync | null,
  handle: null as import("ocgcore-wasm").OcgDuelHandle | null }));
vi.mock("ocgcore-wasm", async (original) => {
  const actual = await original<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const lib = await actual.default(options) as import("ocgcore-wasm").OcgCoreSync;
    const createDuel = lib.createDuel.bind(lib);
    lib.createDuel = (options) => {
      const handle = createDuel(options);
      captured.lib = lib;
      captured.handle = handle;
      return handle;
    };
    return lib;
  } };
});

describeWithCores("Domain core patch keeps Standard and two-seat rules", [liveNseat, ...needs.domainMulti()], () => {
  for (const base of DOMAIN_NSEAT_STRESS_CHAIN.filter((s) => s.setup.format !== "tag")) {
    it(`Standard: ${base.id}`, async () => {
      const setup = { ...base.setup, mode: "normal" as const };
      for (const seat of SEATS[setup.format as Format]) {
        const { deckMaster: _master, ...rest } = setup[seat]!;
        setup[seat] = rest;
      }
      const steps: Step[] = base.steps.map((step) => step.op !== "expectBoard" ? step : { ...step,
        board: Object.fromEntries(Object.entries(step.board).map(([seat, { deckMaster: _master, ...rest }]) => [seat, rest])) });
      const scenario: Scenario = { ...base, id: `${base.id}-standard`, setup, steps };
      const bytes = readFileSync(currentDomainMultiWasm());
      const game = await createEngineGame({ ...compileBoard(setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        steps.forEach((step, index) => session.run(step, index + 1));
        for (const seat of game.view(null).seats) {
          expect(captured.lib!.duelQueryCount(captured.handle!, seat.seat, 0x4000 as import("ocgcore-wasm").OcgLocation)).toBe(0);
          if (seat.eliminated) for (const location of [1, 2, 4, 8, 16, 32, 64]) {
            expect(captured.lib!.duelQueryCount(captured.handle!, seat.seat, location as import("ocgcore-wasm").OcgLocation)).toBe(0);
          }
        }
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally { game.close(); }
    });
  }

  for (const scenario of TWO_SEAT_CASES) {
    it(`Two seats on the tested multi Domain wasm: ${scenario.id}`, async () => {
      const bytes = readFileSync(currentDomainMultiWasm());
      registerDomainCoreFactory((ctx) => createDomainCore({ ...ctx, wasmBinary: bytes }));
      let game: Awaited<ReturnType<typeof createEngineGame>> | undefined;
      try {
        game = await createEngineGame({ ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory });
        const session = new Session(scenario, game);
        session.reachMainPhase();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(game.view(null).seats).toHaveLength(2);
        for (const seat of [0, 1]) {
          expect(game.view(seat).seats.map((s) => s.deckMaster)).toEqual(game.view(null).seats.map((s) => s.deckMaster));
          expect(game.view(seat).result).toEqual(game.view(null).result);
        }
        expect(game.view(null).seats[1]).toMatchObject({ lp: 8000, deckMaster: { inZone: true, returns: 0, nextCost: 0 } });
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally { game?.close(); registerDomainCoreFactory(createDomainCore); }
    });
  }
});
