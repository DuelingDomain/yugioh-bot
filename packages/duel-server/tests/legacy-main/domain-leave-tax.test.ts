// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/domain-leave-tax.test.ts from origin/main (78b8caa)
// with only the import paths changed: engine, views and prompts come from ../../src/legacy, the other sources from ../../src, and
// LEGACY-1V1 change in this file: the temporary data dir also links ocgcore.domain.legacy.wasm.
// the data dir helper from ../engine-data-dir.js. Do not edit it to make the legacy engine pass: the legacy engine must equal main. See legacy-1v1/README.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/legacy/engine.js";
import { validateDeck } from "../../src/deck-legality.js";
import { engineDataDirectory } from "../engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const COMBINED_ID = 888111010;
const SET_LP_ID = 888111020;
const overlays: string[] = [];

afterEach(() => {
  for (const dir of overlays.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cardId(db: InstanceType<typeof Database>, name: string): number {
  const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as
    | { id: number }
    | undefined;
  assert(row, `Missing pinned card: ${name}`);
  return row.id;
}

function spellFillers(db: InstanceType<typeof Database>): number[] {
  return (
    db
      .prepare(
        "SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id",
      )
      .all() as { id: number }[]
  ).map((row) => row.id);
}

function domainDeckFrom(
  db: InstanceType<typeof Database>,
  master: number,
  wanted: number[],
  extra: number[] = [],
  catalogDir = dataDirectory,
): DuelDeck {
  const fillers = spellFillers(db);
  const mainWanted = wanted.filter((code) => code !== master);
  const deck: DuelDeck = {
    main: [...mainWanted, ...fillers.filter((code) => !mainWanted.includes(code) && code !== master).slice(0, 60 - mainWanted.length)],
    extra,
    side: [],
    deckMaster: master,
  };
  validateDeck("domain", deck, catalogDir);
  return deck;
}

async function arrangeWanted(dir: string, deck: DuelDeck, wanted: number[]): Promise<DuelDeck> {
  const copy: DuelDeck = { main: [...deck.main], extra: [...deck.extra], side: [...deck.side], deckMaster: deck.deckMaster };
  const probe = await createEngineGame({ mode: "domain", decks: [copy, copy], seed, dataDirectory: dir });
  const slots = probe.view(0).seats[0].hand.map((card) => copy.main.indexOf(card.code!));
  probe.close();
  wanted.forEach((code, index) => {
    const from = copy.main.indexOf(code);
    const to = slots[index];
    assert(from >= 0 && to != null, `cannot arrange ${code} into opening hand`);
    [copy.main[from], copy.main[to]] = [copy.main[to], copy.main[from]];
  });
  return copy;
}

function answering(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
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

function optionCodes(prompt: DuelPrompt, prefix: string): number[] {
  return prompt.options.filter((option) => option.id.startsWith(prefix) && option.card?.code != null).map((option) => option.card!.code!);
}

type Drive = {
  activate?: number;
  select?: number;
  summon?: number;
  recall?: "yes" | "no";
  attack?: boolean;
  battle?: boolean;
  toM2?: boolean;
  endTurn?: boolean;
};

function choose(prompt: DuelPrompt, policy: Drive): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    const preferred = policy.select != null ? prompt.options.find((option) => option.card?.code === policy.select) : undefined;
    if (preferred) return { selected: [preferred.id] };
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (policy.recall === "yes") return { choice: "yes" };
      if (policy.recall === "no") return { choice: "no" };
      return { choice: "no" };
    }
    if (policy.activate != null) {
      const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === policy.activate);
      if (activation) return { choice: activation.id };
    }
    if (policy.summon != null) {
      const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === policy.summon);
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
    if (policy.endTurn) {
      const toEp = prompt.options.find((option) => option.id === "to_ep");
      if (toEp) return { choice: "to_ep" };
    }
    const faceUp = prompt.options.find((option) => option.id === "pos:1" || /attack/i.test(option.label));
    if (faceUp) return { choice: faceUp.id };
    if (prompt.cancelable) return { cancel: true };
    assert(prompt.options[0], `empty choice ${dump(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`Unplanned prompt ${dump(prompt)}`);
}

function play(game: EngineGame, policy: Drive): DuelEngineView {
  const waiting = answering(game);
  assert(waiting, "engine stopped without a prompt");
  game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, policy));
  return game.view(0);
}

function insertSpell(db: InstanceType<typeof Database>, id: number, name: string, desc: string): void {
  db.prepare(
    "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0)",
  ).run(id);
  db.prepare(
    "INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16) VALUES (?, ?, ?, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '')",
  ).run(id, name, desc);
}

function makeOverlay(script: string, scriptId: number): string {
  const root = mkdtempSync(join(tmpdir(), "domain-tax-"));
  overlays.push(root);
  copyFileSync(join(dataDirectory, "cards.cdb"), join(root, "cards.cdb"));
  symlinkSync(join(dataDirectory, "strings.conf"), join(root, "strings.conf"));
  const wasm = join(dataDirectory, "ocgcore.domain.wasm");
  assert(existsSync(wasm), `ocgcore.domain.wasm is missing under ${dataDirectory}`);
  symlinkSync(wasm, join(root, "ocgcore.domain.wasm"));
  symlinkSync(join(dataDirectory, "ocgcore.domain.legacy.wasm"), join(root, "ocgcore.domain.legacy.wasm")); // LEGACY-1V1: the legacy engine reads this file
  mkdirSync(join(root, "card-scripts"));
  execFileSync("cp", ["-as", join(dataDirectory, "card-scripts") + "/.", join(root, "card-scripts")]);
  writeFileSync(join(root, "card-scripts", `c${scriptId}.lua`), script);
  const db = new Database(join(root, "cards.cdb"));
  insertSpell(db, scriptId, "Domain Combined Cost Probe", "Test fixture.");
  db.close();
  return root;
}

describe("domain leave tax on proper effect summons", () => {
  it("Instant Fusion then Ready Fusion after recall pays 1000+500 (seed 1,2,3,4)", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    const instant = cardId(db, "Instant Fusion");
    const ready = cardId(db, "Ready Fusion");
    const deck = await arrangeWanted(dataDirectory, domainDeckFrom(db, master, [instant, ready]), [instant, ready]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(optionCodes(idle, "activate:")).toEqual(expect.arrayContaining([instant, ready]));

      for (let step = 0; step < 30 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        play(game, { activate: instant, select: master });
      }
      expect(game.view(0).seats[0].monsters.some((card) => card?.code === master)).toBe(true);
      expect(game.view(0).seats[0].lp).toBe(7000);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(false);
      expect(game.view(0).seats[0].deckMaster?.nextCost).toBe(0);

      for (let step = 0; step < 80 && !game.view(0).seats[0].graveyard.some((card) => card.code === master); step++) {
        play(game, { endTurn: true, recall: "yes" });
      }
      expect(game.view(0).seats[0].graveyard.some((card) => card.code === master) || game.view(0).seats[0].deckMaster?.inZone).toBe(true);

      for (let step = 0; step < 40 && !game.view(0).seats[0].deckMaster?.inZone; step++) {
        play(game, { recall: "yes", endTurn: true });
      }
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(game.view(0).seats[0].deckMaster?.returns).toBe(1);
      expect(game.view(0).seats[0].deckMaster?.nextCost).toBe(500);
      expect(game.view(0).seats[0].lp).toBe(7000);

      for (let step = 0; step < 40 && game.view(0).turnSeat !== 0; step++) {
        play(game, { endTurn: true, recall: "no" });
      }

      for (let step = 0; step < 30 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        play(game, { activate: ready, select: master });
      }
      const seat = game.view(0).seats[0];
      expect(seat.monsters.some((card) => card?.code === master)).toBe(true);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(5500);
    } finally {
      game.close();
    }
  });

  it("refuses Instant Fusion when 1000+tax exceeds remaining LP after a return", async () => {
    const overlay = makeOverlay(
      `-- Domain combined-cost probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetCost(s.cost)
	e1:SetTarget(s.target)
	e1:SetOperation(s.activate)
	c:RegisterEffect(e1)
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.CheckLPCost(tp,6600) end
	Duel.PayLPCost(tp,6600)
end
function s.filter(c,e,tp)
	return c:IsType(TYPE_FUSION) and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then
		return Duel.GetLocationCountFromEx(tp,tp,nil,TYPE_FUSION)>0
			and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_EXTRA,0,1,nil,e,tp)
	end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_EXTRA,0,1,1,nil,e,tp)
	if #g>0 then
		Duel.SpecialSummon(g,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP)
	end
end
`,
      COMBINED_ID,
    );
    const db = new Database(join(overlay, "cards.cdb"));
    const origin = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(origin, "Flame Swordsman");
    const instant = cardId(origin, "Instant Fusion");
    origin.close();
    const deck = await arrangeWanted(overlay, domainDeckFrom(db, master, [instant, COMBINED_ID], [], overlay), [instant, COMBINED_ID]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory: overlay });
    try {
      for (let step = 0; step < 30 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        play(game, { activate: instant, select: master });
      }
      expect(game.view(0).seats[0].lp).toBe(7000);
      for (let step = 0; step < 80 && !game.view(0).seats[0].deckMaster?.inZone; step++) {
        play(game, { endTurn: true, recall: "yes" });
      }
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(game.view(0).seats[0].deckMaster?.nextCost).toBe(500);
      expect(game.view(0).seats[0].lp).toBe(7000);
      for (let step = 0; step < 40 && game.view(0).turnSeat !== 0; step++) {
        play(game, { endTurn: true, recall: "no" });
      }
      const idle = game.view(0).prompt;
      assert(idle, "own turn idle after recall");
      expect(optionCodes(idle, "activate:")).not.toContain(COMBINED_ID);
      expect(game.view(0).seats[0].lp).toBe(7000);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
    } finally {
      game.close();
    }
  });
});

describe("domain leave tax reservation", () => {
  it("keeps NS and MSet after recall at 750 LP across repeated idle collections", async () => {
    const overlay = makeOverlay(
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
      SET_LP_ID,
    );
    const db = new Database(join(overlay, "cards.cdb"));
    const master = cardId(db, "Axe Raider");
    const north = await arrangeWanted(overlay, domainDeckFrom(db, master, [SET_LP_ID], [], overlay), [SET_LP_ID]);
    const south = domainDeckFrom(db, master, [], [], overlay);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [north, south], seed, dataDirectory: overlay });
    const until = (match: (view: DuelEngineView) => boolean, policy: Drive, limit = 80) => {
      let view = game.view(0);
      for (let step = 0; step < limit; step++) {
        if (match(view)) return view;
        view = play(game, policy);
      }
      throw new Error(`timed out at ${game.view(0).prompt ? dump(game.view(0).prompt!) : "no prompt"}`);
    };
    try {
      const opening = game.view(0);
      const first = opening.turnSeat;
      const second = 1 - first;
      expect(optionCodes(opening.prompt!, "activate:")).toContain(SET_LP_ID);

      until((current) => current.seats[first].deckMaster?.inZone === false, { summon: master });
      until((current) => current.turnSeat === second, { endTurn: true });
      until((current) => current.seats[second].deckMaster?.inZone === false, { summon: master });
      until(
        (current) =>
          [0, 1].every((seat) => current.seats[seat].deckMaster?.inZone === false && current.seats[seat].graveyard.some((card) => card.code === master)),
        { battle: true, attack: true },
      );

      let recalls = 0;
      for (let step = 0; step < 40 && recalls < 2; step++) {
        const waiting = answering(game);
        assert(waiting, "lost prompt while waiting for dual recall");
        if (isYesNo(waiting.prompt)) {
          game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
          recalls += 1;
        } else {
          play(game, { battle: true, attack: true });
        }
      }
      expect(recalls).toBe(2);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(game.view(0).seats[0].deckMaster?.nextCost).toBe(500);
      expect(game.view(0).seats[0].lp).toBe(8000);

      until(
        (current) =>
          current.turnSeat === 0 &&
          current.seats[0].deckMaster?.inZone === true &&
          current.seats[0].deckMaster?.nextCost === 500 &&
          Boolean(current.prompt && optionCodes(current.prompt, "activate:").includes(SET_LP_ID)),
        { endTurn: true, toM2: true },
      );
      until((current) => current.seats[0].lp === 750, { activate: SET_LP_ID });
      const idle = until(
        (current) => current.turnSeat === 0 && Boolean(current.prompt?.options.some((option) => option.id === "to_ep")),
        {},
      );
      expect(idle.seats[0].lp).toBe(750);
      expect(idle.seats[0].deckMaster?.nextCost).toBe(500);
      expect(optionCodes(idle.prompt!, "summon:")).toContain(master);
      expect(optionCodes(idle.prompt!, "mset:")).toContain(master);

      if (idle.prompt?.options.some((option) => option.id === "to_bp")) {
        until((current) => Boolean(current.prompt?.options.some((option) => option.id === "to_m2")), { battle: true });
        const again = until(
          (current) => current.turnSeat === 0 && current.prompt?.context?.type === "action" && current.prompt.context.phase === "main",
          { toM2: true },
        );
        expect(optionCodes(again.prompt!, "summon:")).toContain(master);
        expect(optionCodes(again.prompt!, "mset:")).toContain(master);
        expect(again.seats[0].lp).toBe(750);
      }
    } finally {
      game.close();
    }
  });
});

