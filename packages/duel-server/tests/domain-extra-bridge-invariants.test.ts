import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const originData = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const NESTED_ID = 888111001;
const ERROR_ID = 888111002;
const PROOF_LEAK_ID = 888111003;
const overlays: string[] = [];

const nestedScript = `-- Domain bridge nested-EXTRA probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(s.activate)
	c:RegisterEffect(e1)
end
function s.filter(c,e,tp)
	local nested=Duel.GetMatchingGroupCount(function(cc)
		return cc:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false)
	end,tp,LOCATION_EXTRA,0,nil)
	return c:IsType(TYPE_FUSION) and c:GetLevel()<=5 and Duel.GetLocationCountFromEx(tp,tp,nil,c)>0
		and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false) and c:CheckFusionMaterial() and nested==0
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_EXTRA,0,1,nil,e,tp) end
	Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_EXTRA,0,1,1,nil,e,tp)
	local tc=g:GetFirst()
	if not tc then return end
	tc:SetMaterial(nil)
	if Duel.SpecialSummon(tc,SUMMON_TYPE_FUSION,tp,tp,false,false,POS_FACEUP)~=0 then
		tc:CompleteProcedure()
	end
end
`;

const errorScript = `-- Domain bridge filter-error probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(function() end)
	c:RegisterEffect(e1)
end
function s.filter(c,e,tp)
	error("domain-bridge-probe")
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_EXTRA,0,1,nil,e,tp) end
end
`;

const proofLeakScript = `-- Domain bridge nested-proof probe (test fixture, not an official card)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(function() end)
	c:RegisterEffect(e1)
end
function s.filter(c,e,tp)
	Duel.GetMatchingGroup(function(cc)
		c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false)
		return false
	end,tp,LOCATION_HAND,0,nil)
	return c:IsType(TYPE_FUSION) and c:GetLevel()<=5 and Duel.GetLocationCountFromEx(tp,tp,nil,c)>0
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_EXTRA,0,1,nil,e,tp) end
end
`;

function insertSpell(db: InstanceType<typeof Database>, id: number, name: string, desc: string): void {
  db.prepare(
    "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, 3, 0, 0, 2, 0, 0, 0, 0, 0, 0)",
  ).run(id);
  db.prepare(
    "INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16) VALUES (?, ?, ?, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '')",
  ).run(id, name, desc);
}

function makeOverlay(): string {
  const root = mkdtempSync(join(tmpdir(), "domain-bridge-"));
  overlays.push(root);
  copyFileSync(join(originData, "cards.cdb"), join(root, "cards.cdb"));
  symlinkSync(join(originData, "strings.conf"), join(root, "strings.conf"));
  const wasm = join(originData, "ocgcore.domain.wasm");
  assert(existsSync(wasm), `ocgcore.domain.wasm is missing under ${originData}`);
  symlinkSync(wasm, join(root, "ocgcore.domain.wasm"));
  mkdirSync(join(root, "card-scripts"));
  execFileSync("cp", ["-as", join(originData, "card-scripts") + "/.", join(root, "card-scripts")]);
  writeFileSync(join(root, "card-scripts", `c${NESTED_ID}.lua`), nestedScript);
  writeFileSync(join(root, "card-scripts", `c${ERROR_ID}.lua`), errorScript);
  writeFileSync(join(root, "card-scripts", `c${PROOF_LEAK_ID}.lua`), proofLeakScript);
  const db = new Database(join(root, "cards.cdb"));
  insertSpell(db, NESTED_ID, "Domain Nested Extra Count", "Test fixture: nested EXTRA count during DM trial must stay 0.");
  insertSpell(db, ERROR_ID, "Domain Filter Error Probe", "Test fixture: EXTRA filter always errors.");
  insertSpell(db, PROOF_LEAK_ID, "Domain Nested Proof Leak", "Test fixture: nested callback must not prove outer DM.");
  db.close();
  return root;
}

function cardId(db: InstanceType<typeof Database>, name: string): number {
  const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as
    | { id: number }
    | undefined;
  assert(row, `Missing pinned card: ${name}`);
  return row.id;
}

