import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelMasterRule, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const ODD_EYES_PENDULUM = 16178681;

function cardId(db: InstanceType<typeof Database>, name: string): number {
  const row = db.prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0").get(name) as
    | { id: number }
    | undefined;
  assert(row, `Missing pinned card: ${name}`);
  return row.id;
}

function vanillaMain(db: InstanceType<typeof Database>, extraExclude: number[] = []): number[] {
  const rows = db
    .prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id")
    .all() as { id: number }[];
  return rows.map((row) => row.id).filter((id) => !extraExclude.includes(id)).slice(0, 40);
}

function answering(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

function choose(prompt: DuelPrompt, preferActivate?: number, preferSelect?: number): DuelAnswer {
  if (prompt.kind === "places") {
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "cards" || prompt.kind === "tribute") {
    const preferred = preferSelect != null ? prompt.options.find((option) => option.card?.code === preferSelect) : undefined;
    if (preferred) return { selected: [preferred.id] };
    return { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
  }
  if (prompt.kind === "choice") {
    if (preferActivate != null) {
      const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === preferActivate);
      if (activation) return { choice: activation.id };
    }
    const toEp = prompt.options.find((option) => option.id === "to_ep");
    if (toEp) return { choice: "to_ep" };
    if (prompt.cancelable) return { cancel: true };
    assert(prompt.options[0], "empty choice");
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error("Unplanned master-rule prompt");
}

async function arrangeWanted(deck: DuelDeck, wanted: number[], masterRule: DuelMasterRule = 5): Promise<DuelDeck> {
  const copy: DuelDeck = { main: [...deck.main], extra: [...deck.extra], side: [...deck.side] };
  const probe = await createEngineGame({ mode: "normal", decks: [copy, copy], seed, dataDirectory, masterRule });
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

async function openingHandSize(masterRule: DuelMasterRule, main: number[]): Promise<number> {
  const deck: DuelDeck = { main, extra: [], side: [] };
  const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed, dataDirectory, masterRule });
  try {
    return game.view(0).seats[0].hand.length;
  } finally {
    game.close();
  }
}

describe("native master rule presets", () => {
  it("rejects unknown master rules", async () => {
    const deck: DuelDeck = { main: [1, 2, 3], extra: [], side: [] };
    await expect(
      createEngineGame({
        mode: "normal",
        decks: [deck, deck],
        seed,
        dataDirectory,
        masterRule: 9 as DuelMasterRule,
      }),
    ).rejects.toThrow(/Unknown master rule/);
  });

  it("defaults omitted masterRule to MR5 (first player does not draw)", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const main = vanillaMain(db);
    db.close();
    const implied = await openingHandSize(5, main);
    const omittedDeck: DuelDeck = { main, extra: [], side: [] };
    const game = await createEngineGame({ mode: "normal", decks: [omittedDeck, omittedDeck], seed, dataDirectory });
    try {
      expect(game.view(0).seats[0].hand.length).toBe(implied);
      expect(implied).toBe(5);
    } finally {
      game.close();
    }
  });

  it("lets the first player draw on turn 1 under MR1 and MR2, not MR3+", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const main = vanillaMain(db);
    db.close();
    expect(await openingHandSize(1, main)).toBe(6);
    expect(await openingHandSize(2, main)).toBe(6);
    expect(await openingHandSize(3, main)).toBe(5);
    expect(await openingHandSize(4, main)).toBe(5);
    expect(await openingHandSize(5, main)).toBe(5);
  });

  it("uses separate Pendulum Zone sequences 6/7 under MR3, not under MR5", async () => {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const fillers = vanillaMain(db, [ODD_EYES_PENDULUM]);
    db.close();
    const base: DuelDeck = { main: [ODD_EYES_PENDULUM, ...fillers.slice(0, 39)], extra: [], side: [] };

    const collectPzoneSequences = async (masterRule: DuelMasterRule): Promise<number[]> => {
      const deck = await arrangeWanted(base, [ODD_EYES_PENDULUM], masterRule);
      const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed, dataDirectory, masterRule });
      try {
        const idle = game.view(0).prompt;
        assert(idle, "opening idle");
        const activation = idle.options.find((option) => option.id.startsWith("activate:") && option.card?.code === ODD_EYES_PENDULUM);
        assert(activation, "Odd-Eyes must be activatable");
        game.answer(0, idle.id, { choice: activation.id });
        for (let step = 0; step < 8; step++) {
          const waiting = answering(game);
          assert(waiting, "prompt after pendulum activate");
          if (waiting.prompt.kind === "places") {
            return waiting.prompt.options.filter((option) => option.location === OcgLocation.SZONE).map((option) => option.sequence ?? -1);
          }
          game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, ODD_EYES_PENDULUM));
        }
        throw new Error("never offered pendulum zone selection");
      } finally {
        game.close();
      }
    };

    expect(await collectPzoneSequences(3)).toEqual([6, 7]);
    expect(await collectPzoneSequences(5)).toEqual([0, 4]);
  });

  async function fusionZoneSequences(masterRule: DuelMasterRule): Promise<number[]> {
    const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const instant = cardId(db, "Instant Fusion");
    const fusion = cardId(db, "Flame Swordsman");
    const main = [instant, ...vanillaMain(db, [instant]).slice(0, 39)];
    db.close();
    const base: DuelDeck = { main, extra: [fusion], side: [] };
    const deck = await arrangeWanted(base, [instant], masterRule);
    const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed, dataDirectory, masterRule });
    try {
      for (let step = 0; step < 20; step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while Instant Fusion summons");
        if (waiting.prompt.kind === "places") {
          const sequences = waiting.prompt.options
            .filter((option) => option.location === OcgLocation.MZONE && option.controller === 0)
            .map((option) => option.sequence ?? -1)
            .sort((a, b) => a - b);
          if (sequences.length > 0) return sequences;
        }
        game.answer(waiting.seat, waiting.prompt.id, choose(waiting.prompt, instant, fusion));
      }
      throw new Error("Instant Fusion never offered a monster zone");
    } finally {
      game.close();
    }
  }

  it("restricts Extra Deck Fusion summons to Extra Monster Zones under MR4, not MR5", async () => {
    expect(await fusionZoneSequences(4)).toEqual([5, 6]);
    const mr5 = await fusionZoneSequences(5);
    expect(mr5).toEqual(expect.arrayContaining([0, 1, 2, 3, 4]));
    expect(mr5).toEqual(expect.arrayContaining([5, 6]));
  });

  it("never offers Extra Monster Zones (sequences 5 and 6) under MR1, MR2 and MR3", async () => {
    for (const rule of [1, 2, 3] as const) {
      const sequences = await fusionZoneSequences(rule);
      expect(sequences, `MR${rule}`).toEqual([0, 1, 2, 3, 4]);
    }
  });
});
