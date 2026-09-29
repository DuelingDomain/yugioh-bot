import assert from "node:assert/strict";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const SEED = ["1", "2", "3", "4"];
const POS_FACEDOWN = 0xa;

function loadDecks(): { north: DuelDeck; south: DuelDeck; masterId: number; masterName: string } {
  const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
  const master = cdb
    .prepare("SELECT d.id AS id, d.race, d.attribute FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = 'Effect Veiler' AND d.alias = 0")
    .get() as { id: number; race: number; attribute: number } | undefined;
  assert(master, "Effect Veiler missing from cards.cdb");
  const masterName = "Effect Veiler";
  const mains = cdb
    .prepare(
      "SELECT id FROM datas WHERE type = 17 AND alias = 0 AND ot IN (1, 2, 3) AND (race = ? OR attribute = ?) AND id != ? ORDER BY level, atk DESC, id LIMIT 60",
    )
    .all(master.race, master.attribute, master.id) as { id: number }[];
  assert.equal(mains.length, 60, "need 60 domain-legal vanilla mains");
  cdb.close();
  const deck: DuelDeck = {
    main: mains.map((row) => row.id),
    extra: [],
    side: [],
    deckMaster: master.id,
  };
  validateDeck("domain", deck, dataDirectory);
  return {
    north: { ...deck, main: [...deck.main] },
    south: { ...deck, main: [...deck.main] },
    masterId: master.id,
    masterName,
  };
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

function choose(prompt: DuelPrompt, masterId: number, preferSet: boolean): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    const count = prompt.min ?? 1;
    return { selected: prompt.options.slice(0, count).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (prompt.cancelable) return { cancel: true };
      return { choice: "no" };
    }
    if (preferSet) {
      const mset = prompt.options.find((option) => option.id.startsWith("mset:") && option.card?.code === masterId);
      if (mset) return { choice: mset.id };
    }
    const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === masterId);
    if (summon) return { choice: summon.id };
    const toEp = prompt.options.find((option) => option.id === "to_ep");
    if (toEp) return { choice: "to_ep" };
    if (prompt.cancelable) return { cancel: true };
    assert(prompt.options[0], `empty choice prompt ${dump(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`Unplanned smoke prompt ${dump(prompt)}`);
}

const { north, south, masterId, masterName } = loadDecks();
const game = await createEngineGame({
  mode: "domain",
  decks: [north, south],
  seed: SEED,
  dataDirectory,
});

try {
  const opening = game.view(0);
  assert.equal(opening.seats[0].deckMaster?.inZone, true, "DM starts in DMZ");
  assert.equal(opening.seats[0].lp, 8000);
  const idle = opening.prompt;
  assert(idle, "opening idle prompt required");
  const summon = idle.options.find((option) => option.id.startsWith("summon:") && option.card?.code === masterId);
  const mset = idle.options.find((option) => option.id.startsWith("mset:") && option.card?.code === masterId);
  const activate = idle.options.find((option) => option.id.startsWith("activate:") && option.card?.code === masterId);
  const spsummon = idle.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === masterId);
  assert(summon, `${masterName} DM must expose normal summon from DMZ`);
  assert(mset, `${masterName} DM must expose monster set from DMZ`);
  assert.equal(activate, undefined, `${masterName} must not activate generic hand/ignition from DMZ`);
  assert.equal(spsummon, undefined, `${masterName} is not extra-type; no inherent spsummon from DMZ`);

  let setDone = false;
  for (let step = 0; step < 40; step++) {
    const next = answering(game);
    if (!next) break;
    const { seat, view, prompt } = next;
    if (view.seats[0].deckMaster?.inZone === false && view.seats[0].monsters.some((card) => card !== null && (card.position & POS_FACEDOWN) !== 0)) {
      setDone = true;
      if (prompt.kind === "choice" && prompt.options.some((option) => option.id === "to_ep")) {
        game.answer(seat, prompt.id, { choice: "to_ep" });
        break;
      }
    }
    game.answer(seat, prompt.id, choose(prompt, masterId, !setDone));
  }

  const after = game.view(0);
  assert.equal(after.seats[0].deckMaster?.inZone, false, "set leaves DMZ");
  assert.equal(after.seats[0].lp, 8000, "first leave is free");
  assert(
    after.seats[0].monsters.some((card) => card?.code === masterId && (card.position & POS_FACEDOWN) !== 0),
    "DM must occupy a monster zone face-down after mset",
  );
} finally {
  game.close();
}

console.log(`domain-ns-set-from-dmz: ${masterName} NS+mset from DMZ, no generic activate, first leave free`);
