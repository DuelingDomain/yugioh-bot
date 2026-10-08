import { afterEach, expect, it, vi } from "vitest";
import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { compileBoard, type BoardSpec, type DuelistId } from "./support/board.js";
import { Session, nseatWasmBinary } from "./support/session.js";
import { changePhase, endTurn, type Scenario } from "./support/dsl.js";
import { describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const probe = vi.hoisted(() => ({ failure: null as "load" | "lua" | "logged" | "throw" | null }));
// Keep the real core; fail only one optional display probe.
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default({ ...options, sync: true });
    const loadScript = core.loadScript;
    core.loadScript = (handle, name, content) => {
      if (name === "attack-target-query.lua" && probe.failure) {
        const failure = probe.failure;
        probe.failure = null;
        if (failure === "throw") throw new Error("private-probe-error");
        if (failure === "lua" || failure === "logged") {
          const loaded = loadScript(handle, name, 'error("private-probe-error")');
          // Native condition callbacks can report an error without failing the chunk load.
          return failure === "logged" || loaded;
        }
        return false;
      }
      return loadScript(handle, name, content);
    };
    return core;
  } };
});

const games: EngineGame[] = [];
afterEach(() => {
  games.splice(0).forEach(game => game.close());
  probe.failure = null;
});

async function battle(setup: BoardSpec, startupScript?: string, seat = 0) {
  setup = { attackFirstTurn: true, ...setup };
  const compiled = compileBoard(setup);
  const game = await createEngineGame({
    ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    startupScripts: [...compiled.options.startupScripts!, ...(startupScript ? [{ name: "attack-target-fixture.lua", content: startupScript }] : [])],
    ...(setup.format && setup.format !== "1v1" ? { multiWasmBinary: nseatWasmBinary() } : {}),
  });
  games.push(game);
  const scenario: Scenario = { id: "battle-command-attack-targets", title: "Legal pre-aim targets", source: "owner regression",
    tags: ["battle"], setup, steps: [] };
  const session = new Session(scenario, game);
  session.reachMainPhase();
  for (let turn = 0; turn < 4 && game.view(0).turnSeat !== seat; turn++) {
    session.run(endTurn(`p${game.view(0).turnSeat}` as DuelistId), 0);
    session.reachMainPhase();
  }
  expect(game.view(0).turnSeat).toBe(seat);
  session.run(changePhase("battle", `p${seat}` as DuelistId), 0);
  return { game, session };
}

function attacker(game: EngineGame, sequence = 0, seat = 0): DuelPromptOption {
  const prompt = game.view(seat).prompt!;
  expect(prompt.context).toEqual({ type: "action", phase: "battle" });
  const option = prompt.options.find(option => option.id.startsWith("attack:") && option.sequence === sequence);
  expect(option).toBeDefined();
  return option!;
}

const monster = (controller: number, sequence = 0) => ({ controller, location: 4, sequence });

function declare(game: EngineGame, option: DuelPromptOption, seat = 0) {
  game.answer(seat, game.view(seat).prompt!.id, { choice: option.id });
}

