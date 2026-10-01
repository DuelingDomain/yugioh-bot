import { join } from "node:path";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import createCore from "ocgcore-wasm";
import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, type OcgCardData } from "ocgcore-wasm";
import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelDeck, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { DIAGNOSTICS_LIMIT, acceptsResult, createEngineGame, eliminationCodeOf } from "../src/engine.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { autoResponse, mapPrompt, directAttackSeat, parseFieldPlaces } from "../src/prompts.js";
import { MSG_ATTACK_DUELIST, MSG_DUELIST_ELIMINATED, parseDuelistMessages, splitMessages } from "../src/raw-messages.js";
import { createRevealMap, projectView, type StoredChainLink } from "../src/views.js";
import type { CardDatabase } from "../src/cards.js";
import { compileBoard } from "./support/board.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { currentMultiWasm, itEachWithCores, itWithCores, needs } from "./support/cores.js";

const multiWasmPath = currentMultiWasm();

function info(code: number): DuelCardInfo {
  return { code, name: `Card ${code}`, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "warrior" };
}

const cards = { get: (code: number) => info(code), search: () => [], cardData: () => null } as unknown as CardDatabase;

function message(...bytes: number[]): number[] {
  return [bytes.length, 0, 0, 0, ...bytes];
}

describe("multi-duelist raw messages", () => {
  it("splits a buffer by its length prefixes", () => {
    const buffer = Uint8Array.from([...message(1, 9), ...message(2), ...message(3, 4, 5)]);
    expect(splitMessages(buffer).map((part) => [...part])).toEqual([[1, 9], [2], [3, 4, 5]]);
  });

  it("parses ids 200 and 201 and counts the other messages before them", () => {
    const buffer = Uint8Array.from([
      ...message(40, 0, 1),
      ...message(MSG_DUELIST_ELIMINATED, 2, 4),
      ...message(41),
      ...message(MSG_ATTACK_DUELIST, 3),
      ...message(MSG_ATTACK_DUELIST, 1),
    ]);
    const parsed = parseDuelistMessages(buffer);
    expect(parsed.others).toBe(2);
    expect(parsed.extras).toEqual([
      { type: MSG_DUELIST_ELIMINATED, duelist: 2, reason: 4, after: 1 },
      { type: MSG_ATTACK_DUELIST, duelist: 3, after: 2 },
      { type: MSG_ATTACK_DUELIST, duelist: 1, after: 2 },
    ]);
  });

  it("ignores a truncated 200 or 201 message", () => {
    const buffer = Uint8Array.from([...message(MSG_DUELIST_ELIMINATED, 2), ...message(MSG_ATTACK_DUELIST)]);
    expect(parseDuelistMessages(buffer).extras).toEqual([]);
  });
});

