import assert from "node:assert/strict";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;

function loadDecks(): { deck: DuelDeck; axeRaider: number } {
  const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
  const master = cdb
    .prepare("SELECT d.id AS id FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = 'Axe Raider' AND d.alias = 0")
    .get() as { id: number } | undefined;
  assert(master);
  const mains = cdb
    .prepare(
      "SELECT id FROM datas WHERE type = 17 AND alias = 0 AND ot IN (1, 2, 3) AND (race = 1 OR attribute = 1) AND id != ? ORDER BY level, atk DESC, id LIMIT 60",
    )
    .all(master.id) as { id: number }[];
  cdb.close();
  const deck: DuelDeck = { main: mains.map((row) => row.id), extra: [], side: [], deckMaster: master.id };
  return { deck, axeRaider: master.id };
}

function answering(game: { view: (seat: number | null) => DuelEngineView }): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

function dump(prompt: DuelPrompt): string {
  return `${prompt.kind} ${prompt.title} [${prompt.options.map((option) => `${option.id}:${option.label}`).join(" | ")}]`;
}

function isYesNo(prompt: DuelPrompt): boolean {
  return prompt.kind === "choice" && prompt.options.some((option) => option.id === "yes") && prompt.options.some((option) => option.id === "no");
}

function inGrave(view: DuelEngineView, seat: number, code: number): boolean {
  return view.seats[seat].graveyard.some((card) => card.code === code);
}

type Policy = { summonDm?: boolean; attack?: boolean; battle?: boolean; toM2?: boolean; recall?: "yes" | "no" };

function choose(prompt: DuelPrompt, code: number, policy: Policy): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    const count = prompt.min ?? 1;
    return { selected: prompt.options.slice(0, count).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (policy.recall === "yes") return { choice: "yes" };
      return { choice: "no" };
    }
    if (policy.summonDm) {
      const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === code);
      if (summon) return { choice: summon.id };
    }
    if (policy.attack) {
      const attack = prompt.options.find((option) => option.id.startsWith("attack:"));
      if (attack) return { choice: attack.id };
    }
    if (policy.battle) {
      const toBp = prompt.options.find((option) => option.id === "to_bp");
      if (toBp) return { choice: "to_bp" };
    }
    if (policy.toM2) {
      const toM2 = prompt.options.find((option) => option.id === "to_m2");
      if (toM2) return { choice: "to_m2" };
    }
    const toEp = prompt.options.find((option) => option.id === "to_ep");
    if (toEp) return { choice: "to_ep" };
    const faceUp = prompt.options.find((option) => option.id === "pos:1" || /attack/i.test(option.label));
    if (faceUp) return { choice: faceUp.id };
    if (prompt.cancelable) return { cancel: true };
    assert(prompt.options[0], `empty choice prompt ${dump(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`Unplanned smoke prompt ${dump(prompt)}`);
}

const { deck, axeRaider } = loadDecks();
const game = await createEngineGame({
  mode: "domain",
  decks: [deck, { ...deck, main: [...deck.main] }],
  seed: ["1", "2", "3", "4"],
  dataDirectory,
});

try {
  const opening = game.view(0);
  const first = opening.turnSeat;
  const second = 1 - first;
  assert(opening.seats[0].deckMaster && opening.seats[1].deckMaster);
  assert.equal(opening.seats[0].deckMaster.inZone, true);
  assert.equal(typeof opening.seats[0].deckMaster.returns, "number");
  assert.equal(typeof opening.seats[0].deckMaster.nextCost, "number");

  const play = (policy: Policy) => {
    const waiting = answering(game);
    if (!waiting) throw new Error("engine stopped without a prompt");
    if (isYesNo(waiting.prompt) && policy.recall == null) {
      throw new Error(`unexpected recall while field/overlay-class should block: ${dump(waiting.prompt)}`);
    }
    game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, policy));
    return game.view(0);
  };

  let view = game.view(0);
  for (let step = 0; step < 80 && view.seats[first].deckMaster?.inZone; step++) {
    view = play({ summonDm: true });
  }
  assert.equal(view.seats[first].deckMaster?.inZone, false, "DM must leave DMZ onto the field");
  assert.equal(
    view.seats[first].monsters.some((card) => card?.code === axeRaider) || view.seats[first].deckMaster?.inZone === false,
    true,
  );

  for (let step = 0; step < 40 && view.turnSeat === first; step++) {
    view = play({ summonDm: false });
  }
  for (let step = 0; step < 80 && view.seats[second].deckMaster?.inZone; step++) {
    view = play({ summonDm: true });
  }
  for (let step = 0; step < 80 && !(inGrave(view, first, axeRaider) && inGrave(view, second, axeRaider)); step++) {
    view = play({ battle: true, attack: true });
  }
  assert.equal(inGrave(view, first, axeRaider), true);
  assert.equal(inGrave(view, second, axeRaider), true);

  let declines = 0;
  for (let step = 0; step < 40 && declines < 2; step++) {
    const waiting = answering(game);
    if (!waiting) throw new Error("lost prompt while declining recall");
    if (isYesNo(waiting.prompt)) {
      assert.equal(inGrave(game.view(0), waiting.seat, axeRaider), true, "decline is for a GY deck master, not overlay");
      game.answer(waiting.seat, waiting.prompt.id, { choice: "no" });
      declines += 1;
    } else {
      game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { battle: true, attack: true, toM2: true }));
    }
  }
  assert.equal(declines, 2, "both owners must be offered recall and decline");

  view = game.view(0);
  assert.equal(view.seats[first].deckMaster?.inZone, false);
  assert.equal(view.seats[second].deckMaster?.inZone, false);
  assert.equal(view.seats[first].deckMaster?.returns, 0);
  assert.equal(view.seats[second].deckMaster?.returns, 0);
  assert.equal(inGrave(view, first, axeRaider), true);
  assert.equal(inGrave(view, second, axeRaider), true);

  for (let step = 0; step < 30; step++) {
    const waiting = answering(game);
    if (!waiting) break;
    if (isYesNo(waiting.prompt)) {
      throw new Error(`decline must consume recall until a zone-type change: ${dump(waiting.prompt)}`);
    }
    game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { toM2: true }));
    view = game.view(0);
    if (view.turnSeat === first && view.phase === "main1") break;
  }
  assert.equal(inGrave(game.view(0), first, axeRaider), true);
  assert.equal(inGrave(game.view(0), second, axeRaider), true);
  assert.equal(game.view(0).seats[first].deckMaster?.inZone, false);
} finally {
  game.close();
}

console.log("domain-overlay-recall: on-field blocks recall; GY decline consumes until zone-type change");
