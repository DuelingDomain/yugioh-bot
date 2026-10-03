import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelEvent, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import {
  DESTROY_NOTE_PREFIX,
  createEventContext,
  drainDeferredDestroys,
  noteDestroyLog,
  observeDuelEvent,
  observeMoveEvents,
  projectStoredEvent,
  resetEventBatch,
} from "../src/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const OOKAZI = 19523799;
const RAIGEKI = 12580477;
const GIANT_RAT = 97017120;

function monsters(where: string): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    return (
      db
        .prepare(`select id from datas where type = 17 and alias = 0 and (ot & 3) != 0 and ${where} order by id limit 60`)
        .all() as { id: number }[]
    ).map((row) => row.id);
  } finally {
    db.close();
  }
}

const weak = monsters("level = 4 and atk > 0 and atk <= 1000");
const strong = monsters("level = 4 and atk >= 1800");
const high = monsters("level = 6 and atk >= 2000");

function cardCodes(...names: string[]): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    return names.map((name) => {
      const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0 LIMIT 1").get(name) as { id: number } | undefined;
      if (!row) throw new Error(`Missing pinned card: ${name}`);
      return row.id;
    });
  } finally {
    db.close();
  }
}

async function openGame(a: number[], b: number[], extra: number[] = []): Promise<EngineGame> {
  const fill = (head: number[]) => ({ main: [...head, ...weak.slice(10, 45 - head.length)], extra, side: [] });
  return createEngineGame({
    mode: "normal",
    decks: [fill(a), fill(b)],
    seed,
    dataDirectory,
    settings: {
      visibility: "public",
      banlist: "none",
      cardPool: "both",
      turnSeconds: 240,
      startingLP: 8000,
      startingHand: 5,
      drawPerTurn: 1,
      timeout: "loss",
      validateDeck: false,
      shuffleDeck: false,
    },
  });
}

interface Waiting {
  seat: number;
  view: DuelEngineView;
  prompt: DuelPrompt;
}

/** Answers prompts with `policy` until it returns "stop"; unanswered prompts fall back to a safe default. */
function drive(game: EngineGame, policy: (waiting: Waiting) => DuelAnswer | "stop" | null, limit = 80): Waiting {
  for (let step = 0; step < limit; step++) {
    const seat = game.view(0).prompt ? 0 : 1;
    const view = game.view(seat);
    const prompt = view.prompt;
    if (!prompt) throw new Error("No prompt is waiting");
    // Rendered prompt text never carries printf placeholders from strings.conf.
    for (const text of [prompt.title, prompt.description ?? "", ...prompt.options.flatMap((option) => [option.label, option.effectText ?? ""])]) {
      expect(text, `placeholder in prompt ${prompt.id}: ${text}`).not.toMatch(/%(ls|d|s)/);
    }
    const waiting = { seat, view, prompt };
    const chosen = policy(waiting);
    if (chosen === "stop") return waiting;
    const ids = prompt.options.map((option) => option.id);
    const answer =
      chosen ??
      (ids.includes("to_ep") ? { choice: "to_ep" } : ids.includes("no") ? { choice: "no" } : choosePracticeBotAnswer(prompt));
    game.answer(seat, prompt.id, answer);
  }
  throw new Error("Scenario did not reach its goal");
}

function option(waiting: Waiting, prefix: string, code: number): string | undefined {
  return waiting.prompt.options.find((entry) => entry.id.startsWith(prefix) && entry.card?.code === code)?.id;
}

function eventsOf(game: EngineGame, viewer: number | null = null): DuelEvent[] {
  return game.view(viewer).events;
}

