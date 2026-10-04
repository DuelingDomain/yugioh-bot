import { afterEach, expect, it } from "vitest";
import { seatCountFor, type DuelAnswer, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { Session, nseatWasmBinary } from "./support/session.js";
import { activate, changePhase, endTurn, select, yes, type Scenario } from "./support/dsl.js";
import { describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const games: EngineGame[] = [];
afterEach(() => games.splice(0).forEach(game => game.close()));

async function battle(format: DuelFormat, attacker: string, opponents: BoardSpec["p1"][], ownField: BoardSpec["p0"] = {}) {
  const setup: BoardSpec = { format, p0: { monsters: [attacker], ...ownField }, p1: opponents[0],
    ...(format !== "1v1" ? { p2: opponents[1] } : {}), ...(format === "ffa4" ? { p3: opponents[2] } : {}) };
  const options = { ...compileBoard(setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...(format !== "1v1" ? { multiWasmBinary: nseatWasmBinary() } : {}) };
  const game = await createEngineGame(options);
  games.push(game);
  const commands: Array<{ seat: number; promptId: string; revision: number; answer: DuelAnswer }> = [];
  const answer = game.answer.bind(game);
  game.answer = (seat, promptId, response) => {
    const revision = game.view(seat).revision;
    answer(seat, promptId, response);
    commands.push({ seat, promptId, revision, answer: response });
  };
  const scenario: Scenario = { id: "ffa-attack-target-pick", title: "Attack target", source: "owner report", tags: ["multiplayer", "attack"], setup, steps: [] };
  const session = new Session(scenario, game);
  session.reachMainPhase();
  const declineSetupWindows = () => {
    for (let step = 0; step < 20; step++) {
      const prompt = Array.from({ length: seatCountFor(format) }, (_, seat) => game.view(seat).prompt).find(prompt => prompt);
      if (prompt?.context?.type !== "chain") return;
      expect(prompt.context.forced).toBe(false);
      game.answer(prompt.seat, prompt.id, { cancel: true });
    }
    throw new Error("Setup chain windows did not close");
  };
  ["p0", "p1", ...(format !== "1v1" ? ["p2"] : []), ...(format === "ffa4" ? ["p3"] : [])]
    .forEach(seat => { declineSetupWindows(); session.run(endTurn(seat as "p0"), 0); });
  declineSetupWindows();
  session.run(changePhase("battle", "p0"), 0);
  declineSetupWindows();
  const prompt = game.view(0).prompt!;
  game.answer(0, prompt.id, { choice: prompt.options.find(option => option.id.startsWith("attack:"))!.id });
  return { game, options, commands, session };
}

describeWithCores("live FFA combined attack target pick", liveNseat, () => {
  for (const format of ["ffa3", "ffa4"] as const) {
    const count = seatCountFor(format) - 1;
    for (const attacker of ["Jinzo #7", "Drillago"]) {
      it(`${format} ${attacker} offers monsters and every legal direct seat in one pick`, async () => {
        const { game } = await battle(format, attacker, Array.from({ length: count }, () => ({ monsters: ["Battle Ox"] })));
        const prompt = game.view(0).prompt!;
        expect(prompt.title).toBe("Select an attack target");
        expect(prompt.options.some(option => option.id === "yes" || option.id === "no")).toBe(false);
        expect(prompt.options.filter(option => option.location === 4).map(option => option.controller)).toEqual(format === "ffa3" ? [1, 2] : [1, 2, 3]);
        expect(prompt.options.filter(option => /directly$/.test(option.label)).map(option => option.controller)).toEqual(format === "ffa3" ? [1, 2] : [1, 2, 3]);
      });
    }
    it(`${format} Drillago checks each prospective opponent independently`, async () => {
      const { game } = await battle(format, "Drillago", [{ monsters: ["Battle Ox"] }, { monsters: ["Giant Rat"] }, { monsters: ["Battle Ox"] }]);
      const prompt = game.view(0).prompt!;
      expect(prompt.options.filter(option => /directly$/.test(option.label)).map(option => option.controller)).toEqual(format === "ffa3" ? [1] : [1, 3]);
      expect(prompt.options.filter(option => option.location === 4)).toHaveLength(count);
    });
    it(`${format} Drillago includes exactly 1600 ATK but excludes face-down monsters and Spell/Trap fields`, async () => {
      const { game } = await battle(format, "Drillago", [
        { monsters: ["Elemental HERO Sparkman"] },
        { monsters: [{ card: "Battle Ox", pos: "set" }] },
        { monsters: ["Battle Ox"], spells: [{ card: "Polymerization", pos: "set" }] },
      ]);
      const prompt = game.view(0).prompt!;
      expect(prompt.options.filter(option => /directly$/.test(option.label)).map(option => option.controller)).toEqual([1]);
      const hidden = prompt.options.find(option => option.controller === 2)!;
      expect(hidden.card).toBeUndefined();
      expect(hidden.label).not.toContain("Battle Ox");
    });
    it(`${format} a normal attacker offers only the empty opponents for direct attacks`, async () => {
      const { game } = await battle(format, "Battle Ox", [{ monsters: ["Battle Ox"] }, {}, {}]);
      const prompt = game.view(0).prompt!;
      expect(prompt.options.filter(option => /directly$/.test(option.label)).map(option => option.controller)).toEqual(format === "ffa3" ? [2] : [2, 3]);
      expect(prompt.options.filter(option => option.location === 4)).toHaveLength(1);
      game.answer(0, prompt.id, { choice: "direct:2" });
      expect(game.view(0).seats[2].lp).toBe(6300);
      expect(game.view(0).prompt?.options.some(option => option.id === "to_m2")).toBe(true);
    });
    it(`${format} Drillago does not bypass a prospective opponent's Spell/Trap cards`, async () => {
      const { game } = await battle(format, "Drillago", [{ monsters: ["Battle Ox"] },
        { monsters: ["Battle Ox"], spells: [{ card: "Polymerization", pos: "set" }] }, { monsters: ["Battle Ox"] }]);
      expect(game.view(0).prompt!.options.filter(option => /directly$/.test(option.label)).map(option => option.controller)).toEqual(format === "ffa3" ? [1] : [1, 3]);
    });
    it(`${format} Drillago excludes illegal direct seats when no monster can be targeted`, async () => {
      const { game } = await battle(format, "Drillago", [
        { monsters: ["Marauding Captain", "Marauding Captain"] },
        { monsters: ["Command Knight", "Command Knight"] },
        { monsters: ["Marauding Captain", "Marauding Captain"] },
      ]);
      const prompt = game.view(0).prompt!;
      expect(prompt.options.map(option => option.controller)).toEqual([2]);
      game.answer(0, prompt.id, { choice: prompt.options[0]!.id });
      expect(game.view(0).seats.map(seat => seat.lp)).toEqual(Array.from({ length: count + 1 }, (_, seat) => seat === 2 ? 6400 : 8000));
    });
    for (const direct of [true, false]) {
      it(`${format} Patrician's controller chooses a ${direct ? "direct" : "monster"} target in one pick`, async () => {
        const { game } = await battle(format, "Jinzo #7", [
          { monsters: ["Patrician of Darkness"] }, { monsters: ["Battle Ox"] }, { monsters: ["Battle Ox"] },
        ]);
        const prompt = game.view(1).prompt!;
        expect(prompt.title).toBe("Select an attack target");
        const target = prompt.options.find(option => option.controller === 2 && (direct ? option.location == null : option.location === 4))!;
        game.answer(1, prompt.id, { choice: target.id });
        expect(game.view(0).seats.map(seat => seat.lp)).toEqual(Array.from({ length: count + 1 }, (_, seat) => seat === (direct ? 2 : 0) ? (direct ? 7500 : 6800) : 8000));
        expect(game.view(0).prompt?.options.some(option => option.id === "to_m2")).toBe(true);
      });
    }
    it(`${format} negated Drillago has only normal monster targets`, async () => {
      const { game } = await battle(format, "Drillago", Array.from({ length: count }, () => ({ monsters: ["Battle Ox"] })), { spells: ["Skill Drain"] });
      expect(game.view(0).prompt!.options.filter(option => /directly$/.test(option.label))).toEqual([]);
    });
    it(`${format} Drillago rechecks the attacked opponent when its monster becomes face-down`, async () => {
      const { game, session } = await battle(format, "Drillago", [{ monsters: ["Battle Ox"] },
        { monsters: ["Battle Ox"], spells: [{ card: "Book of Moon", pos: "set" }] }, { monsters: ["Battle Ox"] }]);
      let prompt = game.view(0).prompt!;
      game.answer(0, prompt.id, { choice: "direct:1" });
      session.run(activate("Book of Moon", "p2"), 0);
      session.run(select({ card: "Battle Ox", owner: "p1" }), 0);
      session.run(yes("p0"), 0);
      prompt = game.view(0).prompt!;
      expect(prompt.title).toBe("Select an attack target");
      expect(prompt.options.some(option => option.id === "direct:1")).toBe(false);
      expect(prompt.options.some(option => option.id === "direct:2")).toBe(true);
      expect(game.view(0).seats[1].lp).toBe(8000);
    });
    for (const seat of Array.from({ length: count }, (_, index) => index + 1)) {
      it(`${format} Jinzo #7 can choose direct seat ${seat} without another pick`, async () => {
        const { game } = await battle(format, "Jinzo #7", Array.from({ length: count }, () => ({ monsters: ["Battle Ox"] })));
        const prompt = game.view(0).prompt!;
        game.answer(0, prompt.id, { choice: `direct:${seat}` });
        expect(game.view(0).seats.map(view => view.lp)).toEqual(Array.from({ length: count + 1 }, (_, index) => index === seat ? 7500 : 8000));
        expect(game.view(0).prompt?.options.some(option => option.id === "to_m2")).toBe(true);
      });
    }
    it(`${format} rejects stale, wrong-seat and unoffered targets without advancing`, async () => {
      const { game } = await battle(format, "Drillago", [{ monsters: ["Battle Ox"] }, { monsters: ["Giant Rat"] }, { monsters: ["Battle Ox"] }]);
      const prompt = game.view(0).prompt!;
      const before = game.view(0);
      expect(() => game.answer(1, prompt.id, { choice: "direct:1" })).toThrow("Wrong seat");
      expect(() => game.answer(0, "stale", { choice: "direct:1" })).toThrow("Stale prompt");
      for (const answer of [{ choice: "direct:2" }, { choice: "yes" }, { selected: ["card:0", "card:1"] }]) {
        expect(() => game.answer(0, prompt.id, answer)).toThrow("Invalid answer");
        expect(game.view(0)).toEqual(before);
      }
    });
    it(`${format} uses the validated selection when both answer fields are supplied`, async () => {
      const { game } = await battle(format, "Jinzo #7", Array.from({ length: count }, () => ({ monsters: ["Battle Ox"] })));
      const prompt = game.view(0).prompt!;
      const monster = prompt.options.find(option => option.controller === 1 && option.location === 4)!;
      game.answer(0, prompt.id, { selected: [monster.id], choice: "direct:1" });
      expect(game.view(0).seats[0].lp).toBe(6800);
      expect(game.view(0).seats[1].lp).toBe(8000);
      expect(game.view(0).prompt?.options.some(option => option.id === "to_m2")).toBe(true);
    });
    it(`${format} removes a surrendered seat from the suspended combined pick`, async () => {
      const { game } = await battle(format, "Jinzo #7", Array.from({ length: count }, () => ({ monsters: ["Battle Ox"] })));
      game.eliminate(1, 0);
      const prompt = game.view(0).prompt!;
      expect(prompt.options.some(option => option.controller === 1)).toBe(false);
      game.answer(0, prompt.id, { choice: "direct:2" });
      expect(game.view(0).seats[2].lp).toBe(7500);
    });
    it(`${format} can cancel a target pick without spending the attack`, async () => {
      const { game } = await battle(format, "Battle Ox", [{ monsters: ["Battle Ox"] }, {}, {}]);
      let prompt = game.view(0).prompt!;
      expect(prompt.cancelable).toBe(true);
      game.answer(0, prompt.id, { cancel: true });
      prompt = game.view(0).prompt!;
      expect(prompt.options.some(option => option.id.startsWith("attack:"))).toBe(true);
      expect(game.view(0).seats.map(seat => seat.lp)).toEqual(Array(count + 1).fill(8000));
    });
    for (const target of ["direct", "monster"] as const) {
      it(`${format} journals and replays one ${target} choice`, async () => {
        const { game, options, commands } = await battle(format, "Drillago", [{ monsters: ["Battle Ox"] }, { monsters: ["Giant Rat"] }, { monsters: ["Battle Ox"] }]);
        const prompt = game.view(0).prompt!;
        const option = prompt.options.find(option => target === "direct" ? option.controller === 1 && option.location == null : option.controller === 2 && option.location === 4);
        expect(option).toBeDefined();
        const before = commands.length;
        game.answer(0, prompt.id, { choice: option!.id });
        expect(commands).toHaveLength(before + 1);
        expect(game.view(0).prompt?.options.some(option => option.id === "to_m2")).toBe(true);
        expect(game.view(0).seats.map(seat => seat.lp)).toEqual(target === "direct"
          ? (format === "ffa3" ? [8000, 6400, 8000] : [8000, 6400, 8000, 8000])
          : (format === "ffa3" ? [8000, 8000, 7800] : [8000, 8000, 7800, 8000]));
        const replay = await createEngineGame(options);
        games.push(replay);
        for (const command of commands) {
          expect(replay.view(command.seat).revision).toBe(command.revision);
          expect(replay.view(command.seat).prompt?.id).toBe(command.promptId);
          replay.answer(command.seat, command.promptId, command.answer);
        }
        for (const seat of [null, ...Array.from({ length: count + 1 }, (_, seat) => seat)]) {
          expect(replay.view(seat)).toEqual(game.view(seat));
        }
      });
    }
  }
});

describeWithCores("1v1 attack prompt control", needs.standard(), () => {
  it("keeps Drillago's original yes/no and direct attack behavior", async () => {
    const { game } = await battle("1v1", "Drillago", [{ monsters: ["Battle Ox"] }]);
    const prompt = game.view(0).prompt!;
    expect(prompt.options.map(option => option.id)).toEqual(["yes", "no"]);
    game.answer(0, prompt.id, { choice: "yes" });
    expect(game.view(0).seats.map(seat => seat.lp)).toEqual([8000, 6400]);
  });
});
