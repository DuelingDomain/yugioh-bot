// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/summons.test.ts from origin/main (09b4196a)
// with only the import paths changed: engine, views and prompts come from ../../src/legacy, the other sources from ../../src, and
// the data dir helper from ../engine-data-dir.js. Do not edit it to make the legacy engine pass: the legacy engine must equal main. See legacy-1v1/README.md.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelMode, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../../src/legacy/engine.js";
import { validateDeck } from "../../src/deck-legality.js";
import { engineDataDirectory as dataDirectory } from "../engine-data-dir.js";
import { materialCountScenarios, runMaterialCountScenario } from "./material-count-fixture.js";

const seed = ["1", "2", "3", "4"];

describe("stock-core summon methods", () => {
  it.each(materialCountScenarios)("reports $kind for $monster using real materials", async (scenario) => {
    const { event, completedView } = await runMaterialCountScenario(scenario);
    expect(event.summonKind).toBe(scenario.kind);
    const method = scenario.kind[0].toUpperCase() + scenario.kind.slice(1);
    expect(completedView.log.map((entry) => entry.text)).toContain(`Player 1 ${method} Summons ${scenario.monster}`);
  });
});

describe("proper effect summons", () => {
  it.each([
    { mode: "normal", master: "Paladin of White Dragon", spell: "White Dragon Ritual", materials: ["Alexandrite Dragon"] },
    { mode: "domain", master: "Paladin of White Dragon", spell: "White Dragon Ritual", materials: ["Alexandrite Dragon"] },
    { mode: "domain", master: "Flame Swordsman", spell: "Polymerization", materials: ["Flame Manipulator", "Masaki the Legendary Swordsman"] },
  ] as const)("summons $master in $mode using its spell and materials", async (scenario) => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const id = (name: string) => {
      const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as { id: number } | undefined;
      assert(row, `Missing pinned card: ${name}`);
      return row.id;
    };
    const master = id(scenario.master);
    const spell = id(scenario.spell);
    const materials = scenario.materials.map(id);
    const wanted = [spell, ...materials, ...(scenario.mode === "normal" ? [master] : [])];
    const fillers = (db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE (d.type&2)!=0 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id").all() as { id: number }[]).map((row) => row.id);
    db.close();
    const mode: DuelMode = scenario.mode;
    const deck: DuelDeck = {
      main: [...wanted, ...fillers.filter((code) => !wanted.includes(code)).slice(0, (mode === "domain" ? 60 : 40) - wanted.length)],
      extra: [], side: [], ...(mode === "domain" ? { deckMaster: master } : {}),
    };
    validateDeck(mode, deck, dataDirectory);
    // Use the real seeded shuffle, arranging only the fixture's opening cards.
    const probe = await createEngineGame({ mode, decks: [deck, deck], seed, dataDirectory });
    const slots = probe.view(0).seats[0].hand.map((card) => deck.main.indexOf(card.code!));
    probe.close();
    wanted.forEach((code, index) => {
      const from = deck.main.indexOf(code), to = slots[index];
      [deck.main[from], deck.main[to]] = [deck.main[to], deck.main[from]];
    });
    const game = await createEngineGame({ mode, decks: [deck, deck], seed, dataDirectory });
    try {
      for (let step = 0; step < 35 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const prompt = game.view(0).prompt;
        assert(prompt, "Summoning player must have a prompt");
        let answer: DuelAnswer;
        if (prompt.kind === "choice") {
          const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === spell);
          if (activation) answer = { choice: activation.id };
          else if (prompt.options.some((option) => option.id === "no")) answer = { choice: "no" };
          else {
            assert(!prompt.options.some((option) => option.id === "to_ep"), "The summon must be legal");
            answer = { choice: prompt.options[0].id };
          }
        } else if (prompt.kind === "toggle") {
          answer = prompt.finishable ? { finish: true } : { choice: prompt.options.find((option) => !option.selected)!.id };
        } else if (prompt.kind === "sum") {
          const material = prompt.options.find((option) => option.card?.code === materials[0]);
          assert(material, "Ritual material must be selectable");
          expect(material.values).toEqual([4]);
          expect(prompt.max).toBeGreaterThanOrEqual(1);
          answer = { selected: [material.id] };
        } else {
          answer = { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
        }
        game.answer(0, prompt.id, answer);
      }
      const seat = game.view(0).seats[0];
      const summoned = seat.monsters.find((card) => card?.code === master);
      expect(summoned?.code).toBe(master);
      expect(summoned!.sequence).toBeLessThan(5);
      expect(seat.graveyard.map((card) => card.code)).toEqual(expect.arrayContaining([spell, ...materials]));
      expect(seat.hand.some((card) => materials.includes(card.code!))).toBe(false);
      expect(seat.lp).toBe(8000);
      if (mode === "domain") expect(seat.deckMaster?.inZone).toBe(false);
      const summons = game.view(0).events.filter((event) => event.kind === "summon" && event.card?.code === master);
      expect(summons.at(-1)?.summonKind).toBe(scenario.spell === "Polymerization" ? "fusion" : "ritual");
      // The Text log names the method of a face-up summon, for every viewer, and the materials' trip to the Graveyard.
      const method = scenario.spell === "Polymerization" ? "Fusion" : "Ritual";
      for (const viewer of [0, 1, null]) {
        const lines = game.view(viewer).log.map((entry) => entry.text);
        expect(lines).toContain(`Player 1 ${method} Summons ${scenario.master}`);
        for (const material of scenario.materials) expect(lines).toContain(`${material} was sent to the Graveyard`);
        // The material lines sit directly above the summon line: the web Text log relies on that to colour them.
        const at = lines.indexOf(`Player 1 ${method} Summons ${scenario.master}`);
        expect(lines.slice(at - scenario.materials.length, at).sort()).toEqual(scenario.materials.map((material) => `${material} was sent to the Graveyard`).sort());
      }
    } finally {
      game.close();
    }
  });
});

