import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const CYCLE_ID = 888111020;
const LEAVE_GY_ID = 888111021;
const overlays: string[] = [];

afterEach(() => {
  for (const dir of overlays.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

function inGrave(view: DuelEngineView, seat: number, code: number): boolean {
  return view.seats[seat].graveyard.some((card) => card.code === code);
}

type Policy = { summonDm?: boolean; attack?: boolean; battle?: boolean; toM2?: boolean; recall?: "yes" | "no"; activate?: number };

function choose(prompt: DuelPrompt, code: number, policy: Policy): DuelAnswer {
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (isYesNo(prompt)) {
      if (policy.recall === "yes") return { choice: "yes" };
      return { choice: "no" };
    }
    if (policy.activate != null) {
      const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === policy.activate);
      if (activation) return { choice: activation.id };
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
    assert(prompt.options[0], `empty choice ${dump(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`Unplanned recall-kind prompt ${dump(prompt)}`);
}

function insertCard(
  db: InstanceType<typeof Database>,
  id: number,
  name: string,
  desc: string,
  type: number,
  race = 0,
  attribute = 0,
): void {
  db.prepare(
    "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, 3, 0, 0, ?, 0, 0, 1, ?, ?, 0)",
  ).run(id, type, race, attribute);
  db.prepare(
    "INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16) VALUES (?, ?, ?, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '')",
  ).run(id, name, desc);
}

function makeOverlay(scripts: Array<{ id: number; lua: string; name: string; desc: string; type: number; race?: number; attribute?: number }>): string {
  const root = mkdtempSync(join(tmpdir(), "domain-recall-"));
  overlays.push(root);
  copyFileSync(join(dataDirectory, "cards.cdb"), join(root, "cards.cdb"));
  symlinkSync(join(dataDirectory, "strings.conf"), join(root, "strings.conf"));
  const wasm = join(dataDirectory, "ocgcore.domain.wasm");
  assert(existsSync(wasm), `ocgcore.domain.wasm is missing under ${dataDirectory}`);
  symlinkSync(wasm, join(root, "ocgcore.domain.wasm"));
  mkdirSync(join(root, "card-scripts"));
  execFileSync("cp", ["-as", join(dataDirectory, "card-scripts") + "/.", join(root, "card-scripts")]);
  const db = new Database(join(root, "cards.cdb"));
  for (const script of scripts) {
    writeFileSync(join(root, "card-scripts", `c${script.id}.lua`), script.lua);
    insertCard(db, script.id, script.name, script.desc, script.type, script.race ?? 0, script.attribute ?? 0);
  }
  db.close();
  return root;
}

function loadAxeDeck(catalog: string, extraMain: number[] = []): { deck: DuelDeck; axeRaider: number } {
  const cdb = new Database(join(catalog, "cards.cdb"), { readonly: true });
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
  const wanted = extraMain.filter((code) => code !== master.id);
  const deck: DuelDeck = {
    main: [...wanted, ...mains.map((row) => row.id).filter((id) => !wanted.includes(id)).slice(0, 60 - wanted.length)],
    extra: [],
    side: [],
    deckMaster: master.id,
  };
  return { deck, axeRaider: master.id };
}

async function arrangeWanted(catalog: string, deck: DuelDeck, wanted: number[]): Promise<DuelDeck> {
  const copy: DuelDeck = { main: [...deck.main], extra: [...deck.extra], side: [...deck.side], deckMaster: deck.deckMaster };
  const probe = await createEngineGame({ mode: "domain", decks: [copy, copy], seed, dataDirectory: catalog });
  const slots = probe.view(0).seats[0].hand.map((card) => copy.main.indexOf(card.code!));
  probe.close();
  wanted.forEach((code, index) => {
    const from = copy.main.indexOf(code);
    const to = slots[index];
    assert(from >= 0 && to != null, `cannot arrange ${code} into opening hand`);
    [copy.main[from], copy.main[to]] = [copy.main[to]!, copy.main[from]!];
  });
  return copy;
}


async function crashBothIntoGrave(game: EngineGame, axeRaider: number): Promise<{ first: number; second: number }> {
  const opening = game.view(0);
  const first = opening.turnSeat;
  const second = 1 - first;
  const play = (policy: Policy) => {
    const waiting = answering(game);
    assert(waiting, "engine stopped without a prompt");
    game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, policy));
    return game.view(0);
  };
  let view = game.view(0);
  for (let step = 0; step < 80 && view.seats[first].deckMaster?.inZone; step++) view = play({ summonDm: true });
  for (let step = 0; step < 40 && view.turnSeat === first; step++) view = play({});
  for (let step = 0; step < 80 && view.seats[second].deckMaster?.inZone; step++) view = play({ summonDm: true });
  for (let step = 0; step < 80 && !(inGrave(view, first, axeRaider) && inGrave(view, second, axeRaider)); step++) {
    view = play({ battle: true, attack: true });
  }
  assert.equal(inGrave(view, first, axeRaider), true);
  assert.equal(inGrave(view, second, axeRaider), true);
  return { first, second };
}

describe("domain recall zone-kind transitions", () => {
  it("re-offers recall after GY→banish→GY within a chain, even if the final location matches last open GY", async () => {
    const overlay = makeOverlay([
      {
        id: CYCLE_ID,
        name: "Domain Grave Cycle Probe",
        desc: "Test fixture.",
        type: 2,
        lua: `-- Domain GY-banish-GY probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetOperation(function(e,tp)
		local g=Duel.GetMatchingGroup(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)
		if #g==0 then return end
		Duel.Remove(g,POS_FACEUP,REASON_EFFECT)
		Duel.SendtoGrave(g,REASON_EFFECT)
	end)
	c:RegisterEffect(e1)
end
`,
      },
    ]);
    const loaded = loadAxeDeck(overlay, [CYCLE_ID]);
    const deck = await arrangeWanted(overlay, loaded.deck, [CYCLE_ID]);
    const axeRaider = loaded.axeRaider;
    const game = await createEngineGame({ mode: "domain", decks: [deck, { ...deck, main: [...deck.main] }], seed, dataDirectory: overlay });
    try {
      const { first } = await crashBothIntoGrave(game, axeRaider);
      let declines = 0;
      for (let step = 0; step < 40 && declines < 2; step++) {
        const waiting = answering(game);
        assert(waiting, "lost prompt while declining recall");
        if (isYesNo(waiting.prompt)) {
          game.answer(waiting.seat, waiting.prompt.id, { choice: "no" });
          declines += 1;
        } else {
          game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { toM2: true }));
        }
      }
      expect(declines).toBe(2);

      let activated = false;
      for (let step = 0; step < 40; step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while seeking grave-cycle activate");
        if (isYesNo(waiting.prompt)) {
          throw new Error(`decline must consume recall until a zone-type change: ${dump(waiting.prompt)}`);
        }
        const cycle = waiting.prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === CYCLE_ID);
        if (cycle) {
          game.answer(waiting.seat, waiting.prompt.id, { choice: cycle.id });
          activated = true;
          break;
        }
        game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { toM2: true }));
      }
      expect(activated).toBe(true);

      let offered = false;
      for (let step = 0; step < 20; step++) {
        const waiting = answering(game);
        assert(waiting, "prompt after GY cycle");
        if (isYesNo(waiting.prompt)) {
          offered = true;
          expect(inGrave(game.view(0), waiting.seat, axeRaider)).toBe(true);
          game.answer(waiting.seat, waiting.prompt.id, { choice: "no" });
          break;
        }
        game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { toM2: true }));
      }
      expect(offered).toBe(true);
      expect(game.view(0).seats[first].deckMaster?.inZone).toBe(false);
    } finally {
      game.close();
    }
  });

  it("raises leave-GY when a Deck Master is recalled from the GY", async () => {
    const overlay = makeOverlay([
      {
        id: LEAVE_GY_ID,
        name: "Domain Leave Grave Probe",
        desc: "Test fixture.",
        type: 0x21,
        race: 1,
        attribute: 1,
        lua: `-- Domain leave-GY probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
	e1:SetCode(EVENT_LEAVE_GRAVE)
	e1:SetProperty(EFFECT_FLAG_DELAY)
	e1:SetRange(LOCATION_HAND)
	e1:SetCondition(function(e,tp,eg) return eg:IsExists(Card.IsControler,1,nil,tp) end)
	e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
		if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false) end
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)
	end)
	e1:SetOperation(function(e,tp)
		local c=e:GetHandler()
		if c:IsRelateToEffect(e) then Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP) end
	end)
	c:RegisterEffect(e1)
end
`,
      },
    ]);
    const loaded = loadAxeDeck(overlay, [LEAVE_GY_ID]);
    const deck = await arrangeWanted(overlay, loaded.deck, [LEAVE_GY_ID]);
    const axeRaider = loaded.axeRaider;
    const game = await createEngineGame({ mode: "domain", decks: [deck, { ...deck, main: [...deck.main] }], seed, dataDirectory: overlay });
    try {
      await crashBothIntoGrave(game, axeRaider);
      let recalled = 0;
      let sawLeaveGy = false;
      for (let step = 0; step < 50 && (recalled < 2 || !sawLeaveGy); step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while recalling from GY");
        if (isYesNo(waiting.prompt)) {
          if (waiting.prompt.options.some((option) => option.card?.code === LEAVE_GY_ID)) {
            sawLeaveGy = true;
            game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
            continue;
          }
          game.answer(waiting.seat, waiting.prompt.id, { choice: "yes" });
          recalled += 1;
          continue;
        }
        const chain = waiting.prompt.options.find((option) => option.card?.code === LEAVE_GY_ID);
        if (chain) {
          sawLeaveGy = true;
          game.answer(waiting.seat, waiting.prompt.id, waiting.prompt.kind === "choice" ? { choice: chain.id } : { selected: [chain.id] });
          continue;
        }
        game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, axeRaider, { toM2: true }));
      }
      expect(recalled).toBeGreaterThanOrEqual(1);
      expect(sawLeaveGy).toBe(true);
    } finally {
      game.close();
    }
  });
});