describe("richer engine events", () => {
  it("keeps a Contact Fusion procedure without a Fusion reason as a Special Summon", async () => {
    const [cyberDragon, zwei, fortress] = cardCodes("Cyber Dragon", "Cyber Dragon Zwei", "Chimeratech Fortress Dragon");
    const game = await openGame([cyberDragon], [zwei], [fortress]);
    try {
      drive(game, (w) => {
        if (w.view.seats[0].monsters.some((card) => card?.code === fortress)) return "stop";
        if (w.seat === 1 && w.view.turn === 2) {
          const summon = option(w, "summon:", zwei);
          if (summon) return { choice: summon };
        }
        if (w.seat === 0 && w.view.turn === 3) {
          for (const code of [fortress, cyberDragon]) {
            const summon = option(w, "spsummon:", code);
            if (summon) return { choice: summon };
          }
        }
        return null;
      });
      // The pinned contactop uses REASON_COST | REASON_MATERIAL, with no REASON_FUSION.
      expect(game.view(0).seats[0].graveyard.map((card) => card.code)).toContain(cyberDragon);
      expect(game.view(0).seats[1].graveyard.map((card) => card.code)).toContain(zwei);
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.events.find((event) => event.kind === "summon" && event.card?.code === fortress)?.summonKind).toBe("special");
        expect(view.log.map((entry) => entry.text)).toContain("Player 1 Special Summons Chimeratech Fortress Dragon");
      }
    } finally {
      game.close();
    }
  });

  it("reports both the original Xyz Summon and Rank-Up-Magic's overlay summon as Xyz", async () => {
    const [thrasher, dragon, utopia, upgraded, rankUp] = cardCodes(
      "Photon Thrasher", "Alexandrite Dragon", "Number 39: Utopia", "Number C39: Utopia Ray V", "Rank-Up-Magic Quick Chaos",
    );
    const game = await openGame([thrasher, dragon, rankUp], [], [utopia, upgraded]);
    try {
      drive(game, (w) => {
        const field = w.view.seats[0].monsters;
        if (field.some((card) => card?.code === upgraded)) return "stop";
        if (w.seat === 0 && w.view.turn === 1) {
          if (field.some((card) => card?.code === utopia)) {
            const activate = option(w, "activate:", rankUp);
            if (activate) return { choice: activate };
          }
          for (const [prefix, code] of [["spsummon:", utopia], ["spsummon:", thrasher], ["summon:", dragon]] as const) {
            const action = option(w, prefix, code);
            if (action) return { choice: action };
          }
          if (w.prompt.kind === "cards") {
            const target = w.prompt.options.find((entry) => entry.card?.code === upgraded);
            if (target) return { selected: [target.id] };
          }
        }
        return null;
      });
      expect(game.view(0).seats[0].monsters.find((card) => card?.code === upgraded)?.materials?.map((card) => card.code)).toContain(utopia);
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        for (const code of [utopia, upgraded]) {
          expect(view.events.find((event) => event.kind === "summon" && event.card?.code === code)?.summonKind).toBe("xyz");
        }
        expect(view.log.map((entry) => entry.text)).toContain("Player 1 Xyz Summons Number C39: Utopia Ray V");
      }
    } finally {
      game.close();
    }
  });

  it("reports Cyber-Stein summoning a Fusion monster without materials as a Special Summon", async () => {
    const CYBER_STEIN = 69015963;
    const FLAME_SWORDSMAN = 45231177;
    const game = await openGame([CYBER_STEIN], [], [FLAME_SWORDSMAN]);
    try {
      drive(game, (w) => {
        if (w.view.seats[0].monsters.some((card) => card?.code === FLAME_SWORDSMAN)) return "stop";
        if (w.seat === 0 && w.view.turn === 1) {
          const summon = option(w, "summon:", CYBER_STEIN);
          if (summon) return { choice: summon };
          const activate = option(w, "activate:", CYBER_STEIN);
          if (activate) return { choice: activate };
        }
        return null;
      });
      expect(game.view(0).seats[0].lp).toBe(3000);
      expect(game.view(0).seats[0].graveyard).toEqual([]);
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.events.find((event) => event.kind === "summon" && event.card?.code === FLAME_SWORDSMAN)?.summonKind).toBe("special");
        expect(view.log.map((entry) => entry.text)).toContain("Player 1 Special Summons Flame Swordsman");
        expect(view.log.map((entry) => entry.text)).not.toContain("Player 1 Fusion Summons Flame Swordsman");
      }
    } finally {
      game.close();
    }
  });

  it("reports destruction redirected to banishment by Dimensional Fissure in the Text log", async () => {
    const DIMENSIONAL_FISSURE = 81674782;
    const game = await openGame([weak[0]!, DIMENSIONAL_FISSURE], [RAIGEKI]);
    try {
      drive(game, (w) => {
        if (w.view.seats[0].banished.some((card) => card.code === weak[0])) return "stop";
        if (w.seat === 0 && w.view.turn === 1) {
          const summon = option(w, "summon:", weak[0]!);
          if (summon) return { choice: summon };
          const activate = option(w, "activate:", DIMENSIONAL_FISSURE);
          if (activate) return { choice: activate };
        }
        if (w.seat === 1 && w.view.turn === 2) {
          const activate = option(w, "activate:", RAIGEKI);
          if (activate) return { choice: activate };
        }
        return null;
      });
      const destroyed = eventsOf(game).find((event) => event.kind === "destroy" && event.card?.code === weak[0]);
      expect(destroyed).toMatchObject({ cause: "effect", sourceCode: RAIGEKI });
      expect(game.view(0).seats[0].banished.map((card) => card.code)).toContain(weak[0]);
      for (const viewer of [0, 1, null]) {
        const log = game.view(viewer).log.map((entry) => entry.text);
        expect(log).toContain(`${destroyed!.card!.name} was destroyed and banished`);
        expect(log).not.toContain(`${destroyed!.card!.name} was banished`);
        expect(log).not.toContain(`${destroyed!.card!.name} was sent to the Graveyard`);
      }
    } finally {
      game.close();
    }
  });

  it("reports summon zone, attack target, battle damage and destruction", async () => {
    const game = await openGame([weak[0]!], [strong[0]!]);
    try {
      let battle = false;
      drive(game, (w) => {
        if (w.seat === 0 && w.view.turn === 1) {
          const summon = option(w, "summon:", weak[0]!);
          return summon ? { choice: summon } : null;
        }
        if (w.seat === 1 && w.view.turn === 2) {
          const summon = option(w, "summon:", strong[0]!);
          if (summon) return { choice: summon };
          if (!battle && w.prompt.options.some((entry) => entry.id === "to_bp")) {
            battle = true;
            return { choice: "to_bp" };
          }
          if (w.prompt.options.some((entry) => entry.id.startsWith("attack:"))) return { choice: "attack:0" };
          if (w.prompt.options.some((entry) => entry.id === "to_m2")) return "stop";
        }
        return null;
      });
      const events = eventsOf(game);
      const summons = events.filter((event) => event.kind === "summon");
      expect(summons[0]).toMatchObject({ seat: 0, summonKind: "normal", zone: { controller: 0, location: OcgLocation.MZONE, sequence: 0 } });
      expect(summons[1]).toMatchObject({ seat: 1, summonKind: "normal", zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 } });
      const attack = events.find((event) => event.kind === "attack");
      expect(attack).toMatchObject({
        seat: 1,
        zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 },
        target: { controller: 0, location: OcgLocation.MZONE, sequence: 0 },
      });
      const damage = events.find((event) => event.kind === "damage");
      expect(damage).toMatchObject({ seat: 0, cause: "battle" });
      expect(damage!.amount).toBeGreaterThan(0);
      expect(damage!.text).toBe(`Player 1 takes ${damage!.amount} damage`);
      const destroy = events.find((event) => event.kind === "destroy");
      expect(destroy).toMatchObject({ seat: 0, zone: { controller: 0, location: OcgLocation.MZONE, sequence: 0 } });
      expect(destroy!.card?.code).toBe(weak[0]);
      expect(destroy!.text).toBe(`${destroy!.card!.name} was destroyed`);
      expect(destroy).toMatchObject({ cause: "battle" });
      // The Text log says how each monster arrived and that the one lost in battle was destroyed.
      const log = game.view(null).log.map((entry) => entry.text);
      expect(log).toContain(`Player 1 Normal Summons ${summons[0]!.card!.name}`);
      expect(log).toContain(`Player 2 Normal Summons ${summons[1]!.card!.name}`);
      expect(log).toContain(`${destroy!.card!.name} was destroyed`);
      expect(log).not.toContain(`${destroy!.card!.name} was sent to the Graveyard`);
      expect(game.view(0).seats[0].lp).toBe(8000 - damage!.amount!);
      const ids = events.map((event) => event.id);
      expect(ids.indexOf(attack!.id)).toBeLessThan(ids.indexOf(damage!.id));
    } finally {
      game.close();
    }
  });

  it("omits the target of a direct attack", async () => {
    const game = await openGame([weak[0]!], [strong[0]!]);
    try {
      let battle = false;
      drive(game, (w) => {
        if (w.seat === 1 && w.view.turn === 2) {
          const summon = option(w, "summon:", strong[0]!);
          if (summon) return { choice: summon };
          if (!battle && w.prompt.options.some((entry) => entry.id === "to_bp")) {
            battle = true;
            return { choice: "to_bp" };
          }
          if (w.prompt.options.some((entry) => entry.id.startsWith("attack:"))) return { choice: "attack:0" };
          if (w.prompt.options.some((entry) => entry.id === "to_m2")) return "stop";
        }
        return null;
      });
      const events = eventsOf(game);
      const attack = events.find((event) => event.kind === "attack");
      expect(attack).toMatchObject({ seat: 1, zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 } });
      expect(attack!.target).toBeUndefined();
      expect(attack!.text).toMatch(/direct attack/);
      expect(events.find((event) => event.kind === "damage")).toMatchObject({ seat: 0, cause: "battle" });
    } finally {
      game.close();
    }
  });

  it("marks effect damage, activation zones and mass destruction", async () => {
    const game = await openGame([weak[0]!, OOKAZI, RAIGEKI], [strong[0]!]);
    try {
      drive(game, (w) => {
        if (w.seat === 0 && w.view.turn === 1) {
          const ookazi = option(w, "activate:", OOKAZI);
          if (ookazi) return { choice: ookazi };
          return w.prompt.options.some((entry) => entry.id === "to_ep") ? { choice: "to_ep" } : null;
        }
        if (w.seat === 1 && w.view.turn === 2) {
          const summon = option(w, "summon:", strong[0]!);
          return summon ? { choice: summon } : null;
        }
        if (w.seat === 0 && w.view.turn === 3) {
          const raigeki = option(w, "activate:", RAIGEKI);
          if (raigeki) return { choice: raigeki };
          return "stop";
        }
        return null;
      });
      const events = eventsOf(game);
      const activations = events.filter((event) => event.kind === "activate");
      expect(activations[0]).toMatchObject({ seat: 0, card: { code: OOKAZI }, zone: { controller: 0, location: OcgLocation.SZONE } });
      expect(events.find((event) => event.kind === "damage")).toMatchObject({ seat: 1, amount: 800, cause: "effect", text: "Player 2 takes 800 damage" });
      // Raigeki was activated in the drive loop's last answer; play the chain out.
      drive(game, (w) => (w.view.turn >= 4 ? "stop" : null));
      const all = eventsOf(game);
      const destroyed = all.filter((event) => event.kind === "destroy");
      expect(destroyed.map((event) => event.seat)).toEqual([1]);
      expect(destroyed[0]).toMatchObject({ zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 }, card: { code: strong[0] } });
      // Destroyed by Raigeki vs. sent to the Graveyard after resolving.
      const log = game.view(1).log.map((entry) => entry.text);
      expect(log).toContain(`${destroyed[0]!.card!.name} was destroyed`);
      expect(log).toContain(`${activations[0]!.card!.name} was sent to the Graveyard`);
      const raigeki = all.find((event) => event.kind === "activate" && event.card?.code === RAIGEKI);
      expect(log).toContain(`${raigeki!.card!.name} was sent to the Graveyard`);
    } finally {
      game.close();
    }
  });

  it("flags Tribute Summons and keeps face-down sets private", async () => {
    const game = await openGame([weak[0]!], [strong[0]!, high[0]!]);
    try {
      let set = false;
      drive(game, (w) => {
        if (w.seat === 1 && w.view.turn === 2) {
          if (!set) {
            const mset = option(w, "mset:", strong[0]!);
            if (mset) {
              set = true;
              return { choice: mset };
            }
          }
          return null;
        }
        if (w.seat === 1 && w.view.turn === 4) {
          const summon = option(w, "summon:", high[0]!);
          if (summon) return { choice: summon };
          return "stop";
        }
        return null;
      });
      const setEvent = eventsOf(game, 0).find((event) => event.kind === "set");
      expect(setEvent).toMatchObject({ seat: 1, zone: { controller: 1, location: OcgLocation.MZONE } });
      expect(setEvent!.card).toBeUndefined();
      expect(setEvent!.text).toBe("Player 2 Sets a card");
      expect(eventsOf(game, 1).find((event) => event.kind === "set")!.card?.code).toBe(strong[0]);
      // Finish the Tribute Summon: pick the tribute, then a zone.
      drive(game, (w) => (w.view.turn >= 5 ? "stop" : null));
      const summons = eventsOf(game).filter((event) => event.kind === "summon");
      const last = summons[summons.length - 1]!;
      expect(last.card?.code).toBe(high[0]);
      expect(last.summonKind).toBe("tribute");
      // The Text log: the Tribute Summon is named; the Set monster's name reaches its opponent only once it is
      // in the Graveyard (public), never from the Set itself.
      const setName = eventsOf(game, 1).find((event) => event.kind === "set")!.card!.name;
      for (const viewer of [0, null]) {
        const log = game.view(viewer).log.map((entry) => entry.text);
        expect(log).toContain(`Player 2 Tribute Summons ${last.card!.name}`);
        expect(log).toContain("Player 2 Sets a card");
        expect(log.filter((text) => text.includes(setName))).toEqual([`${setName} was sent to the Graveyard`]);
        // The Tribute's line sits directly above the summon line: the web Text log relies on that to colour it.
        expect(log[log.indexOf(`Player 2 Tribute Summons ${last.card!.name}`) - 1]).toBe(`${setName} was sent to the Graveyard`);
      }
      expect(last.zone).toMatchObject({ controller: 1, location: OcgLocation.MZONE });
    } finally {
      game.close();
    }
  });
});