function dumpPrompt(prompt: DuelPrompt): string {
  return `${prompt.kind} ${prompt.title} [${prompt.options.map((option) => `${option.id}:${option.label}`).join(" | ")}]`;
}

function pickSum(prompt: DuelPrompt, prefer: number[]): string[] {
  const target = prompt.target ?? 0;
  const min = prompt.min ?? 0;
  const max = prompt.max ?? prompt.options.length;
  const mandatory = new Set(prompt.mandatory ?? []);
  const must = prompt.options.filter((option) => mandatory.has(option.id) || option.id.startsWith("must:"));
  const optional = prompt.options.filter((option) => option.id.startsWith("card:"));
  const mustSum = must.reduce((sum, option) => sum + (option.values?.[0] ?? 0), 0);
  const remaining = target - mustSum;
  const preferred = optional.filter((option) => prefer.includes(option.card?.code ?? -1));
  const rest = optional.filter((option) => !prefer.includes(option.card?.code ?? -1));
  const ordered = [...preferred, ...rest];
  const search = (index: number, chosen: typeof optional, sum: number): typeof optional | null => {
    const count = chosen.length + must.length;
    if (count >= min && count <= max && (sum === remaining || (remaining > 0 && sum >= remaining))) return chosen;
    if (index >= ordered.length || count >= max) return null;
    const take = search(index + 1, [...chosen, ordered[index]], sum + (ordered[index].values?.[0] ?? 0));
    if (take) return take;
    return search(index + 1, chosen, sum);
  };
  const found = search(0, [], 0);
  assert(found, `no SELECT_SUM combination totaling ${target} from ${dumpPrompt(prompt)}`);
  return found.map((option) => option.id);
}

