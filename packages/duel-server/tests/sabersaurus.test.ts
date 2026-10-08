import { afterEach, expect, vi } from "vitest";
import type { DuelAnswer, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { compileBoard, type BoardSpec, type DuelistId } from "../src/presets/board.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";

// Legacy has no startup-script API. Inject only the scenario board immediately
// before the real core starts; its script reader, callbacks and host remain real.
const boot = vi.hoisted(() => ({ scripts: [] as { name: string; content: string }[] }));
vi.mock("ocgcore-wasm", async (original) => {
  const actual = await original<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (...args: Parameters<typeof actual.default>) => {
    const lib = await actual.default(...args);
    const start = lib.startDuel.bind(lib);
    lib.startDuel = ((handle: Parameters<typeof start>[0]) => {
      for (const script of boot.scripts) {
        if (!lib.loadScript(handle, script.name, script.content)) throw new Error("Legacy board setup failed");
      }
      return start(handle);
    }) as typeof lib.startDuel;
    return lib;
  } };
});
afterEach(() => { boot.scripts = []; });

const SABER = 3743515;
const DINO = 37265642; // Sabersaurus: 1900 ATK, no effects.
const DIRECT = 77084837; // Inaba White Rabbit: can attack directly past Sabersaurus.

function prompt(game: EngineGame): DuelPrompt {
  for (let seat = 0; seat < game.view(null).seats.length; seat++) {
    const found = game.view(seat).prompt;
    if (found) return found;
  }
  throw new Error("Expected a live prompt");
}

function playBattle(game: EngineGame, targetSeat: number, activate: boolean) {
  let triggered = false;
  let offered = false;
  let attacked = false;
  let attack = 0;
  for (let step = 0; step < 100; step++) {
    const p = prompt(game);
    const dinosaur = game.view(null).seats.flatMap(s => s.monsters).find(c => c?.code === DINO);
    attack = Math.max(attack, dinosaur?.attack ?? 0);
    if (attacked && p.options.some(o => o.id === "to_m2")) return { triggered, offered, attack };
    let answer: DuelAnswer;
    if (p.source?.code === SABER && p.options.some(o => o.id === "yes")) {
      offered = true;
      answer = { choice: activate ? "yes" : "no" };
      triggered ||= activate;
    } else if (p.context?.type === "chain") {
      const saber = p.options.find(o => o.card?.code === SABER);
      offered ||= saber !== undefined;
      if (activate && saber) { answer = { choice: saber.id }; triggered = true; }
      else if (p.cancelable) answer = { cancel: true };
      else throw new Error(`Unexpected forced chain: ${JSON.stringify(p)}`);
    } else {
      const option = p.options.find(o => o.id === "to_bp")
        ?? p.options.find(o => o.id.startsWith("attack:"))
        ?? p.options.find(o => o.id === `direct:${targetSeat}`)
        ?? p.options.find(o => o.controller === targetSeat && /directly/i.test(o.label))
        ?? p.options.find(o => o.controller === targetSeat && o.location === 4);
      if (!option) throw new Error(`Unexpected battle prompt: ${JSON.stringify(p)}`);
      if (option.id.startsWith("attack:")) attacked = true;
      answer = { choice: option.id };
    }
    game.answer(p.seat, p.id, answer);
  }
  throw new Error("Battle exceeded step budget");
}

