import assert from "node:assert/strict";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";
const dataDirectory = engineDataDirectory;
const SEED = ["1", "2", "3", "4"];

function loadDecks(): { north: DuelDeck; south: DuelDeck; axeRaider: number } {
  const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
  const master = cdb
    .prepare("SELECT d.id AS id FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = 'Axe Raider' AND d.alias = 0")
    .get() as { id: number } | undefined;
  assert(master, "Axe Raider missing from cards.cdb");
  const mains = cdb
    .prepare(
      "SELECT id FROM datas WHERE type = 17 AND alias = 0 AND ot IN (1, 2, 3) AND (race = 1 OR attribute = 1) AND id != ? ORDER BY level, atk DESC, id LIMIT 60",
    )
    .all(master.id) as { id: number }[];
  assert.equal(mains.length, 60, "need 60 domain-legal vanilla mains");
  cdb.close();
  const deck: DuelDeck = {
    main: mains.map((row) => row.id),
    extra: [],
    side: [],
    deckMaster: master.id,
  };
  return { north: { ...deck, main: [...deck.main] }, south: { ...deck, main: [...deck.main] }, axeRaider: master.id };
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

function bothMastersInGrave(view: DuelEngineView, code: number): boolean {
  return [0, 1].every((seat) => view.seats[seat].deckMaster?.inZone === false && inGrave(view, seat, code));
}

type Policy = {
  summonDm?: boolean;
  attack?: boolean;
  battle?: boolean;
  toM2?: boolean;
  recall?: "yes" | "no";
};

function choose(prompt: DuelPrompt, code: number, policy: Policy): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    const count = prompt.min ?? 1;
    return { selected: prompt.options.slice(0, count).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (policy.recall === "yes") return { choice: "yes" };
      if (policy.recall === "no") return { choice: "no" };
      if (prompt.cancelable) return { cancel: true };
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

const { north, south, axeRaider } = loadDecks();
const game = await createEngineGame({
  mode: "domain",
  decks: [north, south],
  seed: SEED,
  dataDirectory,
});

try {
  const opening = game.view(0);
  const first = opening.turnSeat;
  const second = 1 - first;
  assert.equal(opening.seats[0].deckMaster?.card.code, axeRaider);
  assert.equal(opening.seats[1].deckMaster?.card.code, axeRaider);
  assert.equal(opening.seats[0].deckMaster?.inZone, true);
  assert.equal(opening.seats[1].deckMaster?.inZone, true);
  assert.equal(opening.seats[0].deckMaster?.returns, 0);
  assert.equal(opening.seats[0].deckMaster?.nextCost, 0);
  assert.equal(opening.seats[0].lp, 8000);
  assert.equal(opening.seats[1].lp, 8000);

  const play = (policy: Policy) => {
    const waiting = answering(game);
    if (!waiting) {
      if (game.view(0).result) throw new Error(`duel ended early: ${game.view(0).result?.reason}`);
      throw new Error("engine stopped without a prompt or result");
    }
    game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, policy));
    return game.view(0);
  };

  const until = (match: (view: DuelEngineView) => boolean, policy: Policy, label: string, limit = 80) => {
    let view = game.view(0);
    for (let step = 0; step < limit; step++) {
      if (match(view)) return view;
      view = play(policy);
    }
    const waiting = answering(game);
    throw new Error(`${label} timed out at ${waiting ? dump(waiting.prompt) : "no prompt"}`);
  };

  let view = until((current) => current.seats[first].deckMaster?.inZone === false, { summonDm: true }, "first free DMZ leave");
  assert.equal(view.seats[first].lp, 8000, "first DMZ leave must be free");
  assert.equal(view.seats[first].deckMaster?.nextCost, 0);

  view = until((current) => current.turnSeat === second, { summonDm: false }, "end first turn");
  view = until((current) => current.seats[second].deckMaster?.inZone === false, { summonDm: true }, "second free DMZ leave");
  assert.equal(view.seats[second].lp, 8000);

  view = until((current) => bothMastersInGrave(current, axeRaider), { battle: true, attack: true }, "equal-ATK crash to GY");
  assert.equal(view.seats[first].deckMaster?.inZone, false);
  assert.equal(view.seats[second].deckMaster?.inZone, false);
  assert.equal(inGrave(view, first, axeRaider), true, "first DM must actually be in GY");
  assert.equal(inGrave(view, second, axeRaider), true, "second DM must actually be in GY");

  let recalls = 0;
  for (let step = 0; step < 40 && recalls < 2; step++) {
    const waiting = answering(game);
    if (!waiting) throw new Error("lost prompt while waiting for dual recall");
    if (isYesNo(waiting.prompt)) {
      const before = game.view(0);
      assert.equal(bothMastersInGrave(before, axeRaider) || recalls === 1, true, "recall yes must be offered from GY");
      assert.equal(inGrave(before, waiting.seat, axeRaider) || before.seats[waiting.seat].deckMaster?.inZone === true, true);
      game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
      recalls += 1;
    } else {
      game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { battle: true, attack: true }));
    }
  }
  assert.equal(recalls, 2, "both owners must be offered recall in turn order");
  view = game.view(0);
  assert.equal(view.seats[first].deckMaster?.inZone, true);
  assert.equal(view.seats[second].deckMaster?.inZone, true);
  assert.equal(view.seats[first].deckMaster?.returns, 1);
  assert.equal(view.seats[second].deckMaster?.returns, 1);
  assert.equal(view.seats[first].deckMaster?.nextCost, 500);
  assert.equal(view.seats[second].deckMaster?.nextCost, 500);
  assert.equal(view.seats[first].lp, 8000);
  assert.equal(view.seats[second].lp, 8000);

  view = until((current) => current.seats[second].deckMaster?.inZone === false, { summonDm: true, toM2: true }, "second player taxed leave");
  assert.equal(view.seats[second].lp, 7500, "second leave pays 500 via PayLPCost");
  assert.equal(view.seats[second].deckMaster?.nextCost, 500);

  view = until((current) => current.turnSeat === first, { summonDm: false, toM2: true }, "end second turn");
  view = until((current) => current.seats[first].deckMaster?.inZone === false, { summonDm: true }, "first player taxed leave");
  assert.equal(view.seats[first].lp, 7500);

  view = until((current) => bothMastersInGrave(current, axeRaider), { battle: true, attack: true }, "second crash to GY");
  assert.equal(inGrave(view, first, axeRaider), true);
  assert.equal(inGrave(view, second, axeRaider), true);

  recalls = 0;
  for (let step = 0; step < 40 && recalls < 2; step++) {
    const waiting = answering(game);
    if (!waiting) throw new Error("lost prompt while waiting for second dual recall");
    if (isYesNo(waiting.prompt)) {
      const before = game.view(0);
      assert.equal(inGrave(before, 0, axeRaider) || before.seats[0].deckMaster?.inZone === true, true);
      assert.equal(inGrave(before, 1, axeRaider) || before.seats[1].deckMaster?.inZone === true, true);
      game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
      recalls += 1;
    } else {
      game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { battle: true, attack: true }));
    }
  }
  assert.equal(recalls, 2, "both owners recall after the second crash");
  view = game.view(0);
  assert.equal(view.seats[first].deckMaster?.inZone, true);
  assert.equal(view.seats[second].deckMaster?.inZone, true);
  assert.equal(view.seats[first].deckMaster?.returns, 2);
  assert.equal(view.seats[first].deckMaster?.nextCost, 1000);

  view = until((current) => current.seats[first].deckMaster?.inZone === false, { summonDm: true, toM2: true }, "repeat cost leave");
  assert.equal(view.seats[first].lp, 6500, "third leave pays 1000: 8000 -> 7500 -> 6500");
} finally {
  game.close();
}

console.log("domain-dmz-lifecycle: free summon, both GY, dual recall, 8000->7500->6500");