function extraSummonAnswer(prompt: DuelPrompt, master: number, materials: number[], inherent: number): DuelAnswer {
  if (prompt.kind === "choice") {
    if (prompt.options.some((option) => option.id === "yes") && prompt.options.some((option) => option.id === "no")) {
      return prompt.cancelable ? { cancel: true } : { choice: "no" };
    }
    const spsummonMaster = prompt.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === master);
    if (spsummonMaster) return { choice: spsummonMaster.id };
    const spsummonInherent = prompt.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === inherent);
    if (spsummonInherent) return { choice: spsummonInherent.id };
    const normalMaterial = prompt.options.find((option) => option.id.startsWith("summon:") && materials.includes(option.card?.code ?? -1) && option.card?.code !== inherent);
    if (normalMaterial) return { choice: normalMaterial.id };
    const faceUp = prompt.options.find((option) => option.id === "pos:1" || /attack/i.test(option.label));
    if (faceUp) return { choice: faceUp.id };
    assert(!prompt.options.some((option) => option.id === "to_ep"), `extra-deck DM summon must be legal: ${dumpPrompt(prompt)}`);
    return { choice: prompt.options[0].id };
  }
  if (prompt.kind === "toggle") {
    const selectedCount = prompt.options.filter((option) => option.selected).length;
    if (prompt.finishable && selectedCount >= (prompt.min ?? 0)) return { finish: true };
    const material = prompt.options.find((option) => !option.selected && materials.includes(option.card?.code ?? -1));
    if (material) return { choice: material.id };
    const next = prompt.options.find((option) => !option.selected);
    if (next) return { choice: next.id };
    if (prompt.finishable) return { finish: true };
    throw new Error(`stuck toggle ${dumpPrompt(prompt)}`);
  }
  if (prompt.kind === "sum") {
    return { selected: pickSum(prompt, materials) };
  }
  if (prompt.kind === "cards" || prompt.kind === "tribute" || prompt.kind === "places") {
    const count = prompt.min ?? 1;
    const preferred = prompt.options.filter((option) => materials.includes(option.card?.code ?? -1) || (option.sequence != null && option.sequence < 5));
    const ordered = [...preferred, ...prompt.options.filter((option) => !preferred.includes(option))];
    const unique = [...new Set(ordered)];
    return { selected: unique.slice(0, count).map((option) => option.id) };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error(`Unplanned extra-summon prompt ${dumpPrompt(prompt)}`);
}