describe("createEngineGame format checks", () => {
  const deck: DuelDeck = { main: [], extra: [], side: [] };
  const base = { mode: "normal" as const, seed: ["1", "2", "3", "4"], dataDirectory };

  it.each<[DuelFormat, number]>([["ffa3", 2], ["ffa4", 3], ["tag", 2], ["1v1", 3]])("%s rejects %i decks", async (format, count) => {
    await expect(createEngineGame({ ...base, format, decks: Array.from({ length: count }, () => deck) })).rejects.toThrow(/decks are required|Exactly two decks/);
  });

  it("names the seat count in the error", async () => {
    await expect(createEngineGame({ ...base, format: "ffa3", decks: [deck, deck] })).rejects.toThrow("Exactly 3 decks are required for a ffa3 duel");
    await expect(createEngineGame({ ...base, decks: [deck] })).rejects.toThrow("Exactly two decks are required");
  });

  it("names the missing multi-duelist wasm", async () => {
    // A data folder of symlinks to the real one, without any multi-duelist wasm: independent of what is installed.
    const bare = mkdtempSync(join(tmpdir(), "duel-no-multi-"));
    try {
      for (const entry of readdirSync(dataDirectory)) {
        if (entry.startsWith("ocgcore.multi")) continue;
        symlinkSync(join(dataDirectory, entry), join(bare, entry));
      }
      await expect(
        createEngineGame({ ...base, format: "ffa3", decks: [deck, deck, deck], dataDirectory: bare }),
      ).rejects.toThrow(/Multi-duelist wasm is missing at .*ocgcore\.multi\.wasm/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("N-seat views", () => {
  const vacant = { position: 0, materials: 0 };
  function lib(locations: Record<string, Array<{ code: number; position: number } | null>>) {
    const counts: Array<[number, number]> = [];
    return {
      counts,
      lib: {
        duelQueryField: () => {
          throw new Error("duelQueryField must not be called with more than two seats");
        },
        duelQueryCount: (_handle: unknown, controller: number, location: number) => {
          counts.push([controller, location]);
          return location === OcgLocation.DECK ? 30 + controller : 15;
        },
        duelQueryLocation: (_handle: unknown, loc: { controller: number; location: number }) => locations[`${loc.controller}:${loc.location}`] ?? [],
      } as never,
    };
  }
  const project = (format: DuelFormat, viewer: number | null, extra: Record<string, unknown> = {}, locations: Record<string, Array<{ code: number; position: number } | null>> = {}) => {
    const source = lib(locations);
    const count = format === "ffa3" ? 3 : 4;
    return projectView({
      lib: source.lib,
      handle: {} as never,
      cards,
      viewer,
      revision: 1,
      turn: 1,
      turnSeat: 0,
      phase: "main1",
      lp: Array.from({ length: count }, (_, seat) => 8000 - seat),
      prompt: null,
      promptSeat: null,
      log: [],
      events: [],
      result: null,
      reveals: createRevealMap(count),
      mode: "normal",
      format,
      ...extra,
    });
  };
  const hands = {
    "0:2": [{ code: 100, position: OcgPosition.FACEDOWN }],
    "1:2": [{ code: 101, position: OcgPosition.FACEDOWN }],
    "2:2": [{ code: 102, position: OcgPosition.FACEDOWN }],
    "3:2": [{ code: 103, position: OcgPosition.FACEDOWN }],
  };

  it("builds 3 seats without QueryField and fills format and team", () => {
    const view = project("ffa3", 0, {}, hands);
    expect(view.format).toBe("ffa3");
    expect(view.seats.map((seat) => [seat.seat, seat.team, seat.eliminated, seat.lp])).toEqual([[0, 0, false, 8000], [1, 1, false, 7999], [2, 2, false, 7998]]);
    expect(view.seats.map((seat) => seat.deckCount)).toEqual([30, 31, 32]);
    expect(view.seats[0]!.hand[0]!.code).toBe(100);
    expect(view.seats[1]!.hand[0]!.code).toBeUndefined();
    expect(view.seats[2]!.hand[0]!.code).toBeUndefined();
  });

  it("builds 4 seats and hides every hand from a spectator", () => {
    const view = project("ffa4", null, {}, hands);
    expect(view.seats).toHaveLength(4);
    expect(view.seats.every((seat) => seat.hand.every((card) => card.code == null))).toBe(true);
  });

  it("shows a Tag partner's hand and hides the opponents' hands", () => {
    const view = project("tag", 1, {}, hands);
    expect(view.seats.map((seat) => seat.team)).toEqual([0, 1, 0, 1]);
    expect(view.seats[1]!.hand[0]!.code).toBe(101);
    expect(view.seats[3]!.hand[0]!.code).toBe(103);
    expect(view.seats[0]!.hand[0]!.code).toBeUndefined();
    expect(view.seats[2]!.hand[0]!.code).toBeUndefined();
  });

  it("shows a Tag partner's Set cards but not the opponents'", () => {
    const set = OcgLocation.SZONE;
    const view = project("tag", 0, {}, {
      "2:8": [{ code: 200, position: OcgPosition.FACEDOWN }],
      "1:8": [{ code: 201, position: OcgPosition.FACEDOWN }],
    });
    expect(set).toBe(8);
    expect(view.seats[2]!.spells[0]!.code).toBe(200);
    expect(view.seats[1]!.spells[0]!.code).toBeUndefined();
  });

  it("does not show a partner in FFA", () => {
    const view = project("ffa4", 0, {}, hands);
    expect(view.seats[2]!.hand[0]!.code).toBeUndefined();
  });

  it("empties an eliminated seat", () => {
    const view = project("ffa3", 0, { eliminated: new Set([1]) }, hands);
    expect(view.seats[1]).toMatchObject({ eliminated: true, hand: [], deckCount: 0, team: 1, lp: 7999 });
    expect(view.seats[1]!.monsters).toHaveLength(7);
    expect(view.seats[0]!.eliminated).toBe(false);
  });

  it("takes the chain from the engine state", () => {
    const chain: StoredChainLink[] = [{ index: 1, seat: 2, code: 55, description: "Do it" }];
    const view = project("ffa3", 0, { chain });
    expect(view.chain).toEqual([{ index: 1, seat: 2, code: 55, name: "Card 55", description: "Do it" }]);
  });

  it("leaves a 1v1 view without format, team or eliminated", () => {
    const view = projectView({
      lib: {
        duelQueryField: () => ({ flags: 0n, players: [0, 1].map(() => ({ monsters: [vacant], spells: [vacant], deck_size: 5, extra_size: 1 })), chain: [] }),
        duelQueryLocation: () => [],
      } as never,
      handle: {} as never, cards, viewer: 0, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: null, promptSeat: null, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal",
    });
    expect(view.format).toBeUndefined();
    expect(view.seats[0]!.team).toBeUndefined();
    expect(view.seats[0]!.eliminated).toBeUndefined();
  });
});

describe("direct-attack pick", () => {
  it("reads 0xFFFF0000 | duelist", () => {
    expect(directAttackSeat(0xffff0002n)).toBe(2);
    expect(directAttackSeat(0xffff0000)).toBe(0);
    expect(directAttackSeat(1n << 20n)).toBeNull();
    expect(directAttackSeat(1234)).toBeNull();
  });

  it("labels each option with its seat", () => {
    const { prompt } = mapPrompt({ type: OcgMessageType.SELECT_OPTION, player: 0, options: [0xffff0001n, 0xffff0003n] } as never, cards, "p1");
    const choice = prompt as DuelPrompt;
    expect(choice.title).toBe("Select a duelist to attack");
    expect(choice.options.map((option) => [option.id, option.label, option.controller])).toEqual([
      ["opt:0", "Attack Player 2 directly", 1],
      ["opt:1", "Attack Player 4 directly", 3],
    ]);
  });

  it("names the opponent seat of a placement mask", () => {
    const places = parseFieldPlaces(0x0000_0000 | (0x1f << 16), 2, 0);
    expect(places.some((place) => place.player === 0 && place.location === OcgLocation.MZONE)).toBe(true);
    expect(places.some((place) => place.player === 3)).toBe(false);
  });

  it("names a living seat for the opponent half of a place prompt at seat 2 of ffa3 (fuzz ffa3-3, ffa3-12)", () => {
    // Seat 2 places a token on another field: the upper half has MZONE 0, 2, 3 and 4 free. player ^ 1 is 3, no seat.
    const mask = ~(0b11101 << 16) >>> 0;
    const mapped = mapPrompt({ type: OcgMessageType.SELECT_PLACE, player: 2, count: 1, field_mask: mask } as never, cards, "p1", undefined, { placeOpponent: 0 });
    const prompt = mapped.prompt as DuelPrompt;
    expect(prompt.options.map((option) => [option.controller, option.location, option.sequence])).toEqual([
      [0, OcgLocation.MZONE, 0],
      [0, OcgLocation.MZONE, 2],
      [0, OcgLocation.MZONE, 3],
      [0, OcgLocation.MZONE, 4],
    ]);
    const single = mapPrompt({ type: OcgMessageType.SELECT_PLACE, player: 2, count: 1, field_mask: ~(1 << 16) >>> 0 } as never, cards, "p2", undefined, { placeOpponent: 1 });
    expect(autoResponse(single)).toEqual({ type: OcgResponseType.SELECT_PLACE, places: [{ player: 1, location: OcgLocation.MZONE, sequence: 0 }] });
  });
});

describe("board compiler for N seats", () => {
  it("compiles p2 in ffa3 and keeps the format", () => {
    const compiled = compileBoard({ format: "ffa3", p2: { lp: 4000 } });
    expect(compiled.options.decks).toHaveLength(3);
    expect(compiled.options.format).toBe("ffa3");
    expect(compiled.options.startupScripts![0]!.content).toContain("Duel.SetLP(2,4000)");
  });

  it("compiles four seats for tag and rejects p3 in ffa3", () => {
    expect(compileBoard({ format: "tag" }).options.decks).toHaveLength(4);
    expect(() => compileBoard({ format: "ffa3", p3: {} })).toThrow(/does not fit format "ffa3"/);
  });

  it("still rejects p2 in 1v1", () => {
    expect(() => compileBoard({ p2: {} })).toThrow(/multi-player format/);
  });

  it("rejects a non-p0 start in a multi-player board", () => {
    expect(() => compileBoard({ format: "ffa3", turn: "p1" })).toThrow(/turn of p0/);
  });
});

// Live smoke: only when the multi core has Debug.SetupDuelists (agent T0 adds it).
async function probeSetupDuelists(): Promise<boolean> {
  try {
    const bytes = readFileSync(multiWasmPath);
    const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const lib = await createCore({ sync: true, wasmBinary });
    const team = { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 };
    const handle = lib.createDuel({
      flags: 0n,
      seed: [1n, 2n, 3n, 4n],
      team1: team,
      team2: team,
      cardReader: () => null as OcgCardData | null,
      scriptReader: () => null,
      errorHandler: () => undefined,
    });
    if (!handle) return false;
    const ok = lib.loadScript(handle, "probe.lua", "Debug.SetupDuelists(3,0,1,2)");
    lib.destroyDuel(handle);
    return ok;
  } catch {
    return false;
  }
}

const setupDuelistsAvailable = await probeSetupDuelists();

function vanillaMain(count = 40): number[] {
  const db = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
  try {
    const rows = db.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all() as { id: number }[];
    return rows.map((row) => row.id).slice(0, count);
  } finally {
    db.close();
  }
}

describe("live N-seat duel", () => {
  const multiWasmBinary = (() => {
    try {
      const bytes = readFileSync(multiWasmPath);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch {
      return undefined;
    }
  })();

  itWithCores("starts a 3-seat free-for-all and shows every seat", needs.setupDuelists(setupDuelistsAvailable, multiWasmPath), async () => {
    const decks = [0, 1, 2].map(() => ({ main: vanillaMain(), extra: [], side: [] }));
    const game = await createEngineGame({
      mode: "normal",
      format: "ffa3",
      decks,
      seed: ["11", "22", "33", "44"],
      dataDirectory,
      multiWasmBinary,
      settings: { visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss", validateDeck: false, shuffleDeck: true },
    });
    try {
      const view = game.view(0);
      expect(view.format).toBe("ffa3");
      expect(view.seats).toHaveLength(3);
      expect(view.seats.map((seat) => seat.hand.length)).toEqual([5, 5, 5]);
      expect(view.seats[0]!.hand.every((card) => card.code != null)).toBe(true);
      expect(view.seats[1]!.hand.every((card) => card.code == null)).toBe(true);
      expect(() => game.view(3)).toThrow("Invalid seat");
      expect(game.view(view.turnSeat).prompt).not.toBeNull();
    } finally {
      game.close();
    }
  });
});

describe("engine diagnostics, disabled zones and the first win", () => {

  it("accepts only the first result", () => {
    expect(acceptsResult(null)).toBe(true);
    expect(acceptsResult({ winnerSeat: 1, reason: "x" })).toBe(false);
    expect(acceptsResult({ winnerSeat: null, reason: "draw" })).toBe(false);
  });

  const settings = { visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true };
  const winScript = (win: string) => ({
    name: "win.lua",
    content: `local e=Effect.GlobalEffect() e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS) e:SetCode(EVENT_PHASE_START+PHASE_DRAW) e:SetOperation(function() ${win} end) Duel.RegisterEffect(e,0)`,
  });

  it("records the win in the ring buffer and keeps it out of the views", async () => {
    const decks = [0, 1].map(() => ({ main: vanillaMain(), extra: [], side: [] }));
    const game = await createEngineGame({ mode: "normal", decks, seed: ["1", "2", "3", "4"], dataDirectory, settings, startupScripts: [winScript("Duel.Win(1,0x10)")] });
    try {
      expect(game.view(0).result?.winnerSeat).toBe(1);
      expect(game.diagnostics()).toEqual([{ turn: 1, phase: "draw", kind: "win", seat: 1, detail: "player 1 reason 16" }]);
      expect(JSON.stringify(game.view(0))).not.toContain("win-ignored");
      expect(JSON.stringify(game.view(0))).not.toContain("diagnostics");
    } finally {
      game.close();
    }
  });

  it("puts a disabled zone of a two-seat duel in the seat view", async () => {
    const decks = [0, 1].map(() => ({ main: vanillaMain(), extra: [], side: [] }));
    // Disable Monster Zone 1 of duelist 0 and Monster Zone 3 of duelist 1.
    const disable = { name: "disable.lua", content: "local e=Effect.GlobalEffect() e:SetType(EFFECT_TYPE_FIELD) e:SetCode(EFFECT_DISABLE_FIELD) e:SetValue(0x1|(0x4<<16)) Duel.RegisterEffect(e,0)" };
    const game = await createEngineGame({ mode: "normal", decks, seed: ["1", "2", "3", "4"], dataDirectory, settings, startupScripts: [disable] });
    try {
      const view = game.view(0);
      expect(view.seats[0]!.disabledZones).toBe(0x1);
      expect(view.seats[1]!.disabledZones).toBe(0x4);
    } finally {
      game.close();
    }
  });

  itWithCores("names a missing Debug.EliminateDuelist, or eliminates a seat and records it", needs.installedMulti(dataDirectory), async () => {
    const decks = [0, 1, 2].map(() => ({ main: vanillaMain(), extra: [], side: [] }));
    const game = await createEngineGame({ mode: "normal", format: "ffa3", decks, seed: ["11", "22", "33", "44"], dataDirectory, settings });
    try {
      let error: Error | null = null;
      try {
        game.eliminate(2, 0);
      } catch (caught) {
        error = caught as Error;
      }
      if (error) {
        expect(error.message).toMatch(/no Debug\.EliminateDuelist/);
        expect(game.diagnostics().some((entry) => entry.kind === "eliminate")).toBe(false);
      } else {
        expect(game.diagnostics().some((entry) => entry.kind === "eliminate" && entry.seat === 2)).toBe(true);
        // The core applies the loss at its next Adjust, after the open prompt is answered: right after the call the seat
        // is out (it held the prompt) or leaving (pendingElimination). One answer later it is out in both cases.
        const seatNow = game.view(0).seats[2]!;
        expect(seatNow.eliminated === true || seatNow.pendingElimination === true).toBe(true);
        if (!seatNow.eliminated) {
          const holder = [0, 1, 2].find((seat) => game.view(seat).prompt);
          expect(holder).toBeDefined();
          const prompt = game.view(holder!).prompt as DuelPrompt;
          game.answer(holder!, prompt.id, chooseSurrenderedAnswer(prompt));
        }
        expect(game.view(0).seats[2]!.eliminated).toBe(true);
        expect(game.view(0).seats[2]!.pendingElimination ?? false).toBe(false);
      }
    } finally {
      game.close();
    }
  });

  it("keeps at most 200 entries", async () => {
    expect(DIAGNOSTICS_LIMIT).toBe(200);
  });
});

describe("seats 2 and 3 get their cards (SetupDuelists runs before any card is added)", () => {
  const settings = { visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true };

  itEachWithCores<[DuelFormat, number]>(needs.installedMulti(dataDirectory), [["ffa3", 3], ["ffa4", 4], ["tag", 4]], "%s: every seat has a full Deck and a 5-card hand", async (format, seats) => {
    const decks = Array.from({ length: seats }, () => ({ main: vanillaMain(40), extra: [], side: [] }));
    const game = await createEngineGame({ mode: "normal", format, decks, seed: ["5", "6", "7", "8"], dataDirectory, settings });
    try {
      // The view reads each seat with QueryLocation; 40 cards = 5 in hand + 35 in the Deck.
      const view = game.view(null);
      expect(view.seats).toHaveLength(seats);
      for (const seat of view.seats) {
        expect([seat.seat, seat.hand.length, seat.deckCount]).toEqual([seat.seat, 5, 35]);
      }
    } finally {
      game.close();
    }
  });
});

describe("journaled eliminations", () => {
  it("reads the code of an eliminate command", () => {
    expect(eliminationCodeOf("eliminate:0")).toBe(0);
    expect(eliminationCodeOf("eliminate:3")).toBe(3);
    expect(eliminationCodeOf("eliminate:x")).toBeNull();
    expect(eliminationCodeOf("eliminate:-1")).toBeNull();
    expect(eliminationCodeOf("p1-2")).toBeNull();
  });

  itWithCores("replay-journal.ts applies an eliminate command instead of checking the prompt id", needs.installedMulti(dataDirectory), () => {
    const folder = mkdtempSync(join(tmpdir(), "duel-journal-"));
    try {
      const file = join(folder, "journal.json");
      writeFileSync(file, JSON.stringify({
        format: "yugidraft-duel-journal/1", mode: "normal", tableFormat: "ffa3", masterRule: 5, bundleVersion: null,
        seed: ["11", "22", "33", "44"], settings: null,
        decks: [0, 1, 2].map(() => ({ main: vanillaMain(), extra: [], side: [] })),
        commands: [{ seq: 1, seat: 0, command: { promptId: "eliminate:0", revision: 0, answer: {} } }],
      }));
      let output = "";
      try {
        output = execFileSync("npx", ["tsx", "scripts/replay-journal.ts", file, "--data", dataDirectory], {
          cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      }
      // With a core that has Debug.EliminateDuelist the replay succeeds; an older core names the missing call.
      // Either way the script must not stop on a prompt mismatch.
      expect(output).not.toMatch(/mismatch/);
      expect(output).toMatch(/replayed 1 of 1 answers|no Debug\.EliminateDuelist/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("core identity and core log lines", () => {
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const deck = () => ({ main: vanillaMain(), extra: [], side: [] });

  it("reports the sha256 and the file name of the standard wasm it loaded", async () => {
    const game = await createEngineGame({ mode: "normal", decks: [deck(), deck()], seed: ["1", "2", "3", "4"], dataDirectory });
    try {
      const core = game.coreInfo();
      expect(core.wasmFile).toBe("ocgcore.standard.wasm");
      expect(core.wasmSha).toBe(sha(join(dataDirectory, "ocgcore.standard.wasm")));
      // The first prompt is open: the counters start again at every prompt.
      expect(core.callsSinceLastPrompt).toBe(0);
      expect(core.messagesSinceLastPrompt).toBe(0);
    } finally {
      game.close();
    }
  });

  itWithCores("reports the multi wasm of the data directory for three seats", needs.installedMulti(dataDirectory), async () => {
    const game = await createEngineGame({ mode: "normal", format: "ffa3", decks: [deck(), deck(), deck()], seed: ["1", "2", "3", "4"], dataDirectory });
    try {
      expect(game.coreInfo()).toMatchObject({ wasmFile: "ocgcore.multi.wasm", wasmSha: sha(join(dataDirectory, "ocgcore.multi.wasm")) });
    } finally {
      game.close();
    }
  });

  it("names a provided test binary and hashes its bytes", async () => {
    const bytes = readFileSync(join(dataDirectory, "ocgcore.standard.wasm"));
    const game = await createEngineGame({
      mode: "normal", decks: [deck(), deck()], seed: ["1", "2", "3", "4"], dataDirectory,
      standardWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    });
    try {
      expect(game.coreInfo()).toMatchObject({ wasmFile: "(provided binary)", wasmSha: sha(join(dataDirectory, "ocgcore.standard.wasm")) });
    } finally {
      game.close();
    }
  });

  it("puts the core's stderr lines into the diagnostics ring with kind stderr", async () => {
    const game = await createEngineGame({
      mode: "normal", decks: [deck(), deck()], seed: ["1", "2", "3", "4"], dataDirectory,
      startupScripts: [{ name: "census.lua", content: 'io.stderr:write("YGO_N_TRAP_LOG census 42\\n")' }],
    });
    try {
      const lines = game.diagnostics().filter((entry) => entry.kind === "stderr");
      expect(lines.map((entry) => entry.detail)).toEqual(["YGO_N_TRAP_LOG census 42"]);
      expect(lines[0]!.seat).toBeNull();
    } finally {
      game.close();
    }
  });
});
