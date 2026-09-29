import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Isolated pre-fix probe (do not modify the bundle):
//   DUEL_DATA_DIR=$PWD/data/duel-preview.ORd5RP/duel-engine npx tsx packages/duel-server/tests/domain-tax-reservation.smoke.ts
// Parent isolated rebuild then same probe:
//   DOMAIN_CORE_BUILD=docker DUEL_DATA_DIR=$PWD/data/duel-preview.ORd5RP/duel-engine npx tsx packages/duel-server/scripts/build-domain-core.ts

const dataDirectory = engineDataDirectory;
const SEED = ["1", "2", "3", "4"];
const SET_LP_ID = 888111020;
const overlay = mkdtempSync(join(tmpdir(), "domain-tax-res-"));

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

function bothMastersInGrave(view: DuelEngineView, code: number): boolean {
  return [0, 1].every(
    (seat) => view.seats[seat].deckMaster?.inZone === false && view.seats[seat].graveyard.some((card) => card.code === code),
  );
}

function optionOf(prompt: DuelPrompt, prefix: string, code: number) {
  return prompt.options.find((option) => option.id.startsWith(prefix) && option.card?.code === code);
}

function insertSpell(db: InstanceType<typeof Database>, id: number, name: string, desc: string): void {
  db.prepare(
    "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0)",
  ).run(id);
  db.prepare(
    "INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16) VALUES (?, ?, ?, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '')",
  ).run(id, name, desc);
}

copyFileSync(join(dataDirectory, "cards.cdb"), join(overlay, "cards.cdb"));
symlinkSync(join(dataDirectory, "strings.conf"), join(overlay, "strings.conf"));
const wasm = join(dataDirectory, "ocgcore.domain.wasm");
assert(existsSync(wasm), `ocgcore.domain.wasm is missing under ${dataDirectory}`);
symlinkSync(wasm, join(overlay, "ocgcore.domain.wasm"));
mkdirSync(join(overlay, "card-scripts"));
execFileSync("cp", ["-as", join(dataDirectory, "card-scripts") + "/.", join(overlay, "card-scripts")]);
writeFileSync(
  join(overlay, "card-scripts", `c${SET_LP_ID}.lua`),
  `-- Domain LP setter (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetOperation(function(e,tp) Duel.SetLP(tp,750) end)
	c:RegisterEffect(e1)
end
`,
);
{
  const db = new Database(join(overlay, "cards.cdb"));
  insertSpell(db, SET_LP_ID, "Domain LP Setter", "Test fixture: set LP to 750.");
  db.close();
}

const cdb = new Database(join(overlay, "cards.cdb"), { readonly: true });
const axe = cdb.prepare("SELECT d.id AS id FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = 'Axe Raider' AND d.alias = 0").get() as
  | { id: number }
  | undefined;
assert(axe, "Axe Raider missing");
const vanillas = cdb
  .prepare(
    "SELECT id FROM datas WHERE type = 17 AND alias = 0 AND ot IN (1, 2, 3) AND (race = 1 OR attribute = 1) AND id != ? ORDER BY level, atk DESC, id LIMIT 60",
  )
  .all(axe.id) as { id: number }[];
assert.equal(vanillas.length, 60, "need 60 domain-legal vanilla mains");
cdb.close();

const south: DuelDeck = { main: vanillas.map((row) => row.id), extra: [], side: [], deckMaster: axe.id };
const north: DuelDeck = {
  main: [SET_LP_ID, ...vanillas.map((row) => row.id).slice(0, 59)],
  extra: [],
  side: [],
  deckMaster: axe.id,
};
validateDeck("domain", north, overlay);
validateDeck("domain", south, overlay);

async function arrangeSetLp(deck: DuelDeck): Promise<DuelDeck> {
  const copy: DuelDeck = { main: [...deck.main], extra: [...deck.extra], side: [...deck.side], deckMaster: deck.deckMaster };
  const probe = await createEngineGame({ mode: "domain", decks: [copy, south], seed: SEED, dataDirectory: overlay });
  const slots = probe.view(0).seats[0].hand.map((card) => copy.main.indexOf(card.code!));
  probe.close();
  const from = copy.main.indexOf(SET_LP_ID);
  const to = slots[0];
  assert(from >= 0 && to != null, "cannot arrange SetLP into opening hand");
  [copy.main[from], copy.main[to]] = [copy.main[to], copy.main[from]];
  return copy;
}

