import { describe, expect, it } from "vitest";
import { defaultDuelSettings, partnerSeatOf, seatCountFor, type DuelDeck, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { cardMatchesOpcode, OcgOpCode, OcgType } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";

const layouts: Array<["pinned" | "legacy", DuelFormat]> = [
  ["pinned", "1v1"], ["legacy", "1v1"], ["pinned", "tag"], ["pinned", "ffa3"], ["pinned", "ffa4"],
];
for (const mode of ["normal", "domain"] as DuelMode[]) {
  describe.each(layouts)(`${mode} %s %s announcement search`, (engine, format) => {
    it("suggests only the announcing seat's legal main, extra, and Deck Master cards", async () => {
      const seatCount = seatCountFor(format);
      const seat = seatCount - 1;
      const partner = partnerSeatOf(format, seat);
      const decks: DuelDeck[] = Array.from({ length: seatCount }, (_, index) => ({
        main: Array(40).fill(index === seat ? 89631139 : index === partner ? 70781052 : 46986414),
        extra: index === seat ? [23995346] : [],
        side: index === seat ? [77585513, 55144522] : [],
        ...(mode === "domain" ? { deckMaster: index === seat ? 15025844 : index === partner ? 70781052 : 46986414 } : {}),
      }));
      const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({
        mode, format, dataDirectory, decks, seed: ["1", "2", "3", "4"],
        settings: { ...defaultDuelSettings(mode), validateDeck: false, shuffleDeck: false },
        startupScripts: [{ name: "announce-search.lua", content: `
          local e=Effect.GlobalEffect()
          e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
          e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
          e:SetOperation(function(e)
            e:Reset()
            Duel.AnnounceCard(${seat},TYPE_MONSTER)
          end)
          Duel.RegisterEffect(e,0)
        ` }],
      });
      try {
        expect(game.view(seat).prompt?.kind).toBe("announce-card");
        const suggestions = game.searchCards("", seat);
        expect(suggestions.map(card => card.code).sort((a, b) => a - b)).toEqual(
          mode === "domain" ? [15025844, 23995346, 89631139] : [23995346, 89631139]);
        expect(suggestions.every(card => card.inDeck)).toBe(true);
        expect(game.searchCards("b", seat).every(card => card.inDeck)).toBe(true);
        expect(game.searchCards("eyes blue", seat)[0]).toMatchObject({ code: 89631139, inDeck: true });
        // An opponent name remains publicly searchable, but gets no deck membership marker or priority.
        expect(game.searchCards("dark magician", seat)[0].inDeck).not.toBe(true);
        if (partner !== null) {
          expect(decks[partner].main[0]).not.toBe(decks[0].main[0]);
          expect(game.searchCards("summoned skull", seat)[0]).toMatchObject({ code: 70781052 });
          expect(game.searchCards("summoned skull", seat)[0].inDeck).not.toBe(true);
        }
        expect(game.searchCards("77585513", seat)[0]).toMatchObject({ code: 77585513 });
        expect(game.searchCards("77585513", seat)[0].inDeck).not.toBe(true);
        if (mode === "domain") expect(game.searchCards("15025844", seat)[0]).toMatchObject({ code: 15025844, inDeck: true });
        const potMatches = game.searchCards("pot of greed", seat);
        expect(potMatches.map(card => card.code)).not.toContain(55144522);
        expect(potMatches.every(card => (card.type & 1) !== 0)).toBe(true);
        expect(game.searchCards("55144522", seat)).toEqual([]);
        expect(() => game.searchCards("", 0)).toThrow(/announcement|announcing/i);
        expect(() => game.searchCards("", -1)).toThrow(/announcement|announcing/i);
        expect(() => game.searchCards("", seatCount)).toThrow(/announcement|announcing/i);
        // Internal bot searches without a seat still get the public legal catalog.
        expect(game.searchCards("").length).toBeGreaterThan(3);
        const catalog = loadCardDatabase(dataDirectory);
        const firstLegal = [...catalog.all()].find(card => {
          const data = catalog.cardData(card.code);
          return data && cardMatchesOpcode(data, [BigInt(OcgType.MONSTER), OcgOpCode.ISTYPE]);
        });
        expect(firstLegal).toBeDefined();
        expect(game.searchCards("")[0].code).toBe(firstLegal!.code);
      } finally { game.close(); }
    });
  });
}

it.each(["pinned", "legacy"] as const)("passes the seat through a real %s worker and rejects another seat", async engine => {
  const worker = new GameWorker();
  try {
    await worker.create({ mode: "normal", engine, dataDirectory, seed: ["1", "2", "3", "4"],
      decks: [46986414, 89631139].map(code => ({ main: Array(40).fill(code), extra: [], side: [] })),
      settings: { ...defaultDuelSettings("normal"), validateDeck: false, shuffleDeck: false },
      startupScripts: [{ name: "worker-announce.lua", content: `
        local e=Effect.GlobalEffect()
        e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
        e:SetOperation(function(e) e:Reset() Duel.AnnounceCard(1,TYPE_MONSTER) end)
        Duel.RegisterEffect(e,0)
      ` }],
    });
    expect((await worker.view(1)).prompt?.kind).toBe("announce-card");
    expect(await worker.search("", 1)).toMatchObject([{ code: 89631139, inDeck: true }]);
    await expect(worker.search("", 0)).rejects.toThrow(/announcement/i);
    expect((await worker.search("dark magician", 1))[0].inDeck).not.toBe(true);
  } finally { await worker.close(); }
});
