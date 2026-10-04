import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { OcgLocation } from "ocgcore-wasm";
import { createEngineGame } from "../../../src/engine.js";
import { botTableOf, choosePracticeBotAnswer } from "../../../src/practice-bot.js";
import { compileBoard } from "../../support/board.js";
import { attack, changePhase, choose, endTurn, type Scenario } from "../../support/dsl.js";
import { currentDomainMultiWasm, currentMultiWasm, describeWithCores, needs } from "../../support/cores.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ELIMINATED_TARGET_SCENARIOS } from "./eliminated-targets.js";
import { Session } from "../../support/session.js";

// Query the real WASM zones. The public view hides eliminated seats, so it cannot prove removal.
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

async function open(scenario: Scenario, emptyDeckSeats: number[] = [], fixture?: string) {
  const compiled = compileBoard(scenario.setup);
  for (const seat of emptyDeckSeats) compiled.options.decks[seat]!.main = [];
  const bytes = readFileSync(scenario.setup.mode === "domain" ? currentDomainMultiWasm() : currentMultiWasm());
  return createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
    startupScripts: [...compiled.options.startupScripts!, ...(fixture ? [{ name: "target-ownership.lua", content: fixture }] : [])],
    multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
}

describeWithCores("eliminated FFA attack and effect targets", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/eliminated-targets", ELIMINATED_TARGET_SCENARIOS, async (scenario) => {
    const game = await open(scenario);
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase();
      session.startRecording();
      for (const [index, step] of scenario.steps.entries()) {
        session.run(step, index + 1);
        const view = game.view(null);
        if (view.result) continue; // The core preserves the final board when it sends WIN.
        for (const seat of view.seats.filter((seat) => seat.eliminated)) {
          expect(captured.lib!.loadScript(captured.handle!, "assert-dead.lua", `assert(not Duel.MPIsAlive(${seat.seat}))`)).toBe(true);
          for (const location of [1, 2, 4, 8, 16, 32, 64, 0x4000]) {
            expect(captured.lib!.duelQueryCount(captured.handle!, seat.seat, location as OcgLocation),
              `real zone ${location} of eliminated seat ${seat.seat}`).toBe(0);
          }
        }
      }
    } finally { game.close(); }
  });

  for (const format of ["ffa3", "ffa4"] as const) {
    for (const mode of ["normal", "domain"] as const) {
      const master = (card: string) => mode === "domain" ? { deckMaster: card } : {};
      it(`${format} ${mode}: removal during a mandatory chain window uses a valid core response`, async () => {
        const scenario: Scenario = { id: "removed-forced-triggers", title: "", source: "ADR-0002", tags: [], steps: [],
          setup: { format, mode, p0: { hand: ["Axe Raider"], ...master("Gemini Elf") }, p1: master("Celtic Guardian"),
            p2: master("Battle Ox"), ...(format === "ffa4" ? { p3: master("Giant Soldier of Stone") } : {}) } };
        const game = await open(scenario, [], `for i=0,1 do
local c=Debug.AddCard(46986414,1,0,LOCATION_MZONE,i,POS_FACEUP_ATTACK,true)
local control=Effect.CreateEffect(c); control:SetType(EFFECT_TYPE_SINGLE); control:SetCode(EFFECT_SET_CONTROL)
control:SetValue(0); control:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); c:RegisterEffect(control)
local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_TRIGGER_F); e:SetRange(LOCATION_MZONE)
e:SetCode(EVENT_SUMMON_SUCCESS)
e:SetOperation(function() end); c:RegisterEffect(e)
end`);
        try {
          for (let step = 0; step < 30; step++) {
            const context = game.view(0).prompt?.context;
            if (context?.type === "chain" && context.forced) break;
            const view = game.view(null);
            const holder = view.seats.find((seat) => game.view(seat.seat).prompt)?.seat;
            expect(holder).toBeDefined();
            const prompt = game.view(holder!).prompt!;
            game.answer(holder!, prompt.id, choosePracticeBotAnswer(prompt, { table: botTableOf(view) }));
          }
          const forced = game.view(0).prompt!;
          expect(forced).not.toBeNull();
          expect(forced.context).toMatchObject({ type: "chain", forced: true });
          expect(forced.options).toHaveLength(2);
          expect(() => game.eliminate(1, 0)).not.toThrow();
          expect(game.view(null).seats[1]!.eliminated).toBe(true);
          expect(game.view(null).seats[0]!.monsters.filter(Boolean).map((card) => card!.code)).toEqual([48305365]);
          expect(game.view(0).prompt?.context?.type).toBe("action");
          expect(game.view(null).chain).toEqual([]);
          expect(game.diagnostics().filter((item) => item.kind === "stderr")).toEqual([]);
        } finally { game.close(); }
      });

      it(`${format} ${mode}: the bot does not select a surrendered monster from a stale prompt`, async () => {
        const scenario: Scenario = { id: "bot-eliminated-monster", title: "", source: "ADR-0002", tags: [], steps: [],
          setup: { format, mode, attackFirstTurn: true, p0: { monsters: ["Mystical Elf"], ...master("Axe Raider") },
            p1: { monsters: ["Kuriboh"], ...master("Celtic Guardian") }, p2: { monsters: ["Kuriboh"], ...master("Battle Ox") },
            ...(format === "ffa4" ? { p3: { monsters: ["Kuriboh"], ...master("Giant Soldier of Stone") } } : {}) } };
        const game = await open(scenario);
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          session.run(changePhase("battle", "p0"), 1);
          session.run(choose("attack:0", "p0"), 2);
          const stale = game.view(0).prompt!;
          expect(stale.kind).toBe("cards");
          expect(stale.options.some((option) => option.controller === 1)).toBe(true);
          game.eliminate(1, 0);
          const answer = choosePracticeBotAnswer(stale, { table: botTableOf(game.view(0)) });
          const chosen = stale.options.filter((option) => answer.selected?.includes(option.id));
          expect(chosen).toHaveLength(1);
          expect(chosen[0]!.controller).toBe(2);
          const live = game.view(0).prompt!;
          if (live.kind === "cards") {
            expect(live.id).toBe(stale.id);
            expect(live.options.every((option) => option.controller !== 1)).toBe(true);
            expect(() => game.answer(0, live.id, { selected: [stale.options.find((option) => option.controller === 1)!.id] })).toThrow("Invalid answer");
            game.answer(0, live.id, answer);
          }
          expect(game.view(0).seats[2]!.graveyard.map((card) => card.code)).toContain(40640057);
          expect(captured.lib!.duelQueryCount(captured.handle!, 1, OcgLocation.MZONE)).toBe(0);
        } finally { game.close(); }
      });

      it(`${format} ${mode}: deck-out removes the seat before the next attack`, async () => {
        const scenario: Scenario = { id: "deck-out-attack", title: "", source: "ADR-0002", tags: [], steps: [],
          setup: { format, mode, skipOpeningDraw: true, attackFirstTurn: true,
            p0: { monsters: ["Mystical Elf"], ...master("Axe Raider") },
            p1: { monsters: ["Kuriboh"], hand: ["Mystical Elf"], ...master("Celtic Guardian") },
            p2: master("Battle Ox"), ...(format === "ffa4" ? { p3: master("Giant Soldier of Stone") } : {}) } };
        const game = await open(scenario, [1]);
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          session.run(endTurn("p0"), 1);
          expect(game.view(null).seats[1]!.eliminated).toBe(true);
          expect(game.view(null).turnSeat).toBe(2);
          expect(captured.lib!.duelQueryCount(captured.handle!, 1, OcgLocation.MZONE)).toBe(0);
          session.run(endTurn("p2"), 2);
          if (format === "ffa4") session.run(endTurn("p3"), 3);
          session.run(changePhase("battle", "p0"), 4);
          session.run(attack("Mystical Elf", "direct", "p0"), 5);
          const pick = game.view(0).prompt!;
          if (format === "ffa4") {
            expect(pick.options.map((option) => option.controller)).toEqual([2, 3]);
            game.answer(0, pick.id, choosePracticeBotAnswer(pick, { table: botTableOf(game.view(0)) }));
          }
          expect(game.view(null).seats[2]!.lp).toBe(7200);
          if (format === "ffa4") game.eliminate(3, 0);
          const beforeWin = game.view(null);
          game.eliminate(2, 0);
          expect(game.view(null).result?.winnerSeat).toBe(0);
          expect(game.view(0).prompt).toBeNull();
          expect(game.view(null).phase).toBe(beforeWin.phase);
          expect(game.view(null).turn).toBe(beforeWin.turn);
        } finally { game.close(); }
      });

      it(`${format} ${mode}: removing every listed monster cancels the target choice and permits a living direct attack`, async () => {
        const scenario: Scenario = { id: "empty-attack-targets", title: "", source: "ADR-0002", tags: [], steps: [],
          setup: { format, mode, attackFirstTurn: true, p0: { monsters: ["Mystical Elf"], ...master("Axe Raider") },
            p1: { monsters: ["Kuriboh", "Kuriboh"], ...master("Celtic Guardian") }, p2: master("Battle Ox"),
            ...(format === "ffa4" ? { p3: master("Giant Soldier of Stone") } : {}) } };
        const game = await open(scenario);
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          session.run(changePhase("battle", "p0"), 1);
          session.run(choose("attack:0", "p0"), 2);
          session.run(choose("no", "p0"), 3);
          expect(game.view(0).prompt?.kind).toBe("cards");
          game.eliminate(1, 0);
          expect(game.view(0).prompt?.options.some((option) => option.id.startsWith("attack:"))).toBe(true);
          session.run(attack("Mystical Elf", "direct", "p0"), 4);
          if (format === "ffa4") {
            const pick = game.view(0).prompt!;
            expect(pick.options.map((option) => option.controller)).toEqual([2, 3]);
            game.answer(0, pick.id, choosePracticeBotAnswer(pick, { table: botTableOf(game.view(0)) }));
          }
          expect(game.view(null).seats[2]!.lp).toBe(7200);
          expect(captured.lib!.duelQueryCount(captured.handle!, 1, OcgLocation.MZONE)).toBe(0);
        } finally { game.close(); }
      });

      it(`${format} ${mode}: a removed monster owned by the leaver is not offered on a living field`, async () => {
        const scenario: Scenario = { id: "removed-owned-target", title: "", source: "ADR-0002", tags: [], steps: [],
          setup: { format, mode, attackFirstTurn: true, p0: { monsters: ["Mystical Elf"], ...master("Axe Raider") },
            p1: { monsters: ["Kuriboh"], ...master("Celtic Guardian") },
            p2: { monsters: [null, "Kuriboh"], ...master("Battle Ox") },
            ...(format === "ffa4" ? { p3: { monsters: ["Kuriboh"], ...master("Giant Soldier of Stone") } } : {}) } };
        const game = await open(scenario, [], `local c=Debug.AddCard(40640057,1,2,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
local e=Effect.CreateEffect(c); e:SetType(EFFECT_TYPE_SINGLE); e:SetCode(EFFECT_SET_CONTROL)
e:SetValue(2); e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE); c:RegisterEffect(e)`);
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          session.run(changePhase("battle", "p0"), 1);
          session.run(choose("attack:0", "p0"), 2);
          const stale = game.view(0).prompt!;
          const removed = stale.options.find((option) => option.controller === 2 && option.sequence === 0)!;
          expect(removed).toBeDefined();
          game.eliminate(1, 0);
          expect(game.view(null).seats[2]!.monsters[0]).toBeNull();
          const live = game.view(0).prompt!;
          expect(live.options.some((option) => option.controller === 2 && option.location === 4 && option.sequence === 0)).toBe(false);
          if (live.kind === "cards") {
            expect(() => game.answer(0, live.id, { selected: [removed.id] })).toThrow("Invalid answer");
            game.answer(0, live.id, choosePracticeBotAnswer(live, { table: botTableOf(game.view(0)) }));
          }
          expect(game.view(null).seats[2]!.monsters[1]).toBeNull();
          expect(game.view(2).seats[2]!.graveyard.map((card) => card.code)).toContain(40640057);
        } finally { game.close(); }
      });
    }
  }
});