function domainDeck(dataDirectory: string, master: number, wanted: number[]): DuelDeck {
  const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
  const fillers = (
    db
      .prepare(
        "SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id",
      )
      .all() as { id: number }[]
  ).map((row) => row.id);
  db.close();
  const mainWanted = wanted.filter((code) => code !== master);
  const deck: DuelDeck = {
    main: [...mainWanted, ...fillers.filter((code) => !mainWanted.includes(code) && code !== master).slice(0, 60 - mainWanted.length)],
    extra: [],
    side: [],
    deckMaster: master,
  };
  validateDeck("domain", deck, dataDirectory);
  return deck;
}

async function arrangeWanted(dataDirectory: string, deck: DuelDeck, wanted: number[]): Promise<DuelDeck> {
  const copy: DuelDeck = { main: [...deck.main], extra: [...deck.extra], side: [...deck.side], deckMaster: deck.deckMaster };
  const probe = await createEngineGame({ mode: "domain", decks: [copy, copy], seed, dataDirectory });
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

afterEach(() => {
  while (overlays.length > 0) {
    const root = overlays.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("domain extra-bridge trial isolation (canonical data lua/wasm; fixture cards are not official coverage)", () => {
  it("nested EXTRA matching during a DM trial does not count the DM as extra", async () => {
    const dataDirectory = makeOverlay();
    const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    db.close();
    const deck = await arrangeWanted(dataDirectory, domainDeck(dataDirectory, master, [NESTED_ID]), [NESTED_ID]);
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      const activation = idle.options.find((option) => option.id.startsWith("activate:") && option.card?.code === NESTED_ID);
      assert(activation, "nested-count spell must remain activatable when extra is empty");
      for (let step = 0; step < 20 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const prompt = game.view(0).prompt;
        assert(prompt, "prompt while nested-count spell summons");
        let answer: DuelAnswer;
        if (prompt.kind === "choice") {
          const activate = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === NESTED_ID);
          if (activate) answer = { choice: activate.id };
          else if (prompt.options.some((option) => option.id === "no")) answer = { choice: "no" };
          else {
            const faceUp = prompt.options.find((option) => option.id === "pos:1" || /attack/i.test(option.label));
            answer = { choice: (faceUp ?? prompt.options[0]).id };
          }
        } else if (prompt.kind === "cards" || prompt.kind === "places") {
          const preferred = prompt.options.find((option) => option.card?.code === master) ?? prompt.options[0];
          answer = { selected: [preferred.id] };
        } else if (prompt.cancelable) {
          answer = { cancel: true };
        } else {
          answer = { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
        }
        game.answer(0, prompt.id, answer);
      }
      const seat = game.view(0).seats[0];
      expect(seat.monsters.some((card) => card?.code === master)).toBe(true);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.extra).toHaveLength(0);
    } finally {
      game.close();
    }
  });

  it("EXTRA filter errors surface instead of treating the DM as silently ineligible", async () => {
    const dataDirectory = makeOverlay();
    const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    db.close();
    const deck = await arrangeWanted(dataDirectory, domainDeck(dataDirectory, master, [ERROR_ID]), [ERROR_ID]);
    let thrown: unknown;
    let game: EngineGame | undefined;
    try {
      game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
      game.view(0);
    } catch (error) {
      thrown = error;
    } finally {
      game?.close();
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toMatch(/domain-bridge-probe/);
  });

  it("nested matching callback cannot prove the outer DM via closed-over IsCanBeSpecialSummoned", async () => {
    const dataDirectory = makeOverlay();
    const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    db.close();
    const deck = await arrangeWanted(dataDirectory, domainDeck(dataDirectory, master, [PROOF_LEAK_ID]), [PROOF_LEAK_ID]);
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(idle.options.filter((option) => option.id.startsWith("activate:") && option.card?.code === PROOF_LEAK_ID)).toHaveLength(0);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
    } finally {
      game.close();
    }
  });
});