describe("domain extra-deck proper summons from DMZ", () => {
  it.each([
    {
      master: "Magical Android",
      materials: ["Photon Thrasher", "Effect Veiler"],
      inherent: "Photon Thrasher",
      kind: "synchro" as const,
    },
    {
      master: "Number 39: Utopia",
      materials: ["Photon Thrasher", "Alexandrite Dragon"],
      inherent: "Photon Thrasher",
      kind: "xyz" as const,
    },
  ])("properly $kind summons $master from the DMZ using field materials", async (scenario) => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const id = (name: string) => {
      const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as { id: number } | undefined;
      assert(row, `Missing pinned card: ${name}`);
      return row.id;
    };
    const master = id(scenario.master);
    const materials = scenario.materials.map(id);
    const inherent = id(scenario.inherent);
    const fillers = (db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id").all() as { id: number }[]).map((row) => row.id);
    db.close();
    const wanted = [...materials];
    const deck: DuelDeck = {
      main: [...wanted, ...fillers.filter((code) => !wanted.includes(code) && code !== master).slice(0, 60 - wanted.length)],
      extra: [],
      side: [],
      deckMaster: master,
    };
    validateDeck("domain", deck, dataDirectory);
    const probe = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    const slots = probe.view(0).seats[0].hand.map((card) => deck.main.indexOf(card.code!));
    probe.close();
    wanted.forEach((code, index) => {
      const from = deck.main.indexOf(code), to = slots[index];
      [deck.main[from], deck.main[to]] = [deck.main[to], deck.main[from]];
    });
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    const seen: string[] = [];
    try {
      const opening = game.view(0);
      expect(opening.seats[0].deckMaster?.inZone).toBe(true);
      expect(opening.prompt?.options.some((option) => option.id.startsWith("summon:") && option.card?.code === master)).toBe(false);
      expect(opening.prompt?.options.some((option) => option.id.startsWith("spsummon:") && option.card?.code === master)).toBe(false);
      expect(opening.prompt?.options.some((option) => option.id.startsWith("spsummon:") && option.card?.code === inherent)).toBe(true);
      for (let step = 0; step < 40 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const view = game.view(0);
        const prompt = view.prompt ?? game.view(1).prompt;
        assert(prompt, `Summoning player must have a prompt after ${seen.join(" -> ")}`);
        seen.push(dumpPrompt(prompt));
        const seat = prompt.seat;
        const answer = seat === 0
          ? extraSummonAnswer(prompt, master, materials, inherent)
          : prompt.options.some((option) => option.id === "no")
            ? { choice: "no" as const }
            : prompt.options.some((option) => option.id === "to_ep")
              ? { choice: "to_ep" as const }
              : prompt.cancelable
                ? { cancel: true }
                : { choice: prompt.options[0].id };
        game.answer(seat, prompt.id, answer);
      }
      const seat = game.view(0).seats[0];
      const summoned = seat.monsters.find((card) => card?.code === master);
      assert(summoned, `never summoned ${scenario.master}: ${seen.join(" -> ")}`);
      expect(summoned.code).toBe(master);
      expect(summoned.sequence).toBeLessThan(7);
      expect(game.view(0).events.find((event) => event.kind === "summon" && event.card?.code === master)?.summonKind).toBe(scenario.kind);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(8000);
      expect(seat.hand.some((card) => materials.includes(card.code!))).toBe(false);
      if (scenario.kind === "synchro") {
        expect(seat.graveyard.map((card) => card.code)).toEqual(expect.arrayContaining(materials));
        expect(summoned.materials ?? []).toEqual([]);
      } else {
        const overlay = (summoned.materials ?? []).map((card) => card.code);
        expect(overlay).toEqual(expect.arrayContaining(materials));
        expect(overlay).toHaveLength(materials.length);
        expect(seat.graveyard.some((card) => materials.includes(card.code!))).toBe(false);
      }
    } finally {
      game.close();
    }
  });
});

function cardId(db: InstanceType<typeof Database>, name: string): number {
  const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as { id: number } | undefined;
  assert(row, `Missing pinned card: ${name}`);
  return row.id;
}

