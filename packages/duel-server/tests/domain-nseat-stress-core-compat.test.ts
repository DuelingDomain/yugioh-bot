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
import { expectKnownFailure, type KnownGap } from "./support/expected-failure.js";
import { firstDrawSourceFor } from "./scenarios/multiplayer/ffa-first-draw.js";
import { SEATS, type Format } from "./scenarios/multiplayer/seat-kit.js";
import { defineScenario, endTurn, expectBoard, expectNotOffered, select, specialSummon, type Scenario, type Step } from "./support/dsl.js";

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

// The Standard pending-loss cases fail on the installed P68 cores. Chain cleanup sends the removed Dust Tornado back to the
// Graveyard of the lost seat 1, because field::eliminate does not clear core.leave_confirmed. They need
// domain-core/proposals/domain-nseat-stress/remove-eliminated-chain-cards.patch
// (docs/specs/2026-10-02-approved-core-integration.md lines 210 and 218-226). Each case is green only for the
// known failure below. When the patch lands the case fails with "known gap fixed": remove the mark then.
const PENDING_LOSS_GAP: KnownGap = {
  patch: "remove-eliminated-chain-cards.patch",
  spec: "docs/specs/2026-10-02-approved-core-integration.md:210,218",
  failsWith: ["seat 1, location 16: expected 1 to be +0"],
};
const isPendingLoss = (id: string) => id.includes("-pending-loss-keeps-other-seat-chain-window");

describeWithCores("Domain core patch keeps Standard and two-seat rules", [liveNseat, ...needs.domainMulti()], () => {
  for (const domain of DOMAIN_NSEAT_STRESS_CHAIN.filter((s) => s.setup.format !== "tag")) {
    // The Domain fixture counts the extra FFA first draw. Standard MR3-5 skips it, so run the scenario as written.
    const base = firstDrawSourceFor(domain);
    const run = async () => {
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
          expect(captured.lib!.duelQueryCount(captured.handle!, seat.seat, 0x4000 as import("ocgcore-wasm").OcgLocation), `seat ${seat.seat}, location 16384`).toBe(0);
          if (seat.eliminated) for (const location of [1, 2, 4, 8, 16, 32, 64]) {
            expect(captured.lib!.duelQueryCount(captured.handle!, seat.seat, location as import("ocgcore-wasm").OcgLocation), `seat ${seat.seat}, location ${location}`).toBe(0);
          }
        }
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally { game.close(); }
    };
    if (isPendingLoss(base.id)) it(`Standard: ${base.id} [expected failure: ${PENDING_LOSS_GAP.patch}]`, () => expectKnownFailure(PENDING_LOSS_GAP, run));
    else it(`Standard: ${base.id}`, run);
  }

  const twoSeatSynchro = [
    defineScenario({ id: "domain-nseat-stress-two-seat-synchro-own-material", title: "Two seats: own Synchro materials stay legal",
      source: "docs/specs/2026-10-01-domain-nseat-stress.md", tags: ["domain", "synchro", "compatibility"],
      setup: { mode: "domain", p0: { deckMaster: "Stardust Dragon", monsters: ["The Magical King of Dimension Zeta", "Axe Raider"], extra: ["Black Rose Dragon"] }, p1: { deckMaster: "Celtic Guardian" } },
      steps: [specialSummon({ card: "Stardust Dragon", from: "dmz" }, "p0"), select("The Magical King of Dimension Zeta", "Axe Raider"),
        expectBoard({ p0: { lp: 8000, monsters: ["Stardust Dragon"], spells: [], grave: ["The Magical King of Dimension Zeta", "Axe Raider"], banished: [], extra: ["Black Rose Dragon"], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
          p1: { lp: 8000, monsters: [], spells: [], grave: [], banished: [], deckMaster: { inZone: true, returns: 0, nextCost: 0 } } })],
    }),
    defineScenario({ id: "domain-nseat-stress-two-seat-synchro-opponent-material", title: "Two seats: opponent Synchro materials stay illegal",
      source: "docs/specs/2026-10-01-domain-nseat-stress.md", tags: ["domain", "synchro", "compatibility"],
      setup: { mode: "domain", p0: { deckMaster: "Stardust Dragon", monsters: ["Axe Raider"] }, p1: { deckMaster: "Celtic Guardian", monsters: ["The Magical King of Dimension Zeta"] } },
      steps: [expectNotOffered("specialSummon", { card: "Stardust Dragon", from: "dmz" }, "p0"), endTurn("p0"),
        expectBoard({ p0: { lp: 8000, monsters: ["Axe Raider"], spells: [], grave: [], banished: [], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
          p1: { lp: 8000, monsters: ["The Magical King of Dimension Zeta"], spells: [], grave: [], banished: [], deckMaster: { inZone: true, returns: 0, nextCost: 0 } } })],
    }),
  ];
  for (const scenario of [...TWO_SEAT_CASES, ...twoSeatSynchro]) {
    it(`Two seats on the tested multi Domain wasm: ${scenario.id}`, async () => {
      const bytes = readFileSync(currentDomainMultiWasm());
      const luaErrors: string[] = [];
      registerDomainCoreFactory((ctx) => createDomainCore({ ...ctx, wasmBinary: bytes, errorHandler: (type, message) => {
        luaErrors.push(message); ctx.errorHandler(type, message);
      } }));
      let game: Awaited<ReturnType<typeof createEngineGame>> | undefined;
      try {
        game = await createEngineGame({ ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory });
        if (scenario.id === "domain-nseat-stress-two-seat-synchro-own-material") {
          // Stock skips this effect query for own material. A condition can
          // change Lua state and effect IDs, even when the material is legal.
          const loaded = captured.lib!.loadScript(captured.handle!, "domain-nseat-stress-synchro-order.lua", `
            local material=Duel.GetFieldCard(0,LOCATION_MZONE,1)
            local master=Duel.GetFieldCard(0,LOCATION_EXTRA,0)
            local calls=0
            local e=Effect.CreateEffect(material)
            e:SetType(EFFECT_TYPE_SINGLE)
            e:SetCode(EFFECT_SYNCHRO_MATERIAL)
            e:SetCondition(function() calls=calls+1 return true end)
            material:RegisterEffect(e)
            calls=0
            assert(material:IsCanBeSynchroMaterial(master))
            assert(calls==0,"own material must skip the Synchro material effect condition")
          `);
          expect(loaded, luaErrors.join("; ")).toBe(true);
        }
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
