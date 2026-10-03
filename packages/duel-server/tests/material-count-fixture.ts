import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";

export const materialCountScenarios = [
  { kind: "synchro", monster: "Junk Archer", materials: ["Photon Thrasher", "Junk Synchron"] },
  { kind: "xyz", monster: "Number 39: Utopia", materials: ["Photon Thrasher", "Alexandrite Dragon"] },
  { kind: "link", monster: "LANphorhynchus", materials: ["Photon Thrasher", "Alexandrite Dragon"] },
  { kind: "fusion", monster: "Flame Swordsman", materials: ["Flame Manipulator", "Masaki the Legendary Swordsman"], spell: "Polymerization" },
  { kind: "fusion", monster: "Chimeratech Overdragon", materials: ["Cyber Dragon", "Cyber Dragon Zwei"], spell: "Polymerization" },
  { kind: "tribute", monster: "Dark Magician", materials: ["Photon Thrasher", "Alexandrite Dragon"] },
  { kind: "ritual", monster: "Paladin of White Dragon", materials: ["Mystical Shine Ball", "Flame Manipulator"], spell: "White Dragon Ritual" },
] as const;

export type MaterialCountScenario = (typeof materialCountScenarios)[number];

/** Real stock-core duels, following engine-events.test.ts's unshuffled opening-hand setup. */
export async function runMaterialCountScenario(scenario: MaterialCountScenario, options: {
  extraMonsters?: readonly string[];
  onMaterialPrompt?: (game: EngineGame, prompt: DuelPrompt) => void;
} = {}) {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  let monster: number;
  let materials: number[];
  let spell: number | undefined;
  let fillers: number[];
  let extraMonsters: number[];
  try {
    const id = (name: string) => {
      const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0 LIMIT 1").get(name) as { id: number } | undefined;
      assert(row, `Missing real card ${name}`);
      return row.id;
    };
    monster = id(scenario.monster);
    materials = scenario.materials.map(id);
    spell = "spell" in scenario ? id(scenario.spell) : undefined;
    extraMonsters = (options.extraMonsters ?? []).map(id);
    fillers = (db.prepare("SELECT id FROM datas WHERE type=2 AND alias=0 AND (ot&3)!=0 ORDER BY id LIMIT 60").all() as { id: number }[]).map((row) => row.id);
  } finally {
    db.close();
  }
  const wanted = [...materials, ...(spell ? [spell] : []), ...(["tribute", "ritual"].includes(scenario.kind) ? [monster] : [])];
  const deck: DuelDeck = {
    main: [...wanted, ...fillers.filter((code) => !wanted.includes(code)).slice(0, 40 - wanted.length)],
    extra: ["tribute", "ritual"].includes(scenario.kind) ? [] : [...extraMonsters, monster],
    side: [],
  };
  const game = await createEngineGame({
    mode: "normal", decks: [deck, deck], seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    settings: {
      visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240,
      startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss",
      validateDeck: false, shuffleDeck: false,
    },
  });
  const prompts: DuelPrompt[] = [];
  const materialViews: DuelEngineView[] = [];
  const opponentMaterialViews: DuelEngineView[] = [];
  const spectatorMaterialViews: DuelEngineView[] = [];
  const trace: string[] = [];
  let summoning = false;
  try {
    for (let step = 0; step < 80; step++) {
      const view = game.view(0);
      const summoned = view.seats[0].monsters.find((card) => card?.code === monster);
      if (summoned) {
        const event = view.events.find((entry) => entry.kind === "summon" && entry.card?.code === monster);
        assert(event, "Completed summon must have an event");
        return { prompts, materialViews, opponentMaterialViews, spectatorMaterialViews, completedView: view, summoned, event, graveyard: view.seats[0].graveyard, materials, trace };
      }
      const prompt = view.prompt ?? game.view(1).prompt;
      assert(prompt, `No prompt: ${trace.join(" -> ")}`);
      trace.push(`${prompt.kind}:${prompt.title} ${prompt.min}/${prompt.max} selected=${prompt.options.filter((option) => option.selected).length} finish=${prompt.finishable}`);
      if (summoning && prompt.seat === 0 && ["toggle", "sum", "tribute"].includes(prompt.kind)) {
        prompts.push(structuredClone(prompt));
        materialViews.push(structuredClone(view));
        opponentMaterialViews.push(structuredClone(game.view(1)));
        spectatorMaterialViews.push(structuredClone(game.view(null)));
        options.onMaterialPrompt?.(game, prompt);
      }
      let answer: DuelAnswer;
      if (prompt.kind === "choice") {
        const find = (prefix: string, code: number) => prompt.options.find((option) => option.id.startsWith(prefix) && option.card?.code === code);
        const target = prompt.seat === 0 ? (spell ? find("activate:", spell) : find(scenario.kind === "tribute" ? "summon:" : "spsummon:", monster)) : undefined;
        const material = prompt.seat === 0 && !spell
          ? materials.map((code) => find("spsummon:", code) ?? find("summon:", code)).find(Boolean)
          : undefined;
        if (target) {
          summoning = true;
          answer = { choice: target.id };
        } else if (material) answer = { choice: material.id };
        else if (prompt.options.some((option) => option.id === "no")) answer = { choice: "no" };
        else if (prompt.options.some((option) => option.id === "to_ep")) answer = { choice: "to_ep" };
        else answer = { choice: (prompt.options.find((option) => option.id === "pos:1") ?? prompt.options[0]).id };
      } else if (prompt.kind === "toggle") {
        const next = prompt.options.find((option) => !option.selected && materials.includes(option.card?.code ?? -1));
        if (prompt.finishable) answer = { finish: true };
        else {
          assert(next, `No material available: ${trace.join(" -> ")}`);
          answer = { choice: next.id };
        }
      } else if (prompt.kind === "sum" || prompt.kind === "tribute") {
        answer = { selected: prompt.options.filter((option) => materials.includes(option.card?.code ?? -1) || prompt.mandatory?.includes(option.id)).map((option) => option.id) };
      } else {
        answer = { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
      }
      game.answer(prompt.seat, prompt.id, answer);
    }
    throw new Error(`Failed to summon ${scenario.monster}: ${trace.join(" -> ")}`);
  } finally {
    game.close();
  }
}