describe("prompt text, battle steps and position changes from a real duel", () => {
  it("renders the Giant Rat trigger prompt with its name and location, tracks the battle step, and reports a position change", async () => {
    const game = await openGame([GIANT_RAT], [strong[0]!]);
    try {
      const steps: Array<[string, DuelEngineView["battleStep"]]> = [];
      let trigger: DuelPrompt | undefined;
      let battle = false;
      drive(game, (w) => {
        if (w.seat === 0 && w.view.turn === 1) {
          expect(w.view.battleStep).toBeNull();
          const summon = option(w, "summon:", GIANT_RAT);
          return summon ? { choice: summon } : null;
        }
        if (w.seat === 1 && w.view.turn === 2) {
          const summon = option(w, "summon:", strong[0]!);
          if (summon) return { choice: summon };
          if (!battle && w.prompt.options.some((entry) => entry.id === "to_bp")) {
            battle = true;
            expect(w.view.battleStep).toBeNull();
            return { choice: "to_bp" };
          }
          if (w.prompt.options.some((entry) => entry.id.startsWith("attack:"))) {
            steps.push(["attack", w.view.battleStep]);
            return { choice: "attack:0" };
          }
          if (w.prompt.options.some((entry) => entry.id === "to_m2")) {
            steps.push(["after-battle", w.view.battleStep]);
            return { choice: "to_m2" };
          }
          if (w.prompt.options.some((entry) => entry.id === "to_ep")) {
            steps.push(["main2", w.view.battleStep]);
            return { choice: "to_ep" };
          }
        }
        if (w.seat === 0 && w.view.turn === 2 && w.prompt.source?.code === GIANT_RAT && w.prompt.options.some((entry) => entry.id === "yes")) {
          trigger = w.prompt;
          steps.push(["trigger", w.view.battleStep]);
          return { choice: "yes" };
        }
        if (w.seat === 0 && w.view.turn === 3) {
          const change = w.prompt.options.find((entry) => entry.id.startsWith("pos:"));
          if (change) return { choice: change.id };
          return "stop";
        }
        return null;
      }, 120);
      expect(trigger).toBeDefined();
      expect(trigger!.title).toBe('Activate the Trigger Effect of "Giant Rat" from [Graveyard]?');
      expect(trigger!.description).toBeUndefined();
      expect(trigger!.source).toEqual({
        code: GIANT_RAT,
        name: "Giant Rat",
        seat: 0,
        zone: { controller: 0, location: OcgLocation.GRAVE, sequence: 0 },
        text: expect.stringContaining("Special Summon 1 EARTH monster"),
      });
      expect(trigger!.options[0]!.cardText).toContain("destroyed by battle");
      expect(steps).toEqual([
        ["attack", "battle"],
        ["trigger", "damage"],
        ["after-battle", "battle"],
        ["main2", null],
      ]);
      const events = eventsOf(game);
      const special = events.filter((event) => event.kind === "summon" && event.summonKind === "special");
      expect(special).toHaveLength(1);
      const position = events.find((event) => event.kind === "position");
      expect(position).toMatchObject({
        seat: 0,
        zone: { controller: 0, location: OcgLocation.MZONE, sequence: 0 },
        fromPosition: OcgPosition.FACEUP_ATTACK,
        toPosition: OcgPosition.FACEUP_DEFENSE,
        card: { code: special[0]!.card!.code },
      });
      expect(position!.flip).toBeUndefined();
      expect(position!.text).toBe(`${special[0]!.card!.name} changed to Defense Position`);
      expect(game.view(0).battleStep).toBeNull();
    } finally {
      game.close();
    }
  });
});

