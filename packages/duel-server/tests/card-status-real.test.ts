import assert from "node:assert/strict";
import { expect, it } from "vitest";
import type { DuelFormat } from "@yugidraft/shared/duels";
import { getDuelCounterMetadata } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { activate, defineScenario, expectBoard, normalSummon, select, zone, type Step } from "./support/dsl.js";
import { Session } from "./support/session.js";
import { describeWithCores, needs } from "./support/cores.js";

const DRACO = 57761191;
const BREAKER = 71413901;
const variants = [
  { name: "legacy", format: "1v1", legacy: true },
  { name: "pinned", format: "1v1", legacy: false },
  { name: "ffa3", format: "ffa3", legacy: false },
  { name: "ffa4", format: "ffa4", legacy: false },
  { name: "tag", format: "tag", legacy: false },
] as const;

async function open(board: BoardSpec, format: DuelFormat, legacy: boolean) {
  const scenario = defineScenario({ id: "card-status", title: "Live card status", source: "Approved status design",
    tags: ["status"], setup: { ...board, format, skipOpeningDraw: true }, steps: [] });
  const game: EngineGame = await (legacy ? createLegacyEngineGame : createEngineGame)({
    ...compileBoard(scenario.setup, engineDataDirectory).options, dataDirectory: engineDataDirectory,
    seed: ["1", "2", "3", "4"],
  });
  const session = new Session(scenario, game);
  session.reachMainPhase();
  let index = 0;
  return { game, run: (...steps: Step[]) => steps.forEach(step => session.run(step, ++index)) };
}

for (const { name, format, legacy } of variants) {
  describeWithCores(`card statuses (${name})`, [needs.cards(), needs.scripts(),
    ...(format === "1v1" ? [needs.standard()] : [needs.installedMulti()])], () => {
    it("publishes Tribute Summon hints, clears them on destruction, and reconstructs them deterministically", async () => {
      const snapshots: unknown[] = [];
      for (let replay = 0; replay < 2; replay++) {
        const { game, run } = await open({ p0: { hand: [DRACO, "Dark Hole"],
          monsters: ["Mystical Elf", "Blue-Eyes White Dragon", "Dark Magician"] }, p1: {} }, format, legacy);
        try {
          run(normalSummon(DRACO), select("Mystical Elf", "Blue-Eyes White Dragon", "Dark Magician"), zone("p0", "m0"), expectBoard({}));
          const card = game.view(null).seats[0].monsters[0];
          expect(card).toMatchObject({ code: DRACO, baseAttack: 3000, baseDefense: 3000,
            hints: [{ descriptionId: String(BigInt(DRACO) * 1048576n + 2n),
              text: "Unaffected by Monsters effects", categories: ["unaffected-monsters"] }] });
          snapshots.push(card?.hints);
          for (const viewer of [0, 1, null]) expect(game.view(viewer).seats[0].monsters[0]?.hints).toEqual(card?.hints);
          run(activate("Dark Hole"), expectBoard({ p0: { monsters: [] } }));
          const destroyed = game.view(null).seats[0].graveyard.find(c => c.code === DRACO);
          assert(destroyed);
          expect(destroyed.hints).toBeUndefined();
          expect(() => JSON.stringify(game.view(null))).not.toThrow();
        } finally { game.close(); }
      }
      expect(snapshots[1]).toEqual(snapshots[0]);
    });

    it("only publishes queried base stats in monster zones", async () => {
      const { game } = await open({ p0: { hand: [BREAKER], monsters: ["Dark Magician"],
        spells: ["Supply Squad"], grave: ["Blue-Eyes White Dragon"], banished: [BREAKER],
        extra: ["Stardust Dragon"] }, p1: {} }, format, legacy);
      try {
        const seat = game.view(0).seats[0];
        expect(seat.monsters[0]).toMatchObject({ baseAttack: 2500, baseDefense: 2100 });
        for (const card of [...seat.hand, ...seat.spells, ...seat.graveyard, ...seat.banished, ...seat.extra]) {
          if (!card) continue;
          expect(card.baseAttack).toBeUndefined();
          expect(card.baseDefense).toBeUndefined();
        }
      } finally { game.close(); }
    });

    it("shows typed Spell Counters and queried base ATK/DEF on Breaker", async () => {
      const { game, run } = await open({ p0: { hand: [BREAKER] }, p1: {} }, format, legacy);
      try {
        run(normalSummon(BREAKER), zone("p0", "m0"), expectBoard({}));
        for (const viewer of [0, 1, null]) expect(game.view(viewer).seats[0].monsters[0]).toMatchObject({
          code: BREAKER, attack: 1900, defense: 1000, baseAttack: 1600, baseDefense: 1000,
          counters: [{ type: 1, count: 1 }],
        });
        const counter = game.view(null).seats[0].monsters[0]!.counters![0]!;
        expect(getDuelCounterMetadata(counter.type)).toEqual({ key: "spell", name: "Spell Counter", family: "arcane", glyph: "spell" });
      } finally { game.close(); }
    });

    it("resolves the separate Monster, Spell and Trap Tribute protections", async () => {
      const { game, run } = await open({ p0: { hand: [DRACO], monsters: ["Mystical Elf"],
        spells: ["Supply Squad", "Call of the Haunted"] }, p1: {} }, format, legacy);
      try {
        run(normalSummon(DRACO), select("Mystical Elf", "Supply Squad", "Call of the Haunted"), zone("p0", "m0"), expectBoard({}));
        expect(game.view(null).seats[0].monsters[0]?.hints).toMatchObject([
          { categories: ["unaffected-monsters"], text: "Unaffected by Monsters effects" },
          { categories: ["unaffected-spells"], text: "Unaffected by Spells effects" },
          { categories: ["unaffected-traps"], text: "Unaffected by Traps effects" },
        ]);
      } finally { game.close(); }
    });

    it("shows continuous negation publicly and omits it on hidden cards", async () => {
      const { game, run } = await open({ p0: { hand: ["Pot of Greed"], monsters: ["Toy Soldier"],
        spells: ["Skill Drain"] }, p1: { monsters: [{card: "Breaker the Magical Warrior", pos: "set"}] } }, format, legacy);
      try {
        run(activate("Pot of Greed"), expectBoard({}));
        for (const viewer of [0, 1, null]) expect(game.view(viewer).seats[0].monsters[0]?.negated).toBe(true);
        expect(game.view(null).seats[1].monsters[0]?.negated).toBeUndefined();
        expect(game.view(null).seats[1].monsters[0]?.baseAttack).toBeUndefined();
      } finally { game.close(); }
    });
  });
}
