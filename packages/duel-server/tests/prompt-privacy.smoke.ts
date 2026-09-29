import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const MST = 5318639;
const MIRROR_FORCE = 44095762;
const TORRENTIAL = 53582587;
const IDENTITY_LEAK = /Mirror Force|Torrential Tribute|44095762|53582587|declares an attack|Destroy all monsters/;

function answering(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

function dump(prompt: DuelPrompt): string {
  return `${prompt.kind} ${JSON.stringify(prompt.title)} [${prompt.options
    .map((option) => `${option.id}:${option.label}:code=${option.card?.code}:name=${option.card?.name}:loc=${option.controller}/${option.location}/${option.sequence}`)
    .join(" | ")}]`;
}

function setCount(view: DuelEngineView, seat: number): number {
  return view.seats[seat].spells.filter((card) => card != null && (card.position & 0x8) !== 0).length;
}

async function arrangeP1(p0: DuelDeck, p1: DuelDeck, wanted: number[]): Promise<DuelDeck> {
  const copy0: DuelDeck = { main: [...p0.main], extra: [...p0.extra], side: [...p0.side] };
  const copy1: DuelDeck = { main: [...p1.main], extra: [...p1.extra], side: [...p1.side] };
  const probe = await createEngineGame({ mode: "normal", decks: [copy0, copy1], seed, dataDirectory });
  try {
    const slots = probe.view(1).seats[1].hand.map((card) => copy1.main.indexOf(card.code!));
    wanted.forEach((code, index) => {
      const from = copy1.main.indexOf(code);
      const to = slots[index];
      assert.ok(from >= 0 && to != null, `cannot arrange ${code} into P1 hand`);
      [copy1.main[from], copy1.main[to]] = [copy1.main[to], copy1.main[from]];
    });
  } finally {
    probe.close();
  }
  return copy1;
}

function choose(prompt: DuelPrompt, seat: number, view: DuelEngineView): DuelAnswer {
  const sets = setCount(view, 1);
  if (prompt.kind === "places") {
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "cards" || prompt.kind === "tribute" || prompt.kind === "toggle") {
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (prompt.options.some((option) => option.id === "yes") && prompt.options.some((option) => option.id === "no")) {
      if (prompt.cancelable) return { cancel: true };
      return { choice: "no" };
    }
    if (seat === 1 && sets < 2) {
      const sset = prompt.options.find((option) => option.id.startsWith("sset:"));
      if (sset) return { choice: sset.id };
    }
    if (seat === 0 && sets >= 2) {
      const mst = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === MST);
      if (mst) return { choice: mst.id };
    }
    const toEp = prompt.options.find((option) => option.id === "to_ep");
    if (toEp) return { choice: "to_ep" };
    if (prompt.cancelable) return { cancel: true };
    assert.ok(prompt.options[0], `empty choice ${dump(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`unplanned ${dump(prompt)}`);
}

const db = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
const vanillas = (db.prepare("SELECT id FROM datas WHERE type=17 AND alias=0 AND (ot&3)!=0 ORDER BY id").all() as { id: number }[])
  .map((row) => row.id)
  .filter((id) => id !== MST);
db.close();

const p0: DuelDeck = { main: Array.from({ length: 40 }, () => MST), extra: [], side: [] };
const p1base: DuelDeck = { main: [MIRROR_FORCE, TORRENTIAL, ...vanillas.slice(0, 38)], extra: [], side: [] };
const p1 = await arrangeP1(p0, p1base, [MIRROR_FORCE, TORRENTIAL]);

const game = await createEngineGame({ mode: "normal", decks: [p0, p1], seed, dataDirectory });
try {
  let seen = false;
  for (let step = 0; step < 80; step++) {
    const next = answering(game);
    assert.ok(next, "engine stopped before MST target selection");
    const { seat, view, prompt } = next;
    const hiddenTargets =
      (prompt.kind === "cards" || prompt.kind === "toggle" || prompt.kind === "tribute") &&
      prompt.options.filter((option) => option.controller === 1 && option.location === OcgLocation.SZONE).length >= 2;
    if (hiddenTargets) {
      const serialized = JSON.stringify(prompt);
      assert.equal(prompt.kind, "cards");
      assert.deepEqual(
        prompt.options.map((option) => option.id),
        ["card:0", "card:1"],
      );
      assert.deepEqual(
        prompt.options.map((option) => [option.controller, option.location, option.sequence]),
        [
          [1, OcgLocation.SZONE, 0],
          [1, OcgLocation.SZONE, 1],
        ],
      );
      assert.equal(
        prompt.options.every((option) => option.card == null && option.label === "Face-down card"),
        true,
      );
      assert.equal(IDENTITY_LEAK.test(serialized), false, `hidden target prompt leaked identity: ${serialized}`);
      assert.equal(view.seats[1].spells[0]?.code, undefined);
      assert.equal(view.seats[1].spells[1]?.code, undefined);
      game.answer(seat, prompt.id, { selected: [prompt.options[0]!.id] });
      const after = answering(game);
      assert.ok(after, "answering by opaque index must be legal");
      seen = true;
      break;
    }
    game.answer(seat, prompt.id, choose(prompt, seat, view));
  }
  assert.equal(seen, true, "never reached MST target selection");
} finally {
  game.close();
}

console.log("prompt-privacy: MST hidden set targets redact identity and remain selectable by index");
