import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createEngineGame, registerDomainCoreFactory } from "../../../src/engine.js";
import { createDomainCore } from "../../../src/domain-core.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { currentDomainMultiWasm, currentNseatWasm, describeWithCores, needs } from "../../support/cores.js";
import { defineScenario, endTurn, expectBoard, select, specialSummon, type Scenario } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session } from "../../support/session.js";
import { domainVariant } from "./domain-variants.js";

const captured = vi.hoisted(() => ({
  lib: null as import("ocgcore-wasm").OcgCoreSync | null,
  handle: null as import("ocgcore-wasm").OcgDuelHandle | null,
}));
// Capture the real core and handle. Every call still uses the real engine.
vi.mock("ocgcore-wasm", async (original) => {
  const actual = await original<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const lib = await actual.default(options) as import("ocgcore-wasm").OcgCoreSync;
    const createDuel = lib.createDuel.bind(lib);
    lib.createDuel = (options) => {
      const handle = createDuel(options);
      captured.lib = lib; captured.handle = handle;
      return handle;
    };
    return lib;
  } };
});

const ZETA = "The Magical King of Dimension Zeta";
const AXE = "Axe Raider";
const STARDUST = "Stardust Dragon";
const OX = "Battle Ox";
const cases = [
  ["1v1", 2, 0], ["ffa3", 3, 2], ["ffa4", 4, 3], ["tag", 4, 0], ["tag", 4, 1],
] as const;

function ownMaterials(format: typeof cases[number][0], count: number, actor: number): Scenario {
  const setup: Scenario["setup"] = { format };
  const board: Parameters<typeof expectBoard>[0] = {};
  for (let seat = 0; seat < count; ++seat) {
    const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
    setup[id] = seat === actor ? { monsters: [ZETA, AXE], extra: [STARDUST] } : { monsters: [OX] };
    board[id] = { lp: format === "tag" ? 16000 : 8000, monsters: seat === actor ? [STARDUST] : [OX],
      spells: [], grave: seat === actor ? [ZETA, AXE] : [], banished: [], extra: [] };
  }
  const by = `p${actor}` as "p0" | "p1" | "p2" | "p3";
  return defineScenario({
    id: `synchro-effect-order-${format}-${by}`, title: `${format}: own material keeps the stock condition query order`,
    source: "Core patch 0068; stock own material skips EFFECT_SYNCHRO_MATERIAL conditions", tags: ["synchro", "compatibility", format], setup,
    steps: [
      ...Array.from({ length: actor }, (_, seat) => endTurn(`p${seat}` as "p0" | "p1" | "p2")),
      specialSummon(STARDUST, by), select(ZETA, AXE), expectBoard(board),
    ],
  });
}

function binary(path: string): ArrayBuffer {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describeWithCores("live stock Synchro material condition order", [liveNseat, ...needs.domainMulti()], () => {
  for (const [format, count, actor] of cases) for (const domain of [false, true]) {
    const base = ownMaterials(format, count, actor);
    const scenario = domain ? domainVariant(base) : base;
    it(scenario.id, async () => {
      // Two-seat controls must use the patched multi binary, so the installed stock
      // 1v1 binary cannot hide a regression in the multi core's n_duelists == 2 path.
      const bytes = binary(domain ? currentDomainMultiWasm() : currentNseatWasm());
      if (domain && count === 2) registerDomainCoreFactory((ctx) => createDomainCore({ ...ctx, wasmBinary: new Uint8Array(bytes) }));
      let game: Awaited<ReturnType<typeof createEngineGame>> | undefined;
      try {
        game = await createEngineGame({ ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
          ...(count > 2 ? { multiWasmBinary: bytes } : !domain ? { standardWasmBinary: bytes } : {}) });
        const session = new Session(scenario, game);
        session.reachMainPhase();
        expect(captured.lib!.loadScript(captured.handle!, "synchro-material-order-probe.lua", `
          local material=Duel.GetFieldCard(${actor},LOCATION_MZONE,0)
          local synchro=Duel.GetFieldCard(${actor},LOCATION_EXTRA,0)
          local calls=0
          local e=Effect.CreateEffect(material)
          e:SetType(EFFECT_TYPE_SINGLE)
          e:SetCode(EFFECT_SYNCHRO_MATERIAL)
          e:SetCondition(function() calls=calls+1 return true end)
          material:RegisterEffect(e)
          calls=0
          assert(material:IsCanBeSynchroMaterial(synchro))
          STOCK_MATERIAL_CONDITION_CALLS=calls
        `)).toBe(true);
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(captured.lib!.loadScript(captured.handle!, "synchro-material-order-result.lua",
          'assert(STOCK_MATERIAL_CONDITION_CALLS==0,"own material must skip the stock material effect condition")')).toBe(true);
        expect(game.diagnostics().filter((d) => d.kind === "stderr")).toEqual([]);
      } finally {
        game?.close();
        if (domain && count === 2) registerDomainCoreFactory(createDomainCore);
      }
    });
  }
});
