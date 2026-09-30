import assert from "node:assert/strict";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const SEED = ["1", "2", "3", "4"];

function loadDecks(): { north: DuelDeck; south: DuelDeck; imduk: number } {
  const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
  const master = cdb
    .prepare("SELECT d.id AS id, d.race, d.attribute FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = 'Imduk the World Chalice Dragon' AND d.alias = 0")
    .get() as { id: number; race: number; attribute: number } | undefined;
  assert(master, "Imduk the World Chalice Dragon missing from cards.cdb");
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
  return { north: { ...deck, main: [...deck.main] }, south: { ...deck, main: [...deck.main] }, imduk: master.id };
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

function imdukOnField(view: DuelEngineView, imduk: number) {
  return view.seats[0].monsters.find((card) => card?.code === imduk);
}

function choose(prompt: DuelPrompt, imduk: number, linked: boolean): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    const count = prompt.min ?? 1;
    return { selected: prompt.options.slice(0, count).map((option) => option.id) };
  }
  if (prompt.kind === "toggle") {
    if (prompt.finishable) return { finish: true };
    const material = prompt.options.find((option) => !option.selected);
    assert(material, "Link summon requires a selectable material");
    return { choice: material.id };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (prompt.cancelable) return { cancel: true };
      return { choice: "no" };
    }
    const spsummon = prompt.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === imduk);
    if (spsummon) return { choice: spsummon.id };
    if (!linked) {
      const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code !== imduk);
      if (summon) return { choice: summon.id };
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

const { north, south, imduk } = loadDecks();
const game = await createEngineGame({
  mode: "domain",
  decks: [north, south],
  seed: SEED,
  dataDirectory,
});

try {
  const opening = game.view(0);
  assert.equal(opening.seats[0].deckMaster?.inZone, true, "Link DM starts in DMZ");
  assert.equal(opening.seats[0].lp, 8000);
  const idle = opening.prompt;
  assert(idle, "opening idle prompt required");
  assert.equal(
    idle.options.find((option) => option.id.startsWith("summon:") && option.card?.code === imduk),
    undefined,
    "extra-type Link DM cannot normal summon",
  );
  assert.equal(
    idle.options.find((option) => option.id.startsWith("mset:") && option.card?.code === imduk),
    undefined,
    "extra-type Link DM cannot mset",
  );
  assert.equal(
    idle.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === imduk),
    undefined,
    "Link DM is not spsummonable without a Normal Monster material",
  );
  assert.equal(
    idle.options.find((option) => option.id.startsWith("activate:") && option.card?.code === imduk),
    undefined,
    "Link DM must not activate generic effects from DMZ",
  );
  const material = idle.options.find((option) => option.id.startsWith("summon:") && option.card?.code !== imduk)?.card?.code;
  assert(material, "opening hand must expose a vanilla normal summon as Link material");

  let linked = false;
  for (let step = 0; step < 60; step++) {
    const next = answering(game);
    if (!next) break;
    const { seat, view, prompt } = next;
    if (imdukOnField(view, imduk)) {
      linked = true;
      if (prompt.kind === "choice" && prompt.options.some((option) => option.id === "to_ep")) {
        game.answer(seat, prompt.id, { choice: "to_ep" });
        break;
      }
    }
    game.answer(seat, prompt.id, choose(prompt, imduk, linked));
  }

  const after = game.view(0);
  const link = imdukOnField(after, imduk);
  assert(link, "Imduk must be properly Link Summoned from DMZ");
  assert.equal(after.seats[0].deckMaster?.inZone, false, "Link summon leaves DMZ");
  assert.equal(after.seats[0].lp, 8000, "first leave is free");
  assert(link.sequence === 5 || link.sequence === 6, `Link DM must occupy an Extra Monster Zone, got sequence ${link.sequence}`);
  assert.equal(
    after.seats[0].monsters.filter((card) => card !== null && card.code !== imduk).length,
    0,
    "Normal Monster material must leave the field for the Link Summon",
  );
  assert(after.seats[0].graveyard.some((card) => card.code === material), "the selected Normal Monster must be in the Graveyard");
} finally {
  game.close();
}

console.log("domain-link-from-dmz: Imduk Link Summon from DMZ into EMZ using a Normal Monster, first leave free");