describe("move events from a real duel", () => {
  const moveOf = (events: DuelEvent[], reason: string, code?: number) =>
    events.find((event) => event.kind === "move" && event.reason === reason && (code == null || event.card?.code === code));

  it("orders moves before summon, set, activate and destroy and keeps hidden cards private", async () => {
    // Top of deck (draw order): weak[1], RAIGEKI, OOKAZI, weak[0]. Seat 1 draws strong[0] first.
    const game = await openGame([weak[1]!, RAIGEKI, OOKAZI, weak[0]!], [strong[0]!]);
    try {
      const plan: Array<{ seat: number; turn: number; prefix: string; code?: number }> = [
        { seat: 0, turn: 1, prefix: "mset:", code: weak[1]! },
        { seat: 0, turn: 1, prefix: "sset:", code: RAIGEKI },
        { seat: 0, turn: 1, prefix: "activate:", code: OOKAZI },
        { seat: 1, turn: 2, prefix: "summon:", code: strong[0]! },
        { seat: 1, turn: 2, prefix: "to_bp" },
        { seat: 1, turn: 2, prefix: "attack:0" },
      ];
      let next = 0;
      drive(game, (w) => {
        const step = plan[next];
        if (!step) return w.seat === 1 && w.view.turn === 2 && w.prompt.options.some((entry) => entry.id === "to_m2") ? "stop" : null;
        if (step.seat !== w.seat || step.turn !== w.view.turn) return null;
        const id = w.prompt.options.find((entry) => entry.id.startsWith(step.prefix) && (step.code == null || entry.card?.code === step.code))?.id;
        if (!id) return null;
        next += 1;
        return { choice: id };
      });
      expect(next).toBe(plan.length);
      const own = eventsOf(game, 0);
      const foe = eventsOf(game, 1);
      expect(own.map((event) => event.id)).toEqual([...own.map((event) => event.id)].sort((a, b) => a - b));
      const indexOf = (events: DuelEvent[], test: (event: DuelEvent) => boolean) => events.findIndex(test);

      // Draw: one deck -> hand move per card, the card only for the drawing seat.
      const draws = own.filter((event) => event.kind === "move" && event.reason === "draw");
      expect(draws.slice(0, 5).map((event) => event.zone!.sequence)).toEqual([0, 1, 2, 3, 4]);
      expect(draws[0]).toMatchObject({ seat: 0, from: { controller: 0, location: OcgLocation.DECK }, zone: { controller: 0, location: OcgLocation.HAND } });
      expect(draws.slice(0, 5).map((event) => event.card?.code)).toEqual([weak[1], RAIGEKI, OOKAZI, weak[0], expect.any(Number)]);
      const opponentDraws = own.filter((event) => event.kind === "move" && event.reason === "draw" && event.seat === 1);
      expect(opponentDraws.length).toBeGreaterThanOrEqual(5);
      for (const event of opponentDraws) expect(event.card).toBeUndefined();
      for (const event of foe.filter((entry) => entry.kind === "move" && entry.reason === "draw" && entry.seat === 0)) {
        expect(event.card).toBeUndefined();
      }
      expect(foe.find((event) => event.kind === "move" && event.reason === "draw" && event.seat === 1)!.card?.code).toBe(strong[0]);

      // Set: the move to the field is face-down and the opponent never learns the card.
      const setMove = moveOf(own, "set", weak[1]!)!;
      expect(setMove).toMatchObject({ seat: 0, faceDown: true, from: { controller: 0, location: OcgLocation.HAND }, zone: { controller: 0, location: OcgLocation.MZONE, sequence: 0 } });
      expect(indexOf(own, (event) => event === setMove)).toBeLessThan(indexOf(own, (event) => event.kind === "set" && event.zone?.location === OcgLocation.MZONE));
      const hiddenSet = foe.find((event) => event.kind === "move" && event.reason === "set" && event.zone?.location === OcgLocation.MZONE)!;
      expect(hiddenSet.card).toBeUndefined();
      expect(hiddenSet.text).toBe("A card moved");
      expect(hiddenSet.from).toMatchObject({ location: OcgLocation.HAND });
      expect(foe.find((event) => event.kind === "move" && event.reason === "set" && event.zone?.location === OcgLocation.SZONE)!.card).toBeUndefined();
      expect(JSON.stringify(foe)).not.toContain(String(RAIGEKI));

      // Normal Spell: hand -> S/T zone (activate) precedes the activation, the send to the GY follows resolution.
      const activateMove = moveOf(foe, "activate", OOKAZI)!;
      expect(activateMove).toMatchObject({ seat: 0, faceDown: false, from: { location: OcgLocation.HAND }, zone: { location: OcgLocation.SZONE } });
      const at = (events: DuelEvent[], test: (event: DuelEvent) => boolean) => indexOf(events, test);
      const activation = at(own, (event) => event.kind === "activate" && event.card?.code === OOKAZI);
      const resolved = at(own, (event) => event.kind === "chain-resolved");
      const toGrave = at(own, (event) => event.kind === "move" && event.card?.code === OOKAZI && event.zone?.location === OcgLocation.GRAVE);
      expect(at(own, (event) => event.kind === "move" && event.reason === "activate")).toBeLessThan(activation);
      expect(toGrave).toBeGreaterThan(resolved);
      expect(own[toGrave]).toMatchObject({ reason: "send", from: { location: OcgLocation.SZONE } });

      // Summon: the move (reason summon) precedes the summon event.
      const summonMove = moveOf(foe, "summon", strong[0]!)!;
      expect(summonMove).toMatchObject({ seat: 1, faceDown: false, from: { controller: 1, location: OcgLocation.HAND }, zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 } });
      expect(indexOf(foe, (event) => event === summonMove)).toBeLessThan(indexOf(foe, (event) => event.kind === "summon"));

      // Battle destruction: field -> GY move (destroy) directly before the destroy event.
      const destroyIndex = at(own, (event) => event.kind === "destroy");
      expect(own[destroyIndex - 1]).toMatchObject({ kind: "move", reason: "destroy", from: { controller: 0, location: OcgLocation.MZONE }, zone: { location: OcgLocation.GRAVE } });
    } finally {
      game.close();
    }
  });
});

