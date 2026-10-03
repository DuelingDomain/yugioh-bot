// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/battle-card-effects.test.ts from origin/main (09b4196a)
// with only the import paths changed. Do not edit it to make the legacy engine pass: the legacy engine must equal main. See legacy-1v1/README.md.
import { describe, expect, it } from "vitest";
import { OcgPosition } from "ocgcore-wasm";
import type { DuelAnswer, DuelEngineView, DuelMode, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";

const ENEMY_CONTROLLER = 98045062;
const CATS_EAR_TRIBE = 95841282;
const GEMINI_ELF = 69140098;
const BECKONED = 58400390;
const AXE_OF_DESPAIR = 40619825;
const INJECTION_FAIRY_LILY = 79575620;
const DD_WARRIOR_LADY = 7572887;

async function openGame(mode: DuelMode, heads: number[][], stopAtEveryWindow = false): Promise<EngineGame> {
  return createEngineGame({
    mode, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
    decks: heads.map(main => ({ main: [...main, ...Array(35).fill(BECKONED)], extra: [], side: [], deckMaster: BECKONED })),
    settings: { visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240, startingLP: 8000,
      startingHand: 5, drawPerTurn: 1, timeout: "loss", validateDeck: false, shuffleDeck: false, stopAtEveryWindow },
  });
}

type Waiting = { seat: number; view: DuelEngineView; prompt: DuelPrompt };
function drive(game: EngineGame, policy: (w: Waiting) => DuelAnswer | "stop" | null): void {
  for (let n = 0; n < 100; n++) {
    const seat = game.view(0).prompt ? 0 : 1;
    const view = game.view(seat), prompt = view.prompt;
    if (!prompt) throw Error("No waiting prompt");
    const answer = policy({ seat, view, prompt });
    if (answer === "stop") return;
    const ids = prompt.options.map(o => o.id);
    game.answer(seat, prompt.id, answer ?? (ids.includes("no") ? { choice: "no" } : ids.includes("to_ep") ? { choice: "to_ep" } : choosePracticeBotAnswer(prompt)));
  }
  throw Error("Scenario did not finish");
}
const option = (w: Waiting, prefix: string, code: number) => w.prompt.options.find(o => o.id.startsWith(prefix) && o.card?.code === code)?.id;

describe.each(["normal", "domain"] as const)("%s battle card effects", mode => {
  it.each([0, 1])("keeps an Enemy Controller defender sideways until seat %s destroys it", async attackerSeat => {
    const defenderSeat = 1 - attackerSeat;
    const game = await openGame(mode, attackerSeat === 0
      ? [[DD_WARRIOR_LADY, ENEMY_CONTROLLER], [BECKONED]]
      : [[BECKONED], [DD_WARRIOR_LADY, ENEMY_CONTROLLER]], true);
    try {
      let activated = false, attacked = false, defendedWindows = 0;
      const attackTurn = attackerSeat === 0 ? 3 : 2;
      drive(game, w => {
        for (const viewer of [0, 1, null]) {
          const view = game.view(viewer);
          if (!view.events.some(e => e.kind === "position" && e.card?.code === BECKONED)) continue;
          const defender = view.seats[defenderSeat].monsters.find(c => c?.code === BECKONED);
          if (defender) {
            expect(defender.position).toBe(OcgPosition.FACEUP_DEFENSE);
            if (attacked) defendedWindows++;
          }
        }
        if (w.view.turn === w.seat + 1) {
          const summon = option(w, "summon:", w.seat === attackerSeat ? DD_WARRIOR_LADY : BECKONED);
          if (summon) return { choice: summon };
        }
        if (w.view.turn === attackTurn && w.seat === attackerSeat) {
          if (!activated) {
            const activation = option(w, "activate:", ENEMY_CONTROLLER);
            if (activation) { activated = true; return { choice: activation }; }
          }
          if (activated && w.prompt.options.some(o => o.id === "opt:0")) return { choice: "opt:0" };
          if (w.prompt.kind === "cards") {
            const target = w.prompt.options.find(o => o.card?.code === BECKONED);
            if (target) return { selected: [target.id] };
          }
          if (w.prompt.options.some(o => o.id === "to_bp")) return { choice: "to_bp" };
          if (!attacked) {
            const attack = option(w, "attack:", DD_WARRIOR_LADY);
            if (attack) { attacked = true; return { choice: attack }; }
          }
          if (attacked && w.prompt.options.some(o => o.id === "to_m2")) return "stop";
        }
        return null;
      });
      expect(activated && attacked).toBe(true);
      expect(defendedWindows).toBeGreaterThan(0);
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.events.find(e => e.kind === "battle")?.battle).toEqual({
          attacker: { attack: 1500, defense: 1600, position: 1 }, target: { attack: 1800, defense: 0, position: 4 } });
        expect(view.events.find(e => e.kind === "move" && e.reason === "destroy")).toMatchObject({
          cause: "battle", card: { code: BECKONED }, fromPosition: 4 });
        expect(view.events.find(e => e.kind === "destroy")).toMatchObject({
          cause: "battle", card: { code: BECKONED }, fromPosition: 4 });
        expect(view.seats[defenderSeat].graveyard.some(c => c.code === BECKONED)).toBe(true);
        expect(view.seats.map(s => s.lp)).toEqual([8000, 8000]);
      }
    } finally { game.close(); }
  });

  it("changes an opposing attacker to defense during the Battle Phase for both seats and spectators", async () => {
    const game = await openGame(mode, [[ENEMY_CONTROLLER], [GEMINI_ELF]]);
    try {
      let set = false, activated = false;
      drive(game, w => {
        if (w.view.turn === 1 && w.seat === 0 && !set) {
          const id = option(w, "sset:", ENEMY_CONTROLLER);
          if (id) { set = true; return { choice: id }; }
        }
        if (w.view.turn === 2 && w.seat === 1) {
          const summon = option(w, "summon:", GEMINI_ELF);
          if (summon) return { choice: summon };
          if (w.prompt.options.some(o => o.id === "to_bp")) return { choice: "to_bp" };
          const attack = w.prompt.options.find(o => o.id.startsWith("attack:"));
          if (attack && !activated) return { choice: attack.id };
          if (activated && w.prompt.options.some(o => o.id === "to_m2")) return "stop";
        }
        if (w.view.battleStep != null && w.seat === 0 && w.view.events.some(e => e.kind === "attack")) {
          const activation = w.prompt.options.find(o => o.card?.code === ENEMY_CONTROLLER);
          if (activation) { activated = true; return { choice: activation.id }; }
          if (w.prompt.options.some(o => o.id === "opt:0")) return { choice: "opt:0" };
        }
        return null;
      });
      expect(activated).toBe(true);
      expect(game.view(null).battleStep).toBe("battle");
      expect(game.view(null).events.some(e => e.kind === "battle")).toBe(false);
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.seats[1].monsters.find(c => c?.code === GEMINI_ELF)?.position).toBe(OcgPosition.FACEUP_DEFENSE);
        expect(view.events).toContainEqual(expect.objectContaining({ kind: "position", card: expect.objectContaining({ code: GEMINI_ELF }), fromPosition: 1, toPosition: 4 }));
        expect(view.seats.map(s => s.lp)).toEqual([8000, 8000]);
      }
    } finally { game.close(); }
  });

  it.each([false, true])("uses 200 original ATK against Cat’s Ear Tribe (ATK boost: %s)", async boosted => {
    const game = await openGame(mode, [[CATS_EAR_TRIBE], [GEMINI_ELF, AXE_OF_DESPAIR]]);
    try {
      let enteredBattle = false, equipped = false;
      drive(game, w => {
        if (w.view.turn === 1 && w.seat === 0) {
          const summon = option(w, "summon:", CATS_EAR_TRIBE);
          if (summon) return { choice: summon };
        }
        if (w.view.turn === 2 && w.seat === 1) {
          const summon = option(w, "summon:", GEMINI_ELF);
          if (summon) return { choice: summon };
          if (boosted && !equipped) {
            const activate = option(w, "activate:", AXE_OF_DESPAIR);
            if (activate) { equipped = true; return { choice: activate }; }
          }
          if (w.prompt.options.some(o => o.id === "to_bp")) { enteredBattle = true; return { choice: "to_bp" }; }
          const attack = w.prompt.options.find(o => o.id.startsWith("attack:"));
          if (attack) return { choice: attack.id };
          if (enteredBattle && w.prompt.options.some(o => o.id === "to_m2")) return "stop";
        }
        return null;
      });
      const view = game.view(null);
      for (const viewer of [0, 1, null]) {
        expect(game.view(viewer).events).toContainEqual(expect.objectContaining({
          kind: "battle", zone: { controller: 1, location: 4, sequence: 0 },
          target: { controller: 0, location: 4, sequence: 0 },
          battle: {
            attacker: { attack: boosted ? 1200 : 200, defense: 900, position: 1 },
            target: { attack: 200, defense: 100, position: 1 },
          },
        }));
      }
      expect(view.seats.map(s => s.lp)).toEqual([boosted ? 7000 : 8000, 8000]);
      expect(view.seats[0].graveyard.some(c => c.code === CATS_EAR_TRIBE)).toBe(true);
      if (!boosted) expect(view.seats[1].graveyard.some(c => c.code === GEMINI_ELF)).toBe(true);
      else expect(view.seats[1].monsters.find(c => c?.code === GEMINI_ELF)?.attack).toBe(2900);
    } finally { game.close(); }
  });

  it("queries temporary ATK during damage-step windows and restores it after the battle", async () => {
    const game = await openGame(mode, [[CATS_EAR_TRIBE], [INJECTION_FAIRY_LILY, AXE_OF_DESPAIR]], true);
    try {
      let enteredBattle = false, equipped = false;
      const damageStepAttacks: number[] = [];
      drive(game, w => {
        if (w.view.battleStep === "damage" || w.view.battleStep === "damage-calculation") {
          const attacker = w.view.seats[1].monsters.find(c => c?.code === INJECTION_FAIRY_LILY);
          if (attacker?.attack != null) damageStepAttacks.push(attacker.attack);
        }
        if (w.view.turn === 1 && w.seat === 0) {
          const summon = option(w, "summon:", CATS_EAR_TRIBE);
          if (summon) return { choice: summon };
        }
        if (w.view.turn === 2 && w.seat === 1) {
          const summon = option(w, "summon:", INJECTION_FAIRY_LILY);
          if (summon) return { choice: summon };
          if (!equipped) {
            const activate = option(w, "activate:", AXE_OF_DESPAIR);
            if (activate) { equipped = true; return { choice: activate }; }
          }
          if (w.prompt.options.some(o => o.id === "to_bp")) { enteredBattle = true; return { choice: "to_bp" }; }
          const attack = w.prompt.options.find(o => o.id.startsWith("attack:"));
          if (attack) return { choice: attack.id };
          if (enteredBattle && w.prompt.options.some(o => o.id === "to_m2")) return "stop";
        }
        return null;
      });
      expect(damageStepAttacks).toContain(1200);
      expect(game.view(null).seats[1].monsters.find(c => c?.code === INJECTION_FAIRY_LILY)?.attack).toBe(1400);
    } finally { game.close(); }
  });

  it("preserves a calculation before an after-calculation effect prompt and ends only after destruction", async () => {
    const game = await openGame(mode, [[CATS_EAR_TRIBE], [DD_WARRIOR_LADY]]);
    try {
      let enteredBattle = false;
      drive(game, w => {
        if (w.view.turn === 1 && w.seat === 0) {
          const summon = option(w, "summon:", CATS_EAR_TRIBE);
          if (summon) return { choice: summon };
        }
        if (w.view.turn === 2 && w.seat === 1) {
          if (w.prompt.options.some(o => o.id === "yes") && w.view.events.some(e => e.kind === "battle")) return "stop";
          const summon = option(w, "summon:", DD_WARRIOR_LADY);
          if (summon) return { choice: summon };
          if (w.prompt.options.some(o => o.id === "to_bp")) { enteredBattle = true; return { choice: "to_bp" }; }
          const attack = w.prompt.options.find(o => o.id.startsWith("attack:"));
          if (attack) return { choice: attack.id };
        }
        return null;
      });
      const before = game.view(1);
      expect(enteredBattle).toBe(true);
      expect(before.events.find(e => e.kind === "battle")?.battle?.attacker.attack).toBe(200);
      expect(before.events.some(e => e.kind === "destroy" || e.kind === "damage" || e.kind === "battle-end")).toBe(false);
      game.answer(1, before.prompt!.id, { choice: "no" });
      const after = game.view(null);
      expect(after.events.filter(e => e.kind === "destroy" && e.cause === "battle")).toHaveLength(2);
      const end = after.events.find(e => e.kind === "battle-end");
      expect(end).toBeDefined();
      expect(after.events.filter(e => e.kind === "destroy").every(e => e.id < end!.id)).toBe(true);
      expect(after.seats.map(s => s.lp)).toEqual([8000, 8000]);
    } finally { game.close(); }
  });

  it("omits the core's zero-location target on direct-attack calculations", async () => {
    const game = await openGame(mode, [[], [GEMINI_ELF]]);
    try {
      let enteredBattle = false;
      drive(game, w => {
        if (w.view.turn === 2 && w.seat === 1) {
          const summon = option(w, "summon:", GEMINI_ELF);
          if (summon) return { choice: summon };
          if (w.prompt.options.some(o => o.id === "to_bp")) { enteredBattle = true; return { choice: "to_bp" }; }
          const attack = w.prompt.options.find(o => o.id.startsWith("attack:"));
          if (attack) return { choice: attack.id };
          if (enteredBattle && w.prompt.options.some(o => o.id === "to_m2")) return "stop";
        }
        return null;
      });
      const view = game.view(null), calculation = view.events.find(e => e.kind === "battle");
      expect(calculation?.battle).toEqual({ attacker: { attack: 1900, defense: 900, position: 1 } });
      expect(calculation?.target).toBeUndefined();
      expect(view.seats.map(s => s.lp)).toEqual([6100, 8000]);
    } finally { game.close(); }
  });

});
