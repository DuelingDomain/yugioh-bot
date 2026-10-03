// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/engine-settings.test.ts from origin/main (78b8caa)
// with only the import paths changed: engine, views and prompts come from ../../src/legacy, the other sources from ../../src, and
// the data dir helper from ../engine-data-dir.js. Do not edit it to make the legacy engine pass: the legacy engine must equal main. See legacy-1v1/README.md.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelMasterRule, DuelPrompt, DuelSettings } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/legacy/engine.js";
import { engineDataDirectory } from "../engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const DARK_MAGICIAN = 46986414;
const MAGICAL_MALLET = 85852291;
const POT_OF_DUALITY = 98645731;

function settings(over: Partial<DuelSettings> = {}): DuelSettings {
  return {
    visibility: "public",
    banlist: "none",
    cardPool: "both",
    turnSeconds: 240,
    startingLP: 8000,
    startingHand: 5,
    drawPerTurn: 1,
    timeout: "loss",
    validateDeck: true,
    shuffleDeck: true,
    ...over,
  };
}

function vanillaMain(count = 40): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id")
      .all() as { id: number }[];
    return rows.map((row) => row.id).slice(0, count);
  } finally {
    db.close();
  }
}

function spellMain(count: number, exclude: number[] = []): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    const rows = db
      .prepare(
        "SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id",
      )
      .all() as { id: number }[];
    const skip = new Set(exclude);
    return rows.map((row) => row.id).filter((id) => !skip.has(id)).slice(0, count);
  } finally {
    db.close();
  }
}

function normalDeck(main = vanillaMain()): DuelDeck {
  return { main, extra: [], side: [] };
}

function domainDeck(main = spellMain(60, [DARK_MAGICIAN])): DuelDeck {
  return { main, extra: [], side: [], deckMaster: DARK_MAGICIAN };
}

async function opening(mode: "normal" | "domain", deck: DuelDeck, over: Partial<DuelSettings> = {}, masterRule?: DuelMasterRule) {
  const game = await createEngineGame({
    mode,
    decks: [deck, { ...deck, main: [...deck.main] }],
    seed,
    dataDirectory,
    masterRule,
    settings: Object.keys(over).length > 0 || mode === "domain" ? settings(over) : undefined,
  });
  try {
    const view = game.view(0);
    return {
      lp: view.seats[0].lp,
      hand: view.seats[0].hand.map((card) => card.code),
      deckCount: view.seats[0].deckCount,
    };
  } finally {
    game.close();
  }
}

function answering(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
}

function activate(prompt: DuelPrompt, code: number): DuelAnswer | null {
  const option = prompt.options.find((entry) => entry.id.startsWith("activate:") && entry.card?.code === code);
  return option ? { choice: option.id } : null;
}

describe("engine start settings", () => {
  it("keeps 8000 LP and a 5-card opening hand when settings are omitted", async () => {
    const opened = await opening("normal", normalDeck());
    expect(opened.lp).toBe(8000);
    expect(opened.hand).toHaveLength(5);
    expect(opened.deckCount).toBe(35);
  });

  it("applies custom starting LP and hand size on both cores", async () => {
    const custom = { startingLP: 4000, startingHand: 7 };
    const normal = await opening("normal", normalDeck(), custom);
    expect(normal.lp).toBe(4000);
    expect(normal.hand).toHaveLength(7);
    expect(normal.deckCount).toBe(33);
    const domain = await opening("domain", domainDeck(), custom);
    expect(domain.lp).toBe(4000);
    expect(domain.hand).toHaveLength(7);
    expect(domain.deckCount).toBe(53);
  });

  it("lets drawPerTurn change the MR1 first-player extra draw", async () => {
    const main = vanillaMain();
    const deck = normalDeck(main);
    const one = await opening("normal", deck, { drawPerTurn: 1 }, 1);
    const none = await opening("normal", deck, { drawPerTurn: 0 }, 1);
    const two = await opening("normal", deck, { drawPerTurn: 2 }, 1);
    expect(one.hand).toHaveLength(6);
    expect(none.hand).toHaveLength(5);
    expect(two.hand).toHaveLength(7);
  });

  it("draws imported cards top-to-bottom when shuffle is off", async () => {
    const main = vanillaMain();
    const expected = main.slice(0, 5);
    const frozen = await opening("normal", normalDeck(main), { shuffleDeck: false });
    expect(frozen.hand).toEqual(expected);
    const shuffled = await opening("normal", normalDeck(main), { shuffleDeck: true });
    expect(shuffled.hand).not.toEqual(expected);
    const domainMain = spellMain(60, [DARK_MAGICIAN]);
    const domainFrozen = await opening("domain", domainDeck(domainMain), { shuffleDeck: false });
    expect(domainFrozen.hand).toEqual(domainMain.slice(0, 5));
  });

  it("still shuffles from card effects after an unshuffled opening", async () => {
    const fillers = vanillaMain(45).filter((id) => id !== MAGICAL_MALLET && id !== POT_OF_DUALITY);
    const main = [MAGICAL_MALLET, POT_OF_DUALITY, ...fillers].slice(0, 40);
    const unshuffledTop = main.slice(5, 8);
    const deck = normalDeck(main);
    const game = await createEngineGame({
      mode: "normal",
      decks: [deck, { ...deck, main: [...deck.main] }],
      seed,
      dataDirectory,
      settings: settings({ shuffleDeck: false }),
    });
    try {
      expect(game.view(0).seats[0].hand.map((card) => card.code)).toEqual(main.slice(0, 5));
      let malletReturned = false;
      let excavated: number[] | undefined;
      for (let step = 0; step < 40 && excavated == null; step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while Magical Mallet then Duality");
        const { prompt } = waiting;
        if (prompt.kind === "cards") {
          if (!malletReturned) {
            const sendBack = prompt.options.find((option) => option.card?.code !== POT_OF_DUALITY && option.card?.code !== MAGICAL_MALLET);
            assert(sendBack, "Magical Mallet must return a non-Duality card");
            game.answer(waiting.seat, prompt.id, { selected: [sendBack.id] });
            malletReturned = true;
            continue;
          }
          excavated = prompt.options.map((option) => option.card?.code).filter((code): code is number => code != null);
          break;
        }
        let answer: DuelAnswer;
        if (prompt.kind === "choice") {
          const mallet = !malletReturned ? activate(prompt, MAGICAL_MALLET) : null;
          const duality = malletReturned ? activate(prompt, POT_OF_DUALITY) : null;
          if (mallet) answer = mallet;
          else if (duality) answer = duality;
          else if (prompt.options.some((option) => option.id === "no")) answer = { choice: "no" };
          else if (prompt.cancelable) answer = { cancel: true };
          else answer = { choice: prompt.options[0].id };
        } else {
          answer = { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) };
        }
        game.answer(waiting.seat, prompt.id, answer);
      }
      expect(excavated, "Pot of Duality must excavate after Magical Mallet shuffled").toBeDefined();
      expect([...excavated!].sort((a, b) => a - b)).not.toEqual([...unshuffledTop].sort((a, b) => a - b));
    } finally {
      game.close();
    }
  });

  it("starts a Domain game under Master Rule 4 instead of rejecting it", async () => {
    const opened = await opening("domain", domainDeck(), { startingLP: 1000, startingHand: 1 }, 4);
    expect(opened.lp).toBe(1000);
    expect(opened.hand).toHaveLength(1);
  });
});