describe("equip links from a real duel", () => {
  const AXE_OF_DESPAIR = 40619825;

  it("links an Equip Spell to its monster in the board snapshot and emits an equip event", async () => {
    const game = await openGame([weak[0]!, AXE_OF_DESPAIR], [strong[0]!]);
    try {
      drive(game, (w) => {
        if (w.seat !== 0 || w.view.turn !== 1) return null;
        const spells = w.view.seats[0].spells;
        if (spells.some((card) => card?.equippedTo)) return "stop";
        const summon = option(w, "summon:", weak[0]!);
        if (summon) return { choice: summon };
        const activate = w.prompt.options.find((entry) => entry.card?.code === AXE_OF_DESPAIR && /^(activate|spell|chain)/.test(entry.id));
        if (activate) return { choice: activate.id };
        return null;
      });
      const mine = game.view(0);
      const axeIndex = mine.seats[0].spells.findIndex((card) => card?.code === AXE_OF_DESPAIR);
      expect(axeIndex).toBeGreaterThanOrEqual(0);
      const axe = mine.seats[0].spells[axeIndex]!;
      expect(axe.equippedTo).toEqual({ controller: 0, location: OcgLocation.MZONE, sequence: 0 });
      expect(mine.seats[0].monsters[0]?.code).toBe(weak[0]);
      expect(game.view(1).seats[0].spells[axeIndex]?.equippedTo).toEqual(axe.equippedTo);
      const equip = mine.events.find((event) => event.kind === "equip");
      expect(equip).toMatchObject({
        seat: 0,
        zone: { controller: 0, location: OcgLocation.SZONE, sequence: axeIndex },
        target: { controller: 0, location: OcgLocation.MZONE, sequence: 0 },
      });
    } finally {
      game.close();
    }
  });
});

