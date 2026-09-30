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
  projectStoredEvent,
  resetEventBatch,
} from "../src/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const OOKAZI = 19523799;
const RAIGEKI = 12580477;

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

async function openGame(a: number[], b: number[]): Promise<EngineGame> {
  const fill = (head: number[]) => ({ main: [...head, ...weak.slice(10, 45 - head.length)], extra: [], side: [] });
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
      expect(last.zone).toMatchObject({ controller: 1, location: OcgLocation.MZONE });
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
    search: () => [], get: info, cardData: () => null, resolveLabel: () => "", system: () => undefined,
    victory: () => undefined, counter: () => undefined, readScript: () => null, close() {},
  };
  const at = (controller: 0 | 1, location: OcgLocation, sequence: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({
    controller, location, sequence, position,
  });
  const moveOut = (code: number, from: ReturnType<typeof at>): OcgMessage => ({
    type: OcgMessageType.MOVE, card: code, from, to: at(from.controller, OcgLocation.GRAVE, 0, OcgPosition.FACEUP),
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

  it("ignores moves that stay on the field", () => {
    const ctx = createEventContext();
    noteDestroyLog(ctx, `${DESTROY_NOTE_PREFIX}0:${OcgLocation.MZONE}:0`);
    const message: OcgMessage = {
      type: OcgMessageType.MOVE, card: 4, from: at(0, OcgLocation.MZONE, 0), to: at(0, OcgLocation.MZONE, 1),
    };
    expect(observeDuelEvent(message, cards, [], 1, ctx)).toBeNull();
  });
});
