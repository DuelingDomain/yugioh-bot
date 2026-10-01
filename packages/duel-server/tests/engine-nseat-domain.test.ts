import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import type { DuelDeck, DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { partnerSeatOf } from "@yugidraft/shared/duels";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";

// Domain duels with 3 and 4 duelists (task D1). The test loads the multi-domain core through the multiWasmBinary hook.
// DOMAIN_MULTI_WASM names the wasm; the default is the current build (tests/support/cores.ts). Without the file every live test skips, or fails with DUEL_REQUIRE_CORES=1.
const wasmPath = currentDomainMultiWasm();

const settings = {
  visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240,
  startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true,
};

function wasmBinary(): ArrayBuffer {
  const bytes = readFileSync(wasmPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function domainDecks(count: number): DuelDeck[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    const monsters = (db.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all() as { id: number }[]).map((row) => row.id);
    const spells = (db.prepare("SELECT id FROM datas WHERE type = 2 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all() as { id: number }[]).map((row) => row.id);
    return Array.from({ length: count }, (_, seat) => ({
      main: spells.slice(seat * 40, seat * 40 + 40),
      extra: [],
      side: [],
      deckMaster: monsters[seat],
    }));
  } finally {
    db.close();
  }
}

describeWithCores("domain duel with 3 and 4 duelists", needs.domainMulti(dataDirectory, wasmPath), () => {
  it.each<[DuelFormat, number]>([["ffa3", 3], ["ffa4", 4], ["tag", 4]])("%s: every seat has a Deck Master and a 5-card hand", async (format, seats) => {
    const game = await createEngineGame({
      mode: "domain", format, decks: domainDecks(seats), seed: ["5", "6", "7", "8"], dataDirectory, settings,
      multiWasmBinary: wasmBinary(),
    });
    try {
      const view = game.view(null);
      expect(view.seats).toHaveLength(seats);
      for (const seat of view.seats) expect(seat.hand).toHaveLength(5);
      for (const seat of view.seats) {
        expect(seat.deckMaster).toBeDefined();
        expect([seat.deckMaster!.inZone, seat.deckMaster!.returns, seat.deckMaster!.nextCost]).toEqual([true, 0, 0]);
      }
    } finally {
      game.close();
    }
  });

  // A global effect sends the Deck Master of each victim seat to the Graveyard at the start of the turn of seat `turnSeat`.
  function sendDmScript(turnSeat: number, victims: number[], after = ""): { name: string; content: string }[] {
    const ops = victims.map((seat) => `Duel.SendtoGrave(Duel.GetFieldCard(${seat},0x4000,0),0x440)`).join(" ");
    return [{
      name: "d1-send-dm.lua",
      content: `local e=Effect.GlobalEffect() e:SetType(0x802) e:SetCode(0x2004) e:SetCondition(function() return Duel.GetTurnPlayer()==${turnSeat} end) e:SetOperation(function(e) ${ops} ${after} e:Reset() end) Duel.RegisterEffect(e,0)`,
    }];
  }

  // Answer prompts (recall: yes) until `stop` is true. Returns the seats that got a recall prompt, in order.
  function drive(game: EngineGame, stop: () => boolean, maxSteps = 400): number[] {
    const recalls: number[] = [];
    for (let step = 0; step < maxSteps && !stop(); step += 1) {
      let found = false;
      for (let seat = 0; seat < game.view(null).seats.length; seat += 1) {
        const prompt = game.view(seat).prompt;
        if (!prompt) continue;
        found = true;
        const ids = prompt.options.map((option) => option.id);
        if (prompt.kind === "choice" && ids.includes("yes") && ids.includes("no")) {
          recalls.push(seat);
          game.answer(seat, prompt.id, { choice: "yes" });
        } else if (prompt.kind === "choice") {
          game.answer(seat, prompt.id, { choice: ids.includes("to_ep") ? "to_ep" : ids[0]! });
        } else if (prompt.kind === "places" || prompt.kind === "cards" || prompt.kind === "tribute") {
          game.answer(seat, prompt.id, { selected: prompt.options.slice(0, prompt.min ?? 1).map((option) => option.id) });
        } else {
          game.answer(seat, prompt.id, { cancel: true });
        }
        break;
      }
      if (!found) break;
    }
    return recalls;
  }

  it.each<[DuelFormat, number, number[]]>([["ffa3", 3, [1]], ["ffa4", 4, [3, 1]], ["tag", 4, [3, 1]]])(
    "%s: recall prompts go to each living owner in turn, starting with the turn player",
    async (format, seats, want) => {
      const game = await createEngineGame({
        mode: "domain", format, decks: domainDecks(seats), seed: ["5", "6", "7", "8"], dataDirectory, settings,
        startupScripts: sendDmScript(2, want), multiWasmBinary: wasmBinary(),
      });
      try {
        const recalls = drive(game, () => game.view(null).turn > 5);
        expect(recalls.slice(0, want.length)).toEqual(want);
        const view = game.view(null);
        for (const seat of want) expect(view.seats[seat]!.deckMaster!.returns).toBe(1);
      } finally {
        game.close();
      }
    },
    60_000,
  );

  it("tag: partners share the team LP, and a recall costs the team", async () => {
    const game = await createEngineGame({
      mode: "domain", format: "tag", decks: domainDecks(4), seed: ["5", "6", "7", "8"], dataDirectory, settings,
      startupScripts: sendDmScript(2, [1]), multiWasmBinary: wasmBinary(),
    });
    try {
      const partner = partnerSeatOf("tag", 1)!;
      expect(game.view(null).seats[1]!.lp).toBe(game.view(null).seats[partner]!.lp);
      drive(game, () => game.view(null).turn > 5);
      const view = game.view(null);
      expect(view.seats[1]!.lp).toBe(view.seats[partner]!.lp);
      expect(view.seats[1]!.deckMaster!.returns).toBe(1);
    } finally {
      game.close();
    }
  }, 60_000);

  it("ffa4: an eliminated seat loses its Deck Master and the duel goes on", async () => {
    const game = await createEngineGame({
      mode: "domain", format: "ffa4", decks: domainDecks(4), seed: ["5", "6", "7", "8"], dataDirectory, settings,
      startupScripts: sendDmScript(0, [2], "Debug.EliminateDuelist(2,0)"), multiWasmBinary: wasmBinary(),
    });
    try {
      // The loss comes from an effect operation here; tests/engine-eliminate.test.ts covers game.eliminate() with a prompt open.
      drive(game, () => game.view(null).turn > 1 || game.view(null).seats[2]!.eliminated === true);
      const view = game.view(null);
      expect(view.seats[2]!.eliminated).toBe(true);
      expect(view.seats[2]!.hand).toHaveLength(0);
      expect(view.seats[2]!.deckMaster?.inZone).toBe(false);
      for (const seat of [0, 1, 3]) {
        expect(view.seats[seat]!.eliminated).toBeFalsy();
        expect(view.seats[seat]!.deckMaster!.inZone).toBe(true);
      }
      expect(view.result ?? null).toBeNull();
    } finally {
      game.close();
    }
  });
});