describe("event observer messages", () => {
  const info = (code: number): DuelCardInfo => ({
    code, name: `Card ${code}`, description: "", type: 1, attack: 1000, defense: 1000, level: code === 7 ? 7 : 4, attribute: 1, race: "warrior",
  });
  const cards: CardDatabase = {
    search: () => [], get: info, deckCard: () => undefined, all: () => [], setnames: () => new Map(), cardData: () => null, resolveLabel: () => "", system: () => undefined,
    victory: () => undefined, counter: () => undefined, readScript: () => null, close() {},
  };
  const at = (controller: 0 | 1, location: OcgLocation, sequence: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({
    controller, location, sequence, position,
  });
  const moveOut = (code: number, from: ReturnType<typeof at>): OcgMessage => ({
    type: OcgMessageType.MOVE, card: code, from, to: at(from.controller, OcgLocation.GRAVE, 0, OcgPosition.FACEUP),
  });

  it("reports an equip with both zones and no card identity", () => {
    const stored = observeDuelEvent(
      { type: OcgMessageType.EQUIP, card: at(0, OcgLocation.SZONE, 2, OcgPosition.FACEUP), target: at(1, OcgLocation.MZONE, 3) },
      cards, [], 7, createEventContext(),
    )!;
    expect(stored.kind).toBe("equip");
    expect(stored.seat).toBe(0);
    expect(stored.card).toBeUndefined();
    for (const viewer of [0, 1, null]) {
      const shown = projectStoredEvent(stored, viewer);
      expect(shown.zone).toEqual({ controller: 0, location: OcgLocation.SZONE, sequence: 2 });
      expect(shown.target).toEqual({ controller: 1, location: OcgLocation.MZONE, sequence: 3 });
      expect(shown.text).not.toMatch(/Card \d/);
    }
  });

  it("tags Special and Flip Summons and Level 7 Normal Summons", () => {
    const summon = (type: OcgMessageType, code: number): OcgMessage => ({
      type, code, controller: 0, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK,
    } as OcgMessage);
    const ctx = createEventContext();
    const event = (type: OcgMessageType, code: number) => observeDuelEvent(summon(type, code), cards, [], 1, ctx)!;
    expect(event(OcgMessageType.SUMMONING, 1).summonKind).toBe("normal");
    expect(event(OcgMessageType.SUMMONING, 7).summonKind).toBe("tribute");
    expect(event(OcgMessageType.SPSUMMONING, 7).summonKind).toBe("special");
    expect(event(OcgMessageType.FLIPSUMMONING, 1).summonKind).toBe("flip");
    expect(event(OcgMessageType.SUMMONING, 1).zone).toEqual({ controller: 0, location: OcgLocation.MZONE, sequence: 2 });
  });

  it("treats a Level 4 Normal Summon after a release as a Tribute Summon", () => {
    const ctx = createEventContext();
    noteDestroyLog(ctx, "unrelated");
    observeDuelEvent(moveOut(2, at(0, OcgLocation.MZONE, 1)), cards, [], 1, ctx);
    const event = observeDuelEvent(
      { type: OcgMessageType.SUMMONING, code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      cards, [], 2, ctx,
    )!;
    expect(event.summonKind).toBe("tribute");
  });

  it("keeps zones public but the identity of a face-down summon private", () => {
    const stored = observeDuelEvent(
      { type: OcgMessageType.SPSUMMONING, code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 3, position: OcgPosition.FACEDOWN_DEFENSE },
      cards, [], 1, createEventContext(),
    )!;
    const opponent = projectStoredEvent(stored, 1);
    expect(opponent.card).toBeUndefined();
    expect(opponent.zone).toEqual({ controller: 0, location: OcgLocation.MZONE, sequence: 3 });
    expect(opponent.summonKind).toBe("special");
    expect(projectStoredEvent(stored, 0).card?.code).toBe(1);
  });

  it("classifies damage as battle only between BATTLE and the end of the damage step", () => {
    const ctx = createEventContext();
    const damage = (id: number): DuelEvent =>
      projectStoredEvent(observeDuelEvent({ type: OcgMessageType.DAMAGE, player: 1, amount: 700 }, cards, [], id, ctx)!, null);
    expect(damage(1)).toMatchObject({ kind: "damage", seat: 1, amount: 700, cause: "effect", text: "Player 2 takes 700 damage" });
    observeDuelEvent({
      type: OcgMessageType.BATTLE,
      card: { ...at(0, OcgLocation.MZONE, 0), attack: 1, defense: 1, destroyed: false },
      target: null,
    }, cards, [], 2, ctx);
    expect(damage(3).cause).toBe("battle");
    observeDuelEvent({ type: OcgMessageType.DAMAGE_STEP_END }, cards, [], 4, ctx);
    expect(damage(5).cause).toBe("effect");
    const cost = observeDuelEvent({ type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 }, cards, [], 6, ctx)!;
    expect(cost).toMatchObject({ kind: "damage", seat: 0, amount: 1000, cause: "cost", text: "Player 1 pays 1000 LP" });
    expect(observeDuelEvent({ type: OcgMessageType.DAMAGE, player: 0, amount: 0 }, cards, [], 7, ctx)).toBeNull();
  });

  it("emits destroy only when the startup script reported it, and hides face-down identities", () => {
    const ctx = createEventContext();
    const from = at(1, OcgLocation.SZONE, 2, OcgPosition.FACEDOWN);
    // No note yet: the move is held back, not reported.
    expect(observeDuelEvent(moveOut(9, from), cards, [], 1, ctx)).toBeNull();
    expect(noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}1:${OcgLocation.SZONE}:2`)).toBe(true);
    const drained = drainDeferredDestroys(ctx, cards, 10);
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ id: 10, kind: "destroy", seat: 1, zone: { controller: 1, location: OcgLocation.SZONE, sequence: 2 } });
    expect(projectStoredEvent(drained[0]!, 0).card).toBeUndefined();
    expect(projectStoredEvent(drained[0]!, 0).text).toBe("A face-down card was destroyed");
    expect(projectStoredEvent(drained[0]!, 1).card?.code).toBe(9);

    // A note that arrives first matches the move inline; an unmatched move is dropped at the end of the batch.
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0`);
    const inline = observeDuelEvent(moveOut(4, at(0, OcgLocation.MZONE, 0)), cards, [], 11, ctx)!;
    expect(inline).toMatchObject({ kind: "destroy", seat: 0, text: "Card 4 was destroyed" });
    expect(projectStoredEvent(inline, 1).card?.code).toBe(4);
    observeDuelEvent(moveOut(5, at(0, OcgLocation.MZONE, 1)), cards, [], 12, ctx);
    resetEventBatch(ctx);
    expect(drainDeferredDestroys(ctx, cards, 20)).toEqual([]);
  });

  it("reads cause and source from a detailed destruction note", () => {
    const ctx = createEventContext();
    const from = at(0, OcgLocation.MZONE, 0);
    // reason DESTROY|EFFECT (0x41), Mirror Force (trap 0x4 | 0x20000 continuous-free) activated by seat 1.
    observeDuelEvent(moveOut(4, from), cards, [], 1, ctx);
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0:65:44095762:4:1`);
    const [effect] = drainDeferredDestroys(ctx, cards, 30);
    expect(effect).toMatchObject({ kind: "destroy", cause: "effect", sourceCode: 44095762, sourceKind: "trap", sourceSeat: 1 });
    expect(projectStoredEvent(effect!, 0)).toMatchObject({ cause: "effect", sourceCode: 44095762, sourceKind: "trap", sourceSeat: 1 });

    // Battle: reason DESTROY|BATTLE (0x21) with the opposing monster as source.
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:1:33:77:1:1`);
    const battle = observeDuelEvent(moveOut(5, at(0, OcgLocation.MZONE, 1)), cards, [], 31, ctx)!;
    expect(battle).toMatchObject({ cause: "battle", sourceCode: 77, sourceKind: "monster" });

    // Old three-part note: no cause fields.
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:2`);
    const legacy = observeDuelEvent(moveOut(6, at(0, OcgLocation.MZONE, 2)), cards, [], 32, ctx)!;
    expect(legacy.cause).toBeUndefined();
  });

  it("falls back to the resolving chain link when the core names no reason card", () => {
    const ctx = createEventContext();
    const chain = [{ index: 1, seat: 1, code: 55, zone: at(1, OcgLocation.MZONE, 0), targets: [] }];
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 } as OcgMessage, cards, chain, 1, ctx);
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0:65:0:0:1`);
    const destroyed = observeDuelEvent(moveOut(4, at(0, OcgLocation.MZONE, 0)), cards, chain, 2, ctx)!;
    expect(destroyed).toMatchObject({ cause: "effect", sourceCode: 55, sourceSeat: 1 });
  });

  it("keeps the resolving chain link for a note that arrives after the link resolved", () => {
    const ctx = createEventContext();
    const chain = [{ index: 1, seat: 1, code: 55, zone: at(1, OcgLocation.MZONE, 0), targets: [] }];
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 } as OcgMessage, cards, chain, 1, ctx);
    observeDuelEvent(moveOut(2, at(0, OcgLocation.MZONE, 0)), cards, chain, 2, ctx);
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 } as OcgMessage, cards, chain, 3, ctx);
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0:65:0:0:1`);
    const [destroyed] = drainDeferredDestroys(ctx, cards, 4);
    expect(destroyed).toMatchObject({ cause: "effect", sourceCode: 55, sourceSeat: 1 });
  });

  it("ignores moves that stay on the field", () => {
    const ctx = createEventContext();
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0`);
    const message: OcgMessage = {
      type: OcgMessageType.MOVE, card: 4, from: at(0, OcgLocation.MZONE, 0), to: at(0, OcgLocation.MZONE, 1),
    };
    expect(observeDuelEvent(message, cards, [], 1, ctx)).toBeNull();
  });

  describe("move events", () => {
    const run = (message: OcgMessage, ctx = createEventContext(), first = 1) => observeMoveEvents(message, cards, ctx, first);
    const move = (code: number, from: ReturnType<typeof at>, to: ReturnType<typeof at>): OcgMessage => ({ type: OcgMessageType.MOVE, card: code, from, to });

    it("gives each drawn card its own deck to hand move and hides it from the opponent", () => {
      const ctx = createEventContext();
      const events = run({ type: OcgMessageType.DRAW, player: 1, drawn: [{ code: 5, position: OcgPosition.FACEDOWN }, { code: 6, position: OcgPosition.FACEDOWN }] }, ctx, 10);
      expect(events.map((event) => event.id)).toEqual([10, 11]);
      expect(events.map((event) => event.zone!.sequence)).toEqual([0, 1]);
      const next = run({ type: OcgMessageType.DRAW, player: 1, drawn: [{ code: 7, position: OcgPosition.FACEDOWN }] }, ctx, 12);
      expect(next[0]!.zone!.sequence).toBe(2);
      for (const event of [...events, ...next]) {
        expect(event).toMatchObject({ kind: "move", reason: "draw", seat: 1, from: { controller: 1, location: OcgLocation.DECK }, zone: { controller: 1, location: OcgLocation.HAND } });
        const opponent = projectStoredEvent(event, 0);
        expect(opponent.card).toBeUndefined();
        expect(opponent.text).toBe("A card moved");
        expect(opponent.zone).toEqual(event.zone);
        expect(projectStoredEvent(event, null).card).toBeUndefined();
        expect(projectStoredEvent(event, 1).card?.code).toBe(event.card!.code);
      }
    });

    it("never reveals a face-down Set to the opponent but keeps the zones", () => {
      const ctx = createEventContext();
      const [set] = run(move(9, at(0, OcgLocation.HAND, 2, OcgPosition.FACEDOWN), at(0, OcgLocation.SZONE, 3, OcgPosition.FACEDOWN)), ctx);
      run({ type: OcgMessageType.SET, code: 9, controller: 0, location: OcgLocation.SZONE, sequence: 3, position: OcgPosition.FACEDOWN } as OcgMessage, ctx);
      const opponent = projectStoredEvent(set!, 1);
      expect(opponent.card).toBeUndefined();
      expect(opponent.text).toBe("A card moved");
      expect(opponent).toMatchObject({ reason: "set", faceDown: true, from: { location: OcgLocation.HAND, sequence: 2 }, zone: { location: OcgLocation.SZONE, sequence: 3 } });
      expect(projectStoredEvent(set!, 0).card?.code).toBe(9);
    });

    it("shows a card that becomes public at the destination even when it left a hidden hand", () => {
      const [discard] = run(move(4, at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), at(0, OcgLocation.GRAVE, 0, OcgPosition.FACEUP)));
      expect(discard).toMatchObject({ reason: "discard", seat: 0 });
      expect(projectStoredEvent(discard!, 1).card?.code).toBe(4);
      const [summon] = run(move(4, at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), at(0, OcgLocation.MZONE, 0, OcgPosition.FACEUP_ATTACK)));
      expect(projectStoredEvent(summon!, 1).card?.code).toBe(4);
    });

    it("keeps a hand card private when it moves to the opponent's hidden deck", () => {
      const [back] = run(move(4, at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), at(1, OcgLocation.DECK, 0, OcgPosition.FACEDOWN)));
      expect(projectStoredEvent(back!, 0).card?.code).toBe(4);
      expect(projectStoredEvent(back!, 1).card?.code).toBe(4);
      const [own] = run(move(4, at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN)));
      expect(own).toMatchObject({ reason: "return", revealCardTo: 0 });
      expect(projectStoredEvent(own!, 1).card).toBeUndefined();
    });

    it("derives the default reason from source and destination", () => {
      const reasonOf = (from: OcgLocation, to: OcgLocation, position = OcgPosition.FACEUP) =>
        run(move(4, at(0, from, 0), at(0, to, 0, position)))[0]!.reason;
      expect(reasonOf(OcgLocation.HAND, OcgLocation.GRAVE)).toBe("discard");
      expect(reasonOf(OcgLocation.MZONE, OcgLocation.GRAVE)).toBe("send");
      expect(reasonOf(OcgLocation.DECK, OcgLocation.GRAVE)).toBe("send");
      expect(reasonOf(OcgLocation.MZONE, OcgLocation.REMOVED)).toBe("banish");
      expect(reasonOf(OcgLocation.MZONE, OcgLocation.HAND)).toBe("return");
      expect(reasonOf(OcgLocation.SZONE, OcgLocation.DECK)).toBe("return");
      expect(reasonOf(OcgLocation.DECK, OcgLocation.HAND)).toBe("draw");
      expect(reasonOf(OcgLocation.EXTRA, OcgLocation.MZONE)).toBe("other");
    });

    it("marks a move into a hand as added by an effect, and a draw as not", () => {
      const ctx = createEventContext();
      for (const from of [OcgLocation.DECK, OcgLocation.GRAVE, OcgLocation.REMOVED, OcgLocation.MZONE]) {
        const [added] = run(move(4, at(0, from, 0), at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN)), ctx);
        expect(added!.addedToHand).toBe(true);
        expect(projectStoredEvent(added!, 0).addedToHand).toBe(true);
        expect(projectStoredEvent(added!, 1).addedToHand).toBe(true);
      }
      const [drawn] = run({ type: OcgMessageType.DRAW, player: 0, drawn: [{ code: 5, position: OcgPosition.FACEDOWN }] }, ctx, 20);
      expect(drawn!.addedToHand).toBeUndefined();
      expect(projectStoredEvent(drawn!, 0).addedToHand).toBeUndefined();
      const [discard] = run(move(4, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.GRAVE, 0)), ctx);
      expect(discard!.addedToHand).toBeUndefined();
    });

    it("upgrades the reason from the message that follows the move", () => {
      const ctx = createEventContext();
      const [toField] = run(move(4, at(0, OcgLocation.EXTRA, 0), at(0, OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK)), ctx);
      run({ type: OcgMessageType.SPSUMMONING, code: 4, controller: 0, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK } as OcgMessage, ctx);
      expect(toField!.reason).toBe("summon");
      const [spell] = run(move(8, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.SZONE, 1, OcgPosition.FACEUP)), ctx);
      run({ type: OcgMessageType.CHAINING, code: 8, controller: 0, location: OcgLocation.SZONE, sequence: 1 } as OcgMessage, ctx);
      expect(spell!.reason).toBe("activate");
      const [destroyed] = run(moveOut(2, at(1, OcgLocation.MZONE, 0)), ctx);
      noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}1:${OcgLocation.MZONE}:0`);
      observeDuelEvent(moveOut(2, at(1, OcgLocation.MZONE, 0)), cards, [], 30, ctx);
      expect(destroyed!.reason).toBe("destroy");
    });

    it("skips shuffles, same-zone moves and overlay moves", () => {
      expect(run(move(4, at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN), at(0, OcgLocation.DECK, 7, OcgPosition.FACEDOWN)))).toEqual([]);
      expect(run(move(4, at(0, OcgLocation.MZONE, 0), at(0, OcgLocation.MZONE, 3)))).toEqual([]);
      expect(run(move(4, at(0, OcgLocation.MZONE, 0), at(0, OcgLocation.OVERLAY, 0)))).toEqual([]);
      expect(run(move(4, at(0, OcgLocation.MZONE, 0), at(1, OcgLocation.MZONE, 1)))).toHaveLength(1);
    });
  });
});

describe("duel start and turn start phases", () => {
  const RUSH_RECKLESSLY = 70046172;

  async function openQuiet(a: number[]): Promise<EngineGame> {
    const fill = (head: number[]) => ({ main: [...head, ...weak.slice(10, 45 - head.length)], extra: [], side: [] });
    return createEngineGame({
      mode: "normal",
      decks: [fill(a), fill([])],
      seed,
      dataDirectory,
      settings: {
        visibility: "public",
        banlist: "none",
        cardPool: "both",
        turnSeconds: 240,
        startingLP: 8000,
        startingHand: 5,
        drawPerTurn: 1,
        timeout: "loss",
        validateDeck: false,
        shuffleDeck: false,
        stopAtEveryWindow: false,
      },
    });
  }

  it("announces the opening deal, then Draw, Standby and Main Phase 1 of turn 1", async () => {
    const game = await openGame([], []);
    try {
      const events = game.view(0).events;
      const draws = events.filter((event) => event.kind === "move" && event.reason === "draw");
      expect(draws).toHaveLength(10);
      const phases = events.filter((event) => event.kind === "phase").map((event) => event.text);
      expect(phases).toEqual(["Draw Phase", "Standby Phase", "Main Phase 1"]);
      const lastDraw = Math.max(...draws.map((event) => event.id));
      const firstPhase = events.find((event) => event.kind === "phase")!;
      expect(firstPhase.id).toBeGreaterThan(lastDraw);
    } finally {
      game.close();
    }
  });

  it("announces Draw, the draw, Standby and Main Phase 1 on a later turn", async () => {
    const game = await openGame([], []);
    try {
      const after = game.view(0).events.at(-1)!.id;
      drive(game, ({ view }) => (view.turn >= 2 ? "stop" : null));
      const fresh = game.view(game.view(0).prompt ? 0 : 1).events.filter((event) => event.id > after);
      const sequence = fresh.filter((event) => event.kind === "phase" || (event.kind === "move" && event.reason === "draw"));
      const labels = sequence.map((event) => (event.kind === "phase" ? event.text : "draw"));
      expect(labels.slice(-4)).toEqual(["Draw Phase", "draw", "Standby Phase", "Main Phase 1"]);
    } finally {
      game.close();
    }
  });

  it("offers a Quick-Play Spell in the opponent's Draw Phase even with quiet windows on", async () => {
    const game = await openQuiet([RUSH_RECKLESSLY, RUSH_RECKLESSLY, RUSH_RECKLESSLY]);
    try {
      const reached = drive(game, ({ view, prompt }) => {
        if (view.turn >= 2 && view.phase === "draw" && prompt.context?.type === "chain") return "stop";
        // Rush Recklessly needs a monster to target: summon one, then set the spells.
        if (view.turn !== 1) return null;
        const pick = prompt.options.find((option) => option.id.startsWith("summon:")) ?? prompt.options.find((option) => option.id.startsWith("sset:"));
        return pick ? { choice: pick.id } : null;
      });
      expect(reached.seat).toBe(0);
      expect(reached.prompt.context?.type).toBe("chain");
      expect(reached.view.turn).toBe(2);
    } finally {
      game.close();
    }
  });

  it("still passes an empty Draw Phase window by itself", async () => {
    const game = await openQuiet([]);
    try {
      const reached = drive(game, ({ view }) => (view.turn >= 3 ? "stop" : null));
      expect(reached.prompt.context?.type).toBe("action");
      expect(reached.view.phase).toBe("main1");
    } finally {
      game.close();
    }
  });
});