for (const engine of ["legacy", "pinned", "ffa4", "tag"] as const) {
  for (const mode of ["normal", "domain"] as const) {
    const format: DuelFormat = engine === "tag" ? "tag" : engine === "ffa4" ? "ffa4" : "1v1";
    const multi = format !== "1v1";
    const startingLP = format === "tag" ? 16000 : 8000;
    const required = [needs.cards(dataDirectory), needs.scripts(dataDirectory),
      ...(multi ? [needs.installedMulti(dataDirectory)] : engine === "pinned" ? [needs.standard(dataDirectory)] : []),
      ...(mode === "domain" ? [needs.domain(dataDirectory), needs.domainScript(dataDirectory),
        needs.file("Domain core", `${dataDirectory}/ocgcore.${engine === "legacy" ? "domain.legacy" : multi ? "multi-domain" : "domain"}.wasm`, "Use a prepared bundle.")] : [])];
    async function start(board: BoardSpec) {
      const setup: BoardSpec = { ...board, format, mode, masterRule: 5, skipOpeningDraw: true, attackFirstTurn: true };
      if (mode === "domain") {
        const ids: DuelistId[] = multi ? ["p0", "p1", "p2", "p3"] : ["p0", "p1"];
        for (const id of ids) {
          setup[id] = { ...setup[id], deckMaster: 89631139 };
        }
      }
      const compiled = compileBoard(setup, dataDirectory);
      const options = { ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory };
      if (engine === "legacy") {
        boot.scripts = options.startupScripts ?? [];
        return createLegacyEngineGame({ ...options, startupScripts: undefined });
      }
      return createEngineGame(options);
    }

    itWithCores(`${engine}/${mode}: opponent direct attack with Sabersaurus in play continues`, required, async () => {
      const game = await start({ p0: { monsters: [DIRECT] }, p1: { monsters: [SABER] } });
      try {
        const result = playBattle(game, format === "ffa4" ? 2 : 1, true);
        expect(result.offered).toBe(false);
        expect(result.triggered).toBe(false);
        const view = game.view(null);
        expect(view.seats[format === "ffa4" ? 2 : 1]!.lp).toBe(startingLP - 700);
        expect(view.seats[1]!.monsters[0]?.code).toBe(SABER);
        expect(view.result).toBeNull();
      } finally { game.close(); }
    });

    itWithCores(`${engine}/${mode}: own battling Dinosaur gains 2000 ATK and Sabersaurus is destroyed`, required, async () => {
      const game = await start({ p0: { monsters: [DINO, SABER] }, p1: { monsters: [89631139] } });
      try {
        const result = playBattle(game, 1, true);
        expect(result.triggered).toBe(true);
        expect(result.attack).toBe(3900);
        const view = game.view(null);
        expect(view.seats[1]!.lp).toBe(startingLP - 900);
        expect(view.seats[1]!.graveyard.some(c => c.code === 89631139)).toBe(true);
        expect(view.seats[0]!.graveyard.some(c => c.code === SABER)).toBe(true);
        expect(view.seats[0]!.monsters[1]).toBeNull();
        expect(view.result).toBeNull();
        const p = prompt(game);
        game.answer(p.seat, p.id, { choice: "to_m2" });
        expect(game.view(null).seats[0]!.monsters[0]?.attack).toBe(1900);
      } finally { game.close(); }
    });

    itWithCores(`${engine}/${mode}: own defending Dinosaur receives the boost`, required, async () => {
      const game = await start({ p0: { monsters: [89631139] }, p1: { monsters: [DINO, SABER] } });
      try {
        const result = playBattle(game, 1, true);
        expect(result.triggered).toBe(true);
        expect(result.attack).toBe(3900);
        const view = game.view(null);
        expect(view.seats[0]!.lp).toBe(startingLP - 900);
        expect(view.seats[1]!.lp).toBe(startingLP);
        expect(view.seats[1]!.graveyard.some(c => c.code === SABER)).toBe(true);
        expect(view.seats[1]!.monsters[0]?.code).toBe(DINO);
      } finally { game.close(); }
    });

    itWithCores(`${engine}/${mode}: Sabersaurus attacking does not offer its own boost`, required, async () => {
      const game = await start({ p0: { monsters: [SABER] }, p1: { monsters: [DINO] } });
      try {
        const result = playBattle(game, 1, true);
        expect(result.offered).toBe(false);
        expect(result.triggered).toBe(false);
        const view = game.view(null);
        expect(view.seats[0]!.monsters[0]?.code).toBe(SABER);
        expect(view.seats[0]!.monsters[0]?.attack).toBe(2000);
        expect(view.seats[0]!.graveyard.some(c => c.code === SABER)).toBe(false);
        expect(view.seats[1]!.lp).toBe(startingLP - 100);
        expect(view.seats[1]!.graveyard.some(c => c.code === DINO)).toBe(true);
        expect(view.result).toBeNull();
      } finally { game.close(); }
    });

    if (engine === "tag") {
      for (const guard of [1, 3] as const) {
        itWithCores(`${engine}/${mode}: Sabersaurus at seat ${guard} blocks ordinary direct attacks at its empty partner`, required, async () => {
          const game = await start({ p0: { monsters: [DINO] }, [`p${guard}`]: { monsters: [SABER] } });
          try {
            const main = prompt(game);
            game.answer(main.seat, main.id, { choice: "to_bp" });
            const battle = prompt(game);
            expect(battle.options.filter(o => o.id.startsWith("attack:"))).toHaveLength(1);
            expect(battle.options.find(o => o.id.startsWith("attack:"))?.label).not.toMatch(/directly/i);
            // Attack the guard to prove that the partner's empty field is not a direct target.
            const result = playBattle(game, guard, true);
            expect(result.offered).toBe(false);
            expect(result.triggered).toBe(false);
            const view = game.view(null);
            expect(view.seats.map(s => s.lp)).toEqual([15900, 16000, 15900, 16000]);
            expect(view.seats[guard]!.monsters[0]?.code).toBe(SABER);
            expect(view.seats[0]!.graveyard.some(c => c.code === DINO)).toBe(true);
            expect(view.result).toBeNull();
          } finally { game.close(); }
        });
      }

      itWithCores(`${engine}/${mode}: card-granted direct attack at the empty partner of Sabersaurus continues without its boost`, required, async () => {
        const game = await start({ p0: { monsters: [DIRECT] }, p1: { monsters: [SABER] } });
        try {
          const result = playBattle(game, 3, true);
          expect(result.offered).toBe(false);
          expect(result.triggered).toBe(false);
          const view = game.view(null);
          expect(view.seats.map(s => s.lp)).toEqual([16000, 15300, 16000, 15300]);
          expect(view.seats[1]!.monsters[0]?.code).toBe(SABER);
          expect(view.result).toBeNull();
        } finally { game.close(); }
      });

      for (const defender of [1, 3] as const) {
        itWithCores(`${engine}/${mode}: both opponents empty lets an ordinary Dinosaur attack seat ${defender} with Sabersaurus's boost`, required, async () => {
          const game = await start({ p0: { monsters: [DINO, SABER] } });
          try {
            const result = playBattle(game, defender, true);
            expect(result.triggered).toBe(true);
            expect(result.attack).toBe(3900);
            const view = game.view(null);
            expect(view.seats.map(s => s.lp)).toEqual([16000, 12100, 16000, 12100]);
            expect(view.seats[0]!.graveyard.some(c => c.code === SABER)).toBe(true);
            expect(view.seats[0]!.monsters[0]?.code).toBe(DINO);
            expect(view.result).toBeNull();
            const p = prompt(game);
            game.answer(p.seat, p.id, { choice: "to_m2" });
            expect(game.view(null).seats[0]!.monsters[0]?.attack).toBe(1900);
          } finally { game.close(); }
        });
      }
    }

    if (engine === "ffa4") {
      itWithCores(`${engine}/${mode}: direct attack at the Sabersaurus seat continues without offering the boost`, required, async () => {
        const game = await start({ p0: { monsters: [DIRECT] }, p1: { monsters: [SABER] } });
        try {
          const result = playBattle(game, 1, true);
          expect(result.offered).toBe(false);
          expect(result.triggered).toBe(false);
          const view = game.view(null);
          expect(view.seats.map(s => s.lp)).toEqual([8000, 7300, 8000, 8000]);
          expect(view.seats[1]!.monsters[0]?.code).toBe(SABER);
          expect(view.result).toBeNull();
        } finally { game.close(); }
      });

      itWithCores(`${engine}/${mode}: battle between two other seats does not offer Sabersaurus's boost`, required, async () => {
        const game = await start({ p0: { monsters: [89631139] }, p1: { monsters: [SABER] }, p2: { monsters: [DINO] } });
        try {
          const result = playBattle(game, 2, true);
          expect(result.offered).toBe(false);
          expect(result.triggered).toBe(false);
          expect(result.attack).toBe(1900);
          const view = game.view(null);
          expect(view.seats.map(s => s.lp)).toEqual([8000, 8000, 6900, 8000]);
          expect(view.seats[0]!.monsters[0]?.code).toBe(89631139);
          expect(view.seats[1]!.monsters[0]?.code).toBe(SABER);
          expect(view.seats[1]!.graveyard.some(c => c.code === SABER)).toBe(false);
          expect(view.seats[2]!.graveyard.some(c => c.code === DINO)).toBe(true);
          expect(view.result).toBeNull();
        } finally { game.close(); }
      });
    }
  }
}
