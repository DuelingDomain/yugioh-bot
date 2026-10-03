import { readFileSync } from "node:fs";
import { expect, vi } from "vitest";
import { OcgLocation, OcgPosition, OcgQueryFlags } from "ocgcore-wasm";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { runScenarios } from "../../support/runner.js";
import { ELIMINATION_RETURN_PROOFS, type ReturnProof } from "./elimination-returns.js";
import { defineScenarioWithFfaFirstDraw } from "./ffa-first-draw.js";

// Capture the real API for queries. Every duel, response and query uses the actual wasm.
// Views hide lost seats, so a view alone cannot prove that chain cleanup kept a card out.
const captured = vi.hoisted(() => ({
  lib: null as import("ocgcore-wasm").OcgCoreSync | null,
  handle: null as import("ocgcore-wasm").OcgDuelHandle | null,
}));
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

// Debug fixtures specify ownership that the board DSL cannot express.
// Actions and assertions still use real engine prompts and every seat's final state.
describeWithCores("live elimination returns", liveNseat, () => {
  for (const mode of ["normal", "domain"] as const) {
    describeWithCores(mode, mode === "domain" ? needs.domainMulti() : [], () => {
      runScenarios("owner zones and stock controls", ELIMINATION_RETURN_PROOFS, async (input) => {
        const setup = { ...input.setup, mode };
        if (mode === "domain") {
          const masters = ["Axe Raider", "Celtic Guardian", "Battle Ox", "Giant Soldier of Stone"];
          for (const [index, seat] of ["p0", "p1", "p2", ...(setup.format === "ffa3" ? [] : ["p3"])].entries()) {
            const id = seat as "p0" | "p1" | "p2" | "p3";
            setup[id] = { ...setup[id], deckMaster: masters[index] };
          }
        }
        // Domain draws on turn 1 in FFA and Tag. Add that card to the exact checks.
        const scenario = defineScenarioWithFfaFirstDraw({ ...input, setup }) as ReturnProof;
        const compiled = compileBoard(setup);
        const bytes = mode === "domain" ? readFileSync(currentDomainMultiWasm()) : undefined;
        const binary = bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : nseatWasmBinary();
        const game = await createEngineGame({
          ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: binary,
          seed: ["1", "2", "3", "4"],
          startupScripts: [...compiled.options.startupScripts!, { name: "elimination-ownership.lua", content: scenario.fixture ?? "" }],
        });
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          const initialCounts = game.view(null).seats.map((seat) => new Map(
            [1, 2, 4, 8, 16, 32, 64, 0x4000].map((location) => [location,
              captured.lib!.duelQueryCount(captured.handle!, seat.seat, location as OcgLocation)]),
          ));
          session.startRecording();
          scenario.steps.forEach((step, index) => session.run(step, index + 1));
          const seats = game.view(null).seats;
          expect(seats.map((seat) => seat.seat)).toEqual(seats.map((_, index) => index));
          for (const seat of seats) {
            const view = game.view(seat.seat);
            expect(view.seats.map((s) => s.eliminated)).toEqual(seats.map((s) => s.eliminated));
            expect(view.result).toEqual(game.view(null).result);
            const query = (location: number) => captured.lib!.duelQueryCount(captured.handle!, seat.seat, location as OcgLocation);
            // Tag ends at team loss. Its stock core does not remove cards after MSG_WIN.
            const tagLoss = setup.format === "tag" && seat.eliminated;
            expect(query(0x4000), `Deck Master Zone of seat ${seat.seat}`).toBe(tagLoss
              ? initialCounts[seat.seat].get(0x4000) : mode === "domain" && !seat.eliminated ? 1 : 0);
            const own = view.seats[seat.seat];
            for (const [location, count] of [
              [1, own.deckCount], [2, own.hand.length], [4, own.monsters.filter(Boolean).length],
              [8, own.spells.filter(Boolean).length], [16, own.graveyard.length],
              [32, own.banished.length], [64, own.extraCount],
            ]) expect(query(location), `real zone ${location} of seat ${seat.seat}`).toBe(tagLoss
              ? initialCounts[seat.seat].get(location) : seat.eliminated ? 0 : count);
          }
          if (scenario.faceUpExtra || scenario.id.includes("pendulum-")) {
            const { seat, code } = scenario.faceUpExtra ?? { seat: 1, code: 16178681 };
            const extra = captured.lib!.duelQueryLocation(captured.handle!, {
              controller: seat as 0 | 1, location: OcgLocation.EXTRA,
              flags: (OcgQueryFlags.CODE | OcgQueryFlags.POSITION) as OcgQueryFlags,
            });
            const card = extra.find((card) => card?.code === code);
            expect(card, "returned Pendulum in the owner's Extra Deck").toBeDefined();
            expect(card!.position! & OcgPosition.FACEUP).not.toBe(0);
          }
          expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
        } finally { game.close(); }
      });
    });
  }
});