function spellFillers(db: InstanceType<typeof Database>): number[] {
  return (db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id").all() as { id: number }[]).map((row) => row.id);
}

function domainDeckFrom(db: InstanceType<typeof Database>, master: number, wanted: number[], extra: number[] = []): DuelDeck {
  const fillers = spellFillers(db);
  const mainWanted = wanted.filter((code) => code !== master);
  const deck: DuelDeck = {
    main: [...mainWanted, ...fillers.filter((code) => !mainWanted.includes(code) && code !== master).slice(0, 60 - mainWanted.length)],
    extra,
    side: [],
    deckMaster: master,
  };
  validateDeck("domain", deck, dataDirectory);
  return deck;
}

async function arrangeWanted(deck: DuelDeck, wanted: number[]): Promise<DuelDeck> {
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

function optionCodes(prompt: DuelPrompt, prefix: string): number[] {
  return prompt.options.filter((option) => option.id.startsWith(prefix) && option.card?.code != null).map((option) => option.card!.code!);
}

describe("domain inherent SS and extra matching bridge", () => {
  it("special summons Jester Confit from the DMZ and never offers its activate", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Jester Confit");
    const deck = await arrangeWanted(domainDeckFrom(db, master, []), []);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(optionCodes(idle, "spsummon:")).toContain(master);
      expect(optionCodes(idle, "activate:")).not.toContain(master);
      const spsummon = idle.options.find((option) => option.id.startsWith("spsummon:") && option.card?.code === master);
      assert(spsummon);
      game.answer(0, idle.id, { choice: spsummon.id });
      for (let step = 0; step < 12 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const prompt = game.view(0).prompt;
        assert(prompt, "prompt while completing Jester SS");
        if (prompt.kind === "choice") {
          const faceUp = prompt.options.find((option) => option.id === "pos:1" || /attack/i.test(option.label));
          game.answer(0, prompt.id, { choice: (faceUp ?? prompt.options[0]).id });
        } else if (prompt.cancelable) {
          game.answer(0, prompt.id, { cancel: true });
        } else {
          game.answer(0, prompt.id, { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) });
        }
      }
      const seat = game.view(0).seats[0];
      expect(seat.monsters.some((card) => card?.code === master)).toBe(true);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(8000);
    } finally {
      game.close();
    }
  });

  it("does not let Bystial Magnamhut activate or inherent-SS from the DMZ", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Bystial Magnamhut");
    const deck = await arrangeWanted(domainDeckFrom(db, master, []), []);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(optionCodes(idle, "activate:")).not.toContain(master);
      expect(optionCodes(idle, "spsummon:")).not.toContain(master);
    } finally {
      game.close();
    }
  });

  it("Instant Fusion proper-summons Flame Swordsman from the DMZ", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    const spell = cardId(db, "Instant Fusion");
    const deck = await arrangeWanted(domainDeckFrom(db, master, [spell]), [spell]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(optionCodes(idle, "activate:")).toContain(spell);
      for (let step = 0; step < 25 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const prompt = game.view(0).prompt;
        assert(prompt, "prompt while Instant Fusion summons");
        let answer: DuelAnswer;
        if (prompt.kind === "choice") {
          const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === spell);
          if (activation) answer = { choice: activation.id };
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
      expect(seat.lp).toBe(7000);
      expect(seat.graveyard.map((card) => card.code)).toEqual(expect.arrayContaining([spell]));
    } finally {
      game.close();
    }
  });

  it("does not let Extra-Foolish Burial mill an extra-type DM (type-only EXTRA search)", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    const mill = cardId(db, "Extra-Foolish Burial");
    const deck = await arrangeWanted(domainDeckFrom(db, master, [mill]), [mill]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle required");
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(optionCodes(idle, "activate:")).not.toContain(mill);
      expect(game.view(0).seats[0].lp).toBe(8000);
    } finally {
      game.close();
    }
  });

  it("Rank-Up-Magic Quick Chaos proper-summons Number C39: Utopia Ray V from the DMZ", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Number C39: Utopia Ray V");
    const rum = cardId(db, "Rank-Up-Magic Quick Chaos");
    const utopia = cardId(db, "Number 39: Utopia");
    const materials = ["Photon Thrasher", "Alexandrite Dragon"].map((name) => cardId(db, name));
    const inherent = cardId(db, "Photon Thrasher");
    const deck = await arrangeWanted(domainDeckFrom(db, master, [rum, ...materials], [utopia]), [...materials, rum]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    const seen: string[] = [];
    try {
      for (let step = 0; step < 50 && !game.view(0).seats[0].monsters.some((card) => card?.code === master); step++) {
        const view = game.view(0);
        const prompt = view.prompt ?? game.view(1).prompt;
        assert(prompt, `missing prompt after ${seen.join(" -> ")}`);
        seen.push(dumpPrompt(prompt));
        const seat = prompt.seat;
        let answer: DuelAnswer;
        if (seat !== 0) {
          answer = prompt.options.some((option) => option.id === "no")
            ? { choice: "no" }
            : prompt.options.some((option) => option.id === "to_ep")
              ? { choice: "to_ep" }
              : prompt.cancelable
                ? { cancel: true }
                : { choice: prompt.options[0].id };
        } else if (prompt.kind === "choice") {
          const rumActivate = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === rum);
          const xyzReady = view.seats[0].monsters.some((card) => card?.code === utopia);
          if (rumActivate && xyzReady) answer = { choice: rumActivate.id };
          else answer = extraSummonAnswer(prompt, utopia, materials, inherent);
        } else if (prompt.kind === "cards" || prompt.kind === "places" || prompt.kind === "tribute") {
          const dm = prompt.options.find((option) => option.card?.code === master);
          if (dm) answer = { selected: [dm.id] };
          else answer = extraSummonAnswer(prompt, utopia, materials, inherent);
        } else {
          answer = extraSummonAnswer(prompt, utopia, materials, inherent);
        }
        game.answer(seat, prompt.id, answer);
      }
      const seat = game.view(0).seats[0];
      const summoned = seat.monsters.find((card) => card?.code === master);
      assert(summoned, `never summoned Utopia Ray V: ${seen.join(" -> ")}`);
      expect(game.view(0).events.find((event) => event.kind === "summon" && event.card?.code === master)?.summonKind).toBe("xyz");
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(8000);
      const overlay = (summoned.materials ?? []).map((card) => card.code);
      expect(overlay).toEqual(expect.arrayContaining([utopia]));
    } finally {
      game.close();
    }
  });

  it("Waking the Dragon cannot special summon an extra-type DM (generic sumtype 0)", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const master = cardId(db, "Flame Swordsman");
    const waking = cardId(db, "Waking the Dragon");
    const mst = cardId(db, "Mystical Space Typhoon");
    const north = await arrangeWanted(domainDeckFrom(db, master, [waking]), [waking]);
    const south = await arrangeWanted(domainDeckFrom(db, master, [mst]), [mst]);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [north, south], seed, dataDirectory });
    try {
      let wakingSet = false;
      let mstUsed = false;
      for (let step = 0; step < 40; step++) {
        const view0 = game.view(0);
        const prompt = view0.prompt ?? game.view(1).prompt;
        if (!prompt) break;
        const seat = prompt.seat;
        if (seat === 0 && prompt.kind === "choice") {
          const setTrap = prompt.options.find((option) => option.id.startsWith("set:") && option.card?.code === waking);
          if (setTrap && !wakingSet) {
            game.answer(0, prompt.id, { choice: setTrap.id });
            wakingSet = true;
            continue;
          }
          if (wakingSet && prompt.options.some((option) => option.id === "to_ep")) {
            game.answer(0, prompt.id, { choice: "to_ep" });
            continue;
          }
        }
        if (seat === 1 && prompt.kind === "choice") {
          const activate = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === mst);
          if (activate && wakingSet && !mstUsed) {
            game.answer(1, prompt.id, { choice: activate.id });
            mstUsed = true;
            continue;
          }
        }
        if ((prompt.kind === "cards" || prompt.kind === "places") && mstUsed) {
          const wakingOpt = prompt.options.find((option) => option.card?.code === waking);
          const dmOpt = prompt.options.find((option) => option.card?.code === master);
          expect(dmOpt).toBeUndefined();
          if (wakingOpt) {
            game.answer(seat, prompt.id, { selected: [wakingOpt.id] });
            continue;
          }
        }
        if (prompt.kind === "choice" && prompt.options.some((option) => option.id === "no")) {
          game.answer(seat, prompt.id, { choice: "no" });
          continue;
        }
        if (prompt.kind === "choice" && prompt.options.some((option) => option.id === "to_ep")) {
          game.answer(seat, prompt.id, { choice: "to_ep" });
          continue;
        }
        if (prompt.cancelable) {
          game.answer(seat, prompt.id, { cancel: true });
          continue;
        }
        if (prompt.kind === "choice") {
          game.answer(seat, prompt.id, { choice: prompt.options[0].id });
          continue;
        }
        game.answer(seat, prompt.id, { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) });
      }
      const seat = game.view(0).seats[0];
      expect(seat.monsters.some((card) => card?.code === master)).toBe(false);
      expect(seat.deckMaster?.inZone).toBe(true);
      expect(seat.lp).toBe(8000);
    } finally {
      game.close();
    }
  });
});

