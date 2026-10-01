import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import type { DuelAnswer, DuelDeck, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { seatCountFor, seatsOfTeam, teamOfSeat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { choosePracticeBotAnswer, chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { currentDomainMultiWasm, currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

// Task ELIM: game.eliminate() while a prompt is open. The core applies the loss at its next Adjust, so the
// engine keeps the open prompt (or answers it for a leaving seat) until the core reports the loss.
// The multi core of the data directory may be older than Debug.EliminateDuelist: these tests load a build that has it.
// MULTI_WASM and DOMAIN_MULTI_WASM name the wasm files; without them the live tests skip, or fail with DUEL_REQUIRE_CORES=1 (tests/support/cores.ts).
const multiWasmPath = currentMultiWasm();
const domainWasmPath = currentDomainMultiWasm();

const settings = {
  visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240,
  startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true,
};

function cardIds(type: number, count: number, offset: number): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    const rows = db.prepare(`SELECT id FROM datas WHERE type = ${type} AND alias = 0 AND (ot & 3) != 0 ORDER BY id`).all() as { id: number }[];
    return rows.map((row) => row.id).slice(offset, offset + count);
  } finally {
    db.close();
  }
}

const vanillaDecks = (seats: number): DuelDeck[] => Array.from({ length: seats }, () => ({ main: cardIds(17, 40, 0), extra: [], side: [] }));

function domainDecks(seats: number): DuelDeck[] {
  const monsters = cardIds(17, seats, 0);
  return Array.from({ length: seats }, (_, seat) => ({ main: cardIds(2, 40, seat * 40), extra: [], side: [], deckMaster: monsters[seat] }));
}

function wasmBinary(path: string): ArrayBuffer {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The seat that holds the open prompt, or null. */
function promptSeat(game: EngineGame): number | null {
  const count = game.view(null).seats.length;
  for (let seat = 0; seat < count; seat += 1) if (game.view(seat).prompt) return seat;
  return null;
}

/** A pass: the answer that changes the game least. */
function pass(game: EngineGame, seat: number): void {
  const prompt = game.view(seat).prompt as DuelPrompt;
  const answer: DuelAnswer = chooseSurrenderedAnswer(prompt);
  game.answer(seat, prompt.id, answer);
}

const isOut = (game: EngineGame, seat: number) => game.view(null).seats[seat]!.eliminated === true;

const cases: [DuelFormat][] = [["ffa3"], ["ffa4"], ["tag"]];

describeWithCores("eliminate with a prompt open (multi core)", needs.multi(multiWasmPath), () => {
  async function open(format: DuelFormat): Promise<EngineGame> {
    return createEngineGame({ mode: "normal", format, decks: vanillaDecks(seatCountFor(format)), seed: ["11", "22", "33", "44"], dataDirectory, settings, multiWasmBinary: wasmBinary(multiWasmPath) });
  }

  it.each(cases)("%s: eliminating the seat that holds the prompt removes it and moves the prompt on", async (format) => {
    const game = await open(format);
    try {
      const holder = promptSeat(game)!;
      expect(holder).not.toBeNull();
      game.eliminate(holder, 0);
      for (const seat of format === "tag" ? seatsOfTeam(format, teamOfSeat(format, holder)) : [holder]) expect(isOut(game, seat)).toBe(true);
      if (format === "tag") {
        // Two teams: the other team wins at once.
        expect(game.view(null).result?.winnerTeam).toBe(1 - teamOfSeat(format, holder));
        return;
      }
      const next = promptSeat(game);
      expect(next).not.toBeNull();
      expect(isOut(game, next!)).toBe(false);
      expect(game.view(null).result ?? null).toBeNull();
      // The duel goes on: the next seat can act.
      pass(game, next!);
    } finally {
      game.close();
    }
  });

  it.each(cases)("%s: eliminating another seat keeps the prompt, marks the seat as leaving, and removes it after the answer", async (format) => {
    const game = await open(format);
    try {
      const holder = promptSeat(game)!;
      const other = format === "tag" ? seatsOfTeam(format, 1 - teamOfSeat(format, holder))[0]! : (holder + 1) % seatCountFor(format);
      const before = game.view(holder).prompt!;
      game.eliminate(other, 0);
      const during = game.view(holder).prompt;
      expect(during?.id).toBe(before.id);
      expect(promptSeat(game)).toBe(holder);
      const seatView = game.view(null).seats[other]!;
      expect(seatView.eliminated).toBe(false);
      expect(seatView.pendingElimination).toBe(true);
      pass(game, holder);
      expect(isOut(game, other)).toBe(true);
      expect(game.view(null).seats[other]!.pendingElimination ?? false).toBe(false);
      if (format === "tag") {
        expect(game.view(null).result?.winnerTeam).toBe(teamOfSeat(format, holder));
        return;
      }
      expect(game.view(null).result ?? null).toBeNull();
      expect(promptSeat(game)).not.toBeNull();
    } finally {
      game.close();
    }
  });

  it("ffa4: eliminates the prompt holder after any number of plays (summons, attacks, tributes)", async () => {
    for (const steps of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]) {
      const game = await open("ffa4");
      try {
        // The practice bot plays: it summons and attacks, so every kind of prompt shows up.
        for (let step = 0; step < steps && !game.view(null).result; step += 1) {
          const seat = promptSeat(game);
          if (seat === null) break;
          const prompt = game.view(seat).prompt as DuelPrompt;
          game.answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
        }
        const holder = promptSeat(game)!;
        const kind = game.view(holder).prompt!.kind;
        game.eliminate(holder, 0);
        expect([steps, kind, isOut(game, holder)]).toEqual([steps, kind, true]);
        expect(game.view(null).result ?? null).toBeNull();
        const next = promptSeat(game);
        expect(next).not.toBeNull();
        pass(game, next!);
      } finally {
        game.close();
      }
    }
  }, 60_000);

  it("ffa4: two seats leave at once, one of them the prompt holder", async () => {
    const game = await open("ffa4");
    try {
      const holder = promptSeat(game)!;
      const other = (holder + 1) % 4;
      game.eliminate(other, 0);
      game.eliminate(holder, 0);
      expect(() => game.eliminate(other, 0)).toThrow(/already eliminated/);
      expect(isOut(game, holder)).toBe(true);
      expect(game.diagnostics().some((entry) => entry.kind === "leaving-answer" && entry.seat === holder)).toBe(true);
      // `other` is out too, or leaves after the next answer.
      const next = promptSeat(game);
      if (next !== null) pass(game, next);
      expect(isOut(game, other)).toBe(true);
    } finally {
      game.close();
    }
  });

  it("2 seats: eliminate is still refused", async () => {
    const game = await createEngineGame({ mode: "normal", decks: vanillaDecks(2), seed: ["1", "2", "3", "4"], dataDirectory, settings });
    try {
      expect(() => game.eliminate(0, 0)).toThrow(/more than two seats/);
    } finally {
      game.close();
    }
  });
});

describeWithCores("eliminate with a prompt open (domain multi core)", [needs.multi(multiWasmPath), ...needs.domainMulti(dataDirectory, domainWasmPath)], () => {
  it.each(cases)("%s: eliminates the seat that holds the prompt and one that does not", async (format) => {
    for (const mode of ["holder", "other"] as const) {
      const game = await createEngineGame({
        mode: "domain", format, decks: domainDecks(seatCountFor(format)), seed: ["5", "6", "7", "8"], dataDirectory, settings, multiWasmBinary: wasmBinary(domainWasmPath),
      });
      try {
        const holder = promptSeat(game)!;
        const target = mode === "holder" ? holder : format === "tag" ? seatsOfTeam(format, 1 - teamOfSeat(format, holder))[0]! : (holder + 1) % seatCountFor(format);
        game.eliminate(target, 0);
        if (mode === "other") {
          expect(promptSeat(game)).toBe(holder);
          pass(game, holder);
        }
        expect(isOut(game, target)).toBe(true);
        if (format === "tag") {
          expect(game.view(null).result?.winnerTeam).toBe(1 - teamOfSeat(format, target));
          continue;
        }
        const next = promptSeat(game);
        expect(next).not.toBeNull();
        expect(isOut(game, next!)).toBe(false);
        pass(game, next!);
      } finally {
        game.close();
      }
    }
  }, 60_000);
});
