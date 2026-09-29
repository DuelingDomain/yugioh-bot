import assert from "node:assert/strict";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { validateDeck } from "../src/deck-legality.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const dataDirectory = engineDataDirectory;
const seed = ["1", "2", "3", "4"];
const TYPE_MONSTER = 0x1;
const TYPE_PENDULUM = 0x1000000;
const TYPE_EXTRA = 0x40 | 0x2000 | 0x800000 | 0x4000000;
const ODD_EYES_PENDULUM = 16178681;

function cardId(db: InstanceType<typeof Database>, name: string): number {
  const row = db
    .prepare("SELECT d.id FROM datas d JOIN texts t USING(id) WHERE t.name=? AND d.alias=0 AND (d.ot&3)!=0")
    .get(name) as { id: number } | undefined;
  assert(row, `Missing pinned card: ${name}`);
  return row.id;
}

function spellFillers(db: InstanceType<typeof Database>, exclude: number[]): number[] {
  return (
    db
      .prepare(
        "SELECT d.id FROM datas d JOIN texts t USING(id) WHERE d.type=2 AND d.alias=0 AND (d.ot&3)!=0 AND t.desc NOT LIKE '%always treated as%' ORDER BY d.id",
      )
      .all() as { id: number }[]
  )
    .map((row) => row.id)
    .filter((id) => !exclude.includes(id));
}

function domainSpellDeck(db: InstanceType<typeof Database>, master: number, extra: number[] = []): DuelDeck {
  const deck: DuelDeck = {
    main: spellFillers(db, [master]).slice(0, 60),
    extra,
    side: [],
    deckMaster: master,
  };
  validateDeck("domain", deck, dataDirectory);
  return deck;
}

function answering(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } | null {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  return null;
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

function chooseDefault(prompt: DuelPrompt, preferActivate?: number, preferSelect?: number): DuelAnswer {
  if (prompt.kind === "toggle") {
    if (preferSelect != null) {
      const option = prompt.options.find((choice) => choice.card?.code === preferSelect && !choice.selected);
      if (option) return { choice: option.id };
    }
    if (prompt.finishable) return { finish: true };
  }
  if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
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
    assert(prompt.options[0]);
    return { choice: prompt.options[0].id };
  }
  if (prompt.cancelable) return { cancel: true };
  throw new Error("Unplanned pendulum smoke prompt");
}

describe("domain pendulum from DMZ", () => {
  it("activates a Main Deck Pendulum Deck Master from the DMZ into a Pendulum Zone", async () => {
    const db = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const deck = domainSpellDeck(db, ODD_EYES_PENDULUM);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle");
      expect(optionCodes(idle, "activate:")).toContain(ODD_EYES_PENDULUM);
      expect(optionCodes(idle, "sset:")).not.toContain(ODD_EYES_PENDULUM);
      const activation = idle.options.find((option) => option.id.startsWith("activate:") && option.card?.code === ODD_EYES_PENDULUM);
      assert(activation);
      game.answer(0, idle.id, { choice: activation.id });
      for (let step = 0; step < 12 && !game.view(0).seats[0].spells.some((card) => card?.code === ODD_EYES_PENDULUM); step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while placing pendulum scale");
        game.answer(waiting.seat, waiting.prompt.id, chooseDefault(waiting.prompt, ODD_EYES_PENDULUM));
      }
      const seat = game.view(0).seats[0];
      expect(seat.spells.some((card) => card?.code === ODD_EYES_PENDULUM)).toBe(true);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(8000);
    } finally {
      game.close();
    }
  });

  it("does not let an Extra Pendulum Deck Master scale-activate or Pendulum Summon from the DMZ", async () => {
    const db = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const extraPendulum = db
      .prepare(
        `SELECT datas.id FROM datas JOIN texts USING (id)
         WHERE type & ? != 0 AND type & ? != 0 AND type & ? != 0
           AND alias = 0 AND (ot & 3) != 0
         ORDER BY datas.id LIMIT 1`,
      )
      .get(TYPE_MONSTER, TYPE_PENDULUM, TYPE_EXTRA) as { id: number } | undefined;
    assert(extraPendulum, "need an Extra Pendulum monster in cards.cdb");
    const deck = domainSpellDeck(db, extraPendulum.id);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle");
      expect(optionCodes(idle, "activate:")).not.toContain(extraPendulum.id);
      expect(optionCodes(idle, "spsummon:")).not.toContain(extraPendulum.id);
      expect(optionCodes(idle, "summon:")).not.toContain(extraPendulum.id);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
      expect(game.view(0).seats[0].lp).toBe(8000);
    } finally {
      game.close();
    }
  });

  it("keeps Artifact S/T setting and ordinary monster activates blocked from the DMZ", async () => {
    const db = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const scythe = cardId(db, "Artifact Scythe");
    const deck = domainSpellDeck(db, scythe);
    db.close();
    const game = await createEngineGame({ mode: "domain", decks: [deck, deck], seed, dataDirectory });
    try {
      const idle = game.view(0).prompt;
      assert(idle, "opening idle");
      expect(optionCodes(idle, "activate:")).not.toContain(scythe);
      expect(optionCodes(idle, "sset:")).not.toContain(scythe);
      expect(game.view(0).seats[0].deckMaster?.inZone).toBe(true);
    } finally {
      game.close();
    }
  });

  it("Pendulum Summons a Main Deck non-Pendulum Deck Master from the DMZ", async () => {
    const gongato = 9106362;
    const cheermole = 17857780;
    const db = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const axe = cardId(db, "Axe Raider");
    const deck: DuelDeck = {
      main: [gongato, cheermole, ...spellFillers(db, [axe, gongato, cheermole]).slice(0, 58)],
      extra: [],
      side: [],
      deckMaster: axe,
    };
    validateDeck("domain", deck, dataDirectory);
    db.close();
    const arranged = await arrangeWanted(deck, [gongato, cheermole]);
    const game = await createEngineGame({ mode: "domain", decks: [arranged, arranged], seed, dataDirectory });
    try {
      const pick = (prompt: DuelPrompt): DuelAnswer => {
        if (prompt.kind === "choice") {
          for (const code of [gongato, cheermole]) {
            const activation = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === code && option.location === 0x2);
            if (activation) return { choice: activation.id };
          }
          const pendulum = prompt.options.find((option) => option.id.startsWith("spsummon:"));
          if (pendulum) return { choice: pendulum.id };
        }
        return chooseDefault(prompt, undefined, axe);
      };
      for (let step = 0; step < 40 && !game.view(0).seats[0].monsters.some((card) => card?.code === axe); step++) {
        const waiting = answering(game);
        assert(waiting, "prompt while pendulum summoning Axe Raider");
        game.answer(waiting.seat, waiting.prompt.id, pick(waiting.prompt));
      }
      const seat = game.view(0).seats[0];
      expect(seat.monsters.some((card) => card?.code === axe)).toBe(true);
      expect(seat.deckMaster?.inZone).toBe(false);
      expect(seat.lp).toBe(8000);
    } finally {
      game.close();
    }
  });
});