describeWithCores("live battle command attack targets", liveNseat, () => {
  it.each(["load", "lua", "logged", "throw"] as const)("continues the duel when one battle probe fails (%s)", async (failure) => {
    probe.failure = failure;
    const { game } = await battle({ format: "ffa3", p0: { monsters: ["Jinzo #7", "Battle Ox"] },
      p1: { monsters: ["Silver Fang"] }, p2: { monsters: ["Battle Ox"] } });
    expect(attacker(game).attackTargets).toBeNull();
    expect(attacker(game).attackerChoosesTarget).toBeUndefined();
    expect(attacker(game, 1).attackTargets).toEqual({ monsters: [monster(1), monster(2)], direct: [] });
    expect(game.diagnostics()).toContainEqual(expect.objectContaining({ kind: "attack-target-query", seat: 0,
      detail: "Failed to query battle attack targets" }));
    expect(JSON.stringify(game.view(0))).not.toMatch(/private-probe-error|Failed to query|script-error/);
    expect(JSON.stringify(game.diagnostics())).not.toContain("private-probe-error");
    declare(game, attacker(game));
    game.answer(0, game.view(0).prompt!.id, { choice: "direct:2" });
    expect(game.view(0).seats[2].lp).toBe(7500);
    expect(attacker(game, 1).attackTargets).toEqual({ monsters: [monster(1), monster(2)], direct: [] });
  });

  it.each(["load", "lua", "logged", "throw"] as const)("keeps surrender and the battle prompt usable when a refresh probe fails (%s)", async (failure) => {
    const { game } = await battle({ format: "ffa3", p0: { monsters: ["Jinzo #7"] },
      p1: { monsters: ["Silver Fang"] }, p2: { monsters: ["Battle Ox"] } });
    expect(attacker(game).attackerChoosesTarget).toBe(true);
    const revision = game.view(0).revision;
    probe.failure = failure;
    expect(() => game.eliminate(2, 0)).not.toThrow();
    expect(game.view(0).revision).toBe(revision + 1);
    expect(game.view(0).seats[2].eliminated).toBe(true);
    expect(attacker(game).attackTargets).toBeNull();
    expect(attacker(game).attackerChoosesTarget).toBeUndefined();
    declare(game, attacker(game));
    game.answer(0, game.view(0).prompt!.id, { choice: "direct:1" });
    expect(game.view(0).seats[1].lp).toBe(7500);
  });

  it("still fails a required FFA declaration query", async () => {
    const { game } = await battle({ format: "ffa3", p0: { monsters: ["Jinzo #7"] },
      p1: { monsters: ["Silver Fang"] }, p2: { monsters: ["Battle Ox"] } });
    probe.failure = "load";
    expect(() => declare(game, attacker(game))).toThrow("Failed to query attack targets");
  });

  it("FFA4 seat 2 lists and attacks real rival seats", async () => {
    const { game } = await battle({ format: "ffa4", p0: { monsters: ["Battle Ox"] },
      p1: { monsters: ["Silver Fang"] }, p2: { monsters: ["Jinzo #7", "Battle Ox"] },
      p3: { monsters: ["Battle Ox"] } }, undefined, 2);
    expect(attacker(game, 0, 2).attackTargets).toEqual({ monsters: [monster(0), monster(1), monster(3)], direct: [0, 1, 3] });
    expect(attacker(game, 1, 2).attackTargets).toEqual({ monsters: [monster(0), monster(1), monster(3)], direct: [] });
    declare(game, attacker(game, 0, 2), 2);
    game.answer(2, game.view(2).prompt!.id, { choice: "direct:3" });
    expect(game.view(2).seats[3].lp).toBe(7500);
    expect(game.view(2).prompt?.context).toEqual({ type: "action", phase: "battle" });
  });

  it("Tag seat 3 lists its facing rival and opposing EMZ with real direct seats", async () => {
    const { game } = await battle({ format: "tag", p0: { monsters: [null, null, null, null, null, "Link Spider"] },
      p1: { monsters: ["Blue-Eyes White Dragon"] }, p2: { monsters: ["Silver Fang"] },
      p3: { monsters: ["Jinzo #7", "Battle Ox"] } }, undefined, 3);
    const targets = attacker(game, 0, 3).attackTargets!;
    expect(targets.monsters).toHaveLength(2);
    expect(targets.monsters).toEqual(expect.arrayContaining([monster(0, 5), monster(2)]));
    expect(targets.direct).toEqual([0, 2]);
    expect(attacker(game, 1, 3).attackTargets).toEqual({ monsters: targets.monsters, direct: [] });
    declare(game, attacker(game, 0, 3), 3);
    game.answer(3, game.view(3).prompt!.id, { choice: "yes" });
    const pick = game.view(3).prompt!;
    game.answer(3, pick.id, { choice: pick.options.find(option => option.controller === 0)!.id });
    expect(game.view(3).seats[0].lp).toBe(15500);
    expect(game.view(3).seats[2].lp).toBe(15500);
  });

  for (const format of ["ffa3", "ffa4"] as const) {
    it(`${format} lists every rival for a card-granted direct attack through monsters`, async () => {
      const { game } = await battle({ format, p0: { monsters: ["Jinzo #7", "Battle Ox"] },
        p1: { monsters: ["Battle Ox"] }, p2: { monsters: ["Battle Ox"] },
        ...(format === "ffa4" ? { p3: { monsters: ["Battle Ox"] } } : {}) });
      const rivals = format === "ffa3" ? [1, 2] : [1, 2, 3];
      expect(attacker(game).attackTargets).toEqual({ monsters: rivals.map(seat => monster(seat)), direct: rivals });
      expect(attacker(game).attackerChoosesTarget).toBe(true);
      expect(attacker(game, 1).attackTargets).toEqual({ monsters: rivals.map(seat => monster(seat)), direct: [] });
      const before = game.view(0);
      expect(before.seats.map(seat => seat.lp)).toEqual(rivals.map(() => 8000).concat(8000));
      expect(before.events.some(event => event.kind === "attack")).toBe(false);
      declare(game, attacker(game));
      game.answer(0, game.view(0).prompt!.id, { choice: "direct:2" });
      expect(game.view(0).seats[2].lp).toBe(7500);
      expect(game.view(0).prompt?.context).toEqual({ type: "action", phase: "battle" });
    });

    it(`${format} excludes an ignored monster and exposes the direct attack the core auto-selects`, async () => {
      const { game } = await battle({ format, p0: { monsters: ["Battle Ox"] },
        p1: { monsters: ["The Legendary Fisherman"], field: "Umi" },
        p2: { spells: ["Swords of Revealing Light"] },
        ...(format === "ffa4" ? { p3: { spells: ["Swords of Revealing Light"] } } : {}) });
      expect(attacker(game).attackTargets).toEqual({ monsters: [], direct: [1] });
      declare(game, attacker(game));
      expect(game.view(0).seats[1].lp).toBe(6300);
      expect(game.view(0).seats[1].monsters[0]?.name).toBe("The Legendary Fisherman");
    });

    it(`${format} excludes a protected empty rival when the core skips the sole direct-seat pick`, async () => {
      const { game } = await battle({ format, p0: { monsters: ["Battle Ox"] },
        p1: { spells: ["Swords of Revealing Light"] }, p2: {},
        ...(format === "ffa4" ? { p3: { spells: ["Swords of Revealing Light"] } } : {}) });
      expect(attacker(game).attackTargets).toEqual({ monsters: [], direct: [2] });
      declare(game, attacker(game));
      expect(game.view(0).seats[1].lp).toBe(8000);
      expect(game.view(0).seats[2].lp).toBe(6300);
    });
  }

  it("keeps ordinary FFA3 targets after only two seats survive", async () => {
    const { game, session } = await battle({ format: "ffa3", p0: { monsters: ["Battle Ox"] },
      p1: { monsters: ["Silver Fang"] }, p2: { monsters: ["Blue-Eyes White Dragon"] } });
    game.eliminate(2, 0);
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(1)], direct: [] });
    declare(game, attacker(game));
    session.reachMainPhase();
    expect(game.view(0).seats[1].graveyard.some(card => card.name === "Silver Fang")).toBe(true);
  });

  it("refreshes conditional direct attacks when FFA3 returns to 1v1 columns", async () => {
    const { game } = await battle({ format: "ffa3", p0: { monsters: [null, null, null, null, null, "Mekk-Knight Spectrum Supreme"] },
      p1: { monsters: [null, null, null, "Battle Ox"] }, p2: { monsters: ["Silver Fang"] } });
    expect(attacker(game, 5).attackTargets).toEqual({ monsters: [monster(1, 3), monster(2)], direct: [1, 2] });
    game.eliminate(2, 0);
    expect(attacker(game, 5).attackTargets).toEqual({ monsters: [monster(1, 3)], direct: [] });
  });

  it("refreshes surviving attack options when surrender removes a borrowed attacker", async () => {
    const { game } = await battle({ format: "ffa3", p0: { monsters: ["Battle Ox"] },
      p1: { monsters: ["Silver Fang"] }, p2: {} },
    `local c=Debug.AddCard(89631139,2,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK,true)
     local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_SINGLE) e:SetCode(EFFECT_SET_CONTROL)
     e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE) e:SetValue(0) c:RegisterEffect(e)`);
    expect(attacker(game, 1).card?.name).toBe("Blue-Eyes White Dragon");
    game.eliminate(2, 0);
    expect(game.view(0).prompt!.options.filter(option => option.id.startsWith("attack:"))).toHaveLength(1);
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(1)], direct: [] });
  });

  it("FFA4 returns the controllers of facing and independent Extra Monster Zones", async () => {
    const { game } = await battle({ format: "ffa4", p0: { monsters: ["Battle Ox"] },
      p1: { monsters: [null, null, null, null, null, "Link Spider"] },
      p2: { monsters: [null, null, null, null, null, null, "Link Spider"] }, p3: {} });
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(1, 5), monster(2, 6)], direct: [3] });
  });

  it("Tag includes both opposing fields and blocks an empty member behind its partner's EMZ", async () => {
    const { game } = await battle({ format: "tag", p0: { monsters: ["Battle Ox", "Jinzo #7"] },
      p1: {}, p2: { monsters: ["Blue-Eyes White Dragon"] },
      p3: { monsters: [null, null, null, null, null, "Link Spider"] } });
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(3, 5)], direct: [] });
    expect(attacker(game, 1).attackTargets).toEqual({ monsters: [monster(3, 5)], direct: [1, 3] });
    declare(game, attacker(game, 1));
    game.answer(0, game.view(0).prompt!.id, { choice: "yes" });
    const pick = game.view(0).prompt!;
    game.answer(0, pick.id, { choice: pick.options.find(option => option.controller === 3)!.id });
    expect(game.view(0).seats[1].lp).toBe(15500);
    expect(game.view(0).seats[3].lp).toBe(15500);
  });

  it("excludes the attacker itself while retaining legal own-field and Tag partner targets", async () => {
    const { game } = await battle({ format: "tag", p0: { monsters: ["Battle Ox", "Silver Fang"] },
      p1: { monsters: ["Blue-Eyes White Dragon"] }, p2: { monsters: ["Giant Rat"] }, p3: {} },
    `local e=Effect.GlobalEffect() e:SetType(EFFECT_TYPE_FIELD) e:SetCode(EFFECT_SELF_ATTACK)
     e:SetProperty(EFFECT_FLAG_PLAYER_TARGET) e:SetTargetRange(1,0) Duel.RegisterEffect(e,0)`);
    const targets = attacker(game).attackTargets!;
    expect(targets.monsters).toHaveLength(3);
    expect(targets.monsters).toEqual(expect.arrayContaining([monster(0, 1), monster(1), monster(2)]));
    expect(targets.direct).toEqual([]);
  });

  it("reports when Patrician's controller chooses the attack target", async () => {
    const { game } = await battle({ format: "ffa3", p0: { monsters: ["Jinzo #7"] },
      p1: { monsters: ["Patrician of Darkness"] }, p2: { monsters: ["Battle Ox"] } });
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(1), monster(2)], direct: [1, 2] });
    expect(attacker(game).attackerChoosesTarget).toBe(false);
    declare(game, attacker(game));
    expect(game.view(0).prompt).toBeNull();
    expect(game.view(1).prompt?.title).toBe("Select an attack target");
  });
});

describeWithCores("1v1 battle command attack targets", needs.standard(), () => {
  it("queries stock monster and card-granted direct targets", async () => {
    const { game } = await battle({ p0: { monsters: ["Jinzo #7", "Battle Ox"] }, p1: { monsters: ["Silver Fang"] } });
    expect(attacker(game).attackTargets).toEqual({ monsters: [monster(1)], direct: [1] });
    expect(attacker(game, 1).attackTargets).toEqual({ monsters: [monster(1)], direct: [] });
    expect(attacker(game).attackerChoosesTarget).toBe(true);
  });
});