type Policy = {
  summonDm?: boolean;
  attack?: boolean;
  battle?: boolean;
  toM2?: boolean;
  activate?: number;
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
    if (policy.activate != null) {
      const activation = optionOf(prompt, "activate:", policy.activate);
      if (activation) return { choice: activation.id };
    }
    if (policy.summonDm) {
      const summon = optionOf(prompt, "summon:", code);
      if (summon) return { choice: summon.id };
    }
    if (policy.attack) {
      const attack = prompt.options.find((option) => option.id.startsWith("attack:"));
      if (attack) return { choice: attack.id };
    }
    if (policy.battle) {
      const toBp = prompt.options.find((option) => option.id === "to_bp");
      if (toBp) return { choice: toBp.id };
    }
    if (policy.toM2) {
      const toM2 = prompt.options.find((option) => option.id === "to_m2");
      if (toM2) return { choice: toM2.id };
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

function reportIdle(label: string, view: DuelEngineView, code: number) {
  const prompt = view.prompt;
  assert(prompt, `${label}: missing prompt`);
  const summon = optionOf(prompt, "summon:", code);
  const mset = optionOf(prompt, "mset:", code);
  console.log(
    `${label}: lp=${view.seats[0].lp} returns=${view.seats[0].deckMaster?.returns} nextCost=${view.seats[0].deckMaster?.nextCost} summon=${Boolean(summon)} mset=${Boolean(mset)} prompt=${dump(prompt)}`,
  );
  return { summon, mset };
}

const arranged = await arrangeSetLp(north);
const game = await createEngineGame({
  mode: "domain",
  decks: [arranged, south],
  seed: SEED,
  dataDirectory: overlay,
});

try {
  const opening = game.view(0);
  const first = opening.turnSeat;
  const second = 1 - first;
  assert.equal(opening.seats[0].deckMaster?.inZone, true);
  assert.equal(opening.seats[0].lp, 8000);
  assert(optionOf(opening.prompt!, "activate:", SET_LP_ID), "SetLP must open in seat 0 hand");

  const play = (policy: Policy) => {
    const waiting = answering(game);
    if (!waiting) {
      if (game.view(0).result) throw new Error(`duel ended early: ${game.view(0).result?.reason}`);
      throw new Error("engine stopped without a prompt or result");
    }
    game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axe.id, policy));
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

  until((current) => current.seats[first].deckMaster?.inZone === false, { summonDm: true }, "first free DMZ leave");
  until((current) => current.turnSeat === second, { summonDm: false }, "end first turn");
  until((current) => current.seats[second].deckMaster?.inZone === false, { summonDm: true }, "second free DMZ leave");
  until((current) => bothMastersInGrave(current, axe.id), { battle: true, attack: true }, "equal-ATK crash to GY");

  let recalls = 0;
  for (let step = 0; step < 40 && recalls < 2; step++) {
    const waiting = answering(game);
    if (!waiting) throw new Error("lost prompt while waiting for dual recall");
    if (isYesNo(waiting.prompt)) {
      game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
      recalls += 1;
    } else {
      game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axe.id, { battle: true, attack: true }));
    }
  }
  assert.equal(recalls, 2, "both owners must recall");
  let view = game.view(0);
  assert.equal(view.seats[0].deckMaster?.inZone, true);
  assert.equal(view.seats[0].deckMaster?.nextCost, 500);
  assert.equal(view.seats[0].lp, 8000);

  until(
    (current) =>
      current.turnSeat === 0 &&
      current.seats[0].deckMaster?.inZone === true &&
      current.seats[0].deckMaster?.nextCost === 500 &&
      Boolean(current.prompt && optionOf(current.prompt, "activate:", SET_LP_ID)),
    { summonDm: false, toM2: true },
    "seat 0 main with SetLP after recall",
  );

  view = until((current) => current.seats[0].lp === 750, { activate: SET_LP_ID }, "SetLP to 750");
  assert.equal(view.seats[0].deckMaster?.inZone, true);
  assert.equal(view.seats[0].deckMaster?.nextCost, 500);
  assert.equal(view.seats[0].lp, 750);

  view = until(
    (current) => current.turnSeat === 0 && Boolean(current.prompt && current.prompt.options.some((option) => option.id === "to_ep")),
    { summonDm: false },
    "idle after SetLP",
  );
  const firstIdle = reportIdle("idle-after-setlp", view, axe.id);
  assert(firstIdle.summon, "NS of DM must remain at 750 LP for a single 500 tax");
  assert(firstIdle.mset, "MSet of DM must remain at 750 LP for a single 500 tax");

  if (view.prompt?.options.some((option) => option.id === "to_bp")) {
    view = until((current) => Boolean(current.prompt && current.prompt.options.some((option) => option.id === "to_m2")), { battle: true }, "enter BP");
    view = until(
      (current) => current.turnSeat === 0 && current.prompt?.context?.type === "action" && current.prompt.context.phase === "main",
      { toM2: true },
      "main2 after BP",
    );
    const secondIdle = reportIdle("idle-after-recollect", view, axe.id);
    assert(secondIdle.summon, "repeated idle collection must not drop NS when LP covers one tax");
    assert(secondIdle.mset, "repeated idle collection must not drop MSet when LP covers one tax");
  }

  console.log("domain-tax-reservation: 750 LP / 500 tax still offers NS+MSet after recall and recollect");
} finally {
  game.close();
  rmSync(overlay, { recursive: true, force: true });
}
