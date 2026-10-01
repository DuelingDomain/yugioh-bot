import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import type { DuelDeck, DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { partnerSeatOf } from "@yugidraft/shared/duels";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { currentDomainMultiWasm, describeWithCores, itWithCores, needs } from "./support/cores.js";

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

  // At the start of the turn of seat `turnSeat` (turn `turnSeat + 1`), the Deck Master of each victim seat goes to the Graveyard.
  // One effect per victim, registered for that victim: inside an effect Lua sees the owner as `tp` (the F5 fold),
  // and an absolute seat number would name another duelist there. `after` runs once in a further effect (Debug.* calls take absolute seats).
  function sendDmScript(turnSeat: number, victims: number[], after = ""): { name: string; content: string }[] {
    const when = `e:SetCondition(function() return Duel.GetTurnCount()==${turnSeat + 1} end)`;
    const effect = (seat: number, operation: string) =>
      `local e=Effect.GlobalEffect() e:SetType(0x802) e:SetCode(0x2004) ${when} e:SetOperation(function(e,tp) ${operation} e:Reset() end) Duel.RegisterEffect(e,${seat})`;
    const scripts = victims.map((seat) => ({ name: `d1-send-dm-${seat}.lua`, content: effect(seat, "Duel.SendtoGrave(Duel.GetFieldCard(tp,0x4000,0),0x440)") }));
    if (after) scripts.push({ name: "d1-after.lua", content: effect(0, after) });
    return scripts;
  }

  // Answer prompts (recall: yes) until `stop` is true. Returns the seats that got a recall prompt, in order.
  // `summonDm`: seats that summon their recalled Deck Master at the first action prompt they get (each seat once).
  function drive(game: EngineGame, stop: () => boolean, maxSteps = 400, summonDm: Map<number, number> = new Map()): number[] {
    const recalls: number[] = [];
    for (let step = 0; step < maxSteps && !stop(); step += 1) {
      let found = false;
      for (let seat = 0; seat < game.view(null).seats.length; seat += 1) {
        const prompt = game.view(seat).prompt;
        if (!prompt) continue;
        found = true;
        const ids = prompt.options.map((option) => option.id);
        const dmCode = summonDm.get(seat);
        const dmSummon = dmCode === undefined || prompt.context?.type !== "action" ? undefined : prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === dmCode);
        if (dmSummon) {
          summonDm.delete(seat);
          game.answer(seat, prompt.id, { choice: dmSummon.id });
        } else if (prompt.kind === "choice" && ids.includes("yes") && ids.includes("no")) {
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

  // The Deck Master of some seats goes to the Graveyard, comes back (recall: yes) and is summoned on the owner's own turn.
  // The summon of a recalled Deck Master costs 500 LP per completed return: from the own LP in a free-for-all duel, from the
  // shared team LP in Tag. Seats 2 and 3 at ffa4 (seats after the first two), seat 2 at ffa3, one seat of each team in Tag.
  it.each<[DuelFormat, number, number[]]>([["ffa3", 3, [2]], ["ffa4", 4, [2, 3]], ["tag", 4, [1, 2]]])(
    "%s: the Deck Master summon of the recalled seats %j costs 500 LP from own LP (free-for-all) or team LP (Tag)",
    async (format, seats, victims) => {
      const decks = domainDecks(seats);
      const game = await createEngineGame({
        mode: "domain", format, decks, seed: ["5", "6", "7", "8"], dataDirectory, settings,
        startupScripts: sendDmScript(Math.min(...victims), victims), multiWasmBinary: wasmBinary(),
      });
      try {
        const before = game.view(null).seats.map((seat) => seat.lp);
        const pending = new Map(victims.map((seat) => [seat, decks[seat]!.deckMaster!] as const));
        drive(game, () => pending.size === 0 && game.view(null).turn > Math.max(...victims) + 1, 800, pending);
        expect(pending.size).toBe(0);
        const view = game.view(null);
        const paying = new Set(victims.flatMap((seat) => [seat, ...(format === "tag" ? [partnerSeatOf(format, seat)!] : [])]));
        for (const seat of victims) {
          expect(view.seats[seat]!.deckMaster!.returns).toBe(1);
          expect(view.seats[seat]!.deckMaster!.inZone).toBe(false);
          expect(view.seats[seat]!.monsters.some((card) => card?.code === decks[seat]!.deckMaster)).toBe(true);
        }
        view.seats.forEach((seat, index) => {
          expect(seat.lp, `LP of seat ${index}`).toBe(paying.has(index) ? before[index]! - 500 : before[index]!);
        });
        // Tag: partners share one LP total, so the cost of one summon is visible at the partner too.
        if (format === "tag") for (const seat of victims) expect(view.seats[partnerSeatOf(format, seat)!]!.lp).toBe(view.seats[seat]!.lp);
      } finally {
        game.close();
      }
    },
    120_000,
  );

  // The engine reads ocgcore.multi-domain.wasm from the data directory when no test hook gives a binary. The file is
  // installed by hand (see domain-core/patches/README.md); a missing file skips the test, or fails it with DUEL_REQUIRE_CORES=1.
  itWithCores(
    "the engine loads ocgcore.multi-domain.wasm from the data directory",
    [needs.file("installed domain multi core", join(dataDirectory, "ocgcore.multi-domain.wasm"), "Install the multi-domain core into the engine data directory (see domain-core/patches/README.md).")],
    async () => {
      for (const [format, seats] of [["ffa3", 3], ["ffa4", 4], ["tag", 4]] as const) {
        const game = await createEngineGame({ mode: "domain", format, decks: domainDecks(seats), seed: ["5", "6", "7", "8"], dataDirectory, settings });
        try {
          expect(game.coreInfo().wasmFile).toBe("ocgcore.multi-domain.wasm");
          for (const seat of game.view(null).seats) expect(seat.deckMaster?.inZone).toBe(true);
        } finally {
          game.close();
        }
      }
    },
  );

  // Tag: the Deck Master summon is checked against the shared team LP, not against the LP entry of the summoning seat.
  // Seat 2 is the partner of seat 0, so seat 0 holds the team entry. The effect of seat 0 sets the team LP at turn 1;
  // seat 2 recalls its Deck Master and tries the summon at turn 3. The first return costs 500 LP: 400 LP must not
  // offer the summon (the seat keeps its own, unchanged entry high), 600 LP must offer it and leave 100 LP.
  it.each<[number, boolean]>([[400, false], [600, true]])(
    "tag: with %i team LP the Deck Master summon of a partner seat is offered: %s",
    async (teamLp, offered) => {
      const decks = domainDecks(4);
      const game = await createEngineGame({
        mode: "domain", format: "tag", decks, seed: ["5", "6", "7", "8"], dataDirectory, settings,
        startupScripts: sendDmScript(0, [2], `Duel.SetLP(0,${teamLp})`), multiWasmBinary: wasmBinary(),
      });
      try {
        const pending = new Map([[2, decks[2]!.deckMaster!]]);
        drive(game, () => game.view(null).turn > 5, 800, pending);
        const view = game.view(null);
        expect(view.seats[0]!.lp).toBe(offered ? teamLp - 500 : teamLp);
        expect(view.seats[2]!.lp).toBe(view.seats[0]!.lp);
        expect(pending.size).toBe(offered ? 0 : 1);
        // The recall itself counts as the return; the cost is paid at the summon.
        expect(view.seats[2]!.deckMaster!.returns).toBe(1);
        expect(view.seats[2]!.monsters.some((card) => card?.code === decks[2]!.deckMaster)).toBe(offered);
      } finally {
        game.close();
      }
    },
    120_000,
  );

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
