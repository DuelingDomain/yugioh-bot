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
  let attacked = false;
  let attack = 0;
  for (let step = 0; step < 100; step++) {
    const p = prompt(game);
    const dinosaur = game.view(null).seats.flatMap(s => s.monsters).find(c => c?.code === DINO);
    attack = Math.max(attack, dinosaur?.attack ?? 0);
    if (attacked && p.options.some(o => o.id === "to_m2")) return { triggered, attack };
    let answer: DuelAnswer;
    if (p.source?.code === SABER && p.options.some(o => o.id === "yes")) {
      answer = { choice: activate ? "yes" : "no" };
      triggered ||= activate;
    } else if (p.context?.type === "chain") {
      const saber = p.options.find(o => o.card?.code === SABER);
      if (activate && saber) { answer = { choice: saber.id }; triggered = true; }
      else if (p.cancelable) answer = { cancel: true };
      else throw new Error(`Unexpected forced chain: ${JSON.stringify(p)}`);
    } else {
      const option = p.options.find(o => o.id === "to_bp")
        ?? p.options.find(o => o.id.startsWith("attack:"))
        ?? p.options.find(o => o.id === `direct:${targetSeat}`)
        ?? p.options.find(o => o.controller === targetSeat && o.location === 4);
      if (!option) throw new Error(`Unexpected battle prompt: ${JSON.stringify(p)}`);
      if (option.id.startsWith("attack:")) attacked = true;
      answer = { choice: option.id };
    }
    game.answer(p.seat, p.id, answer);
  }
  throw new Error("Battle exceeded step budget");
}

for (const engine of ["legacy", "pinned", "ffa4"] as const) {
  for (const mode of ["normal", "domain"] as const) {
    const format: DuelFormat = engine === "ffa4" ? "ffa4" : "1v1";
    const required = [needs.cards(dataDirectory), needs.scripts(dataDirectory),
      ...(engine === "ffa4" ? [needs.installedMulti(dataDirectory)] : engine === "pinned" ? [needs.standard(dataDirectory)] : []),
      ...(mode === "domain" ? [needs.domain(dataDirectory), needs.domainScript(dataDirectory),
        needs.file("Domain core", `${dataDirectory}/ocgcore.${engine === "legacy" ? "domain.legacy" : engine === "ffa4" ? "multi-domain" : "domain"}.wasm`, "Use a prepared bundle.")] : [])];
    async function start(board: BoardSpec) {
      const setup: BoardSpec = { ...board, format, mode, masterRule: 5, skipOpeningDraw: true, attackFirstTurn: true };
      if (mode === "domain") {
        const ids: DuelistId[] = format === "ffa4" ? ["p0", "p1", "p2", "p3"] : ["p0", "p1"];
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
        playBattle(game, format === "ffa4" ? 2 : 1, false);
        const view = game.view(null);
        expect(view.seats[format === "ffa4" ? 2 : 1]!.lp).toBe(7300);
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
        expect(view.seats[1]!.lp).toBe(7100);
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
        expect(view.seats[0]!.lp).toBe(7100);
        expect(view.seats[1]!.lp).toBe(8000);
        expect(view.seats[1]!.graveyard.some(c => c.code === SABER)).toBe(true);
        expect(view.seats[1]!.monsters[0]?.code).toBe(DINO);
      } finally { game.close(); }
    });
  }
}
