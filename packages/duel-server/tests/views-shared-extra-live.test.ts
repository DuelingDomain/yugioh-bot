import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { seatCountFor, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { readCoreCapabilities } from "../src/core-capabilities.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { defineScenario, endTurn, select, specialSummon, zone, type Step } from "./support/dsl.js";
import { describeWithCores, needs } from "./support/cores.js";
import { Session } from "./support/session.js";

function core(mode: DuelMode) {
  const file = mode === "domain" ? "ocgcore.multi-domain.wasm" : "ocgcore.multi.wasm";
  const path = (mode === "domain" ? process.env.DOMAIN_MULTI_WASM : process.env.NSEAT_WASM) ?? join(dataDirectory, file);
  try {
    const bytes = readFileSync(path);
    const sha = createHash("sha256").update(bytes).digest("hex");
    return { path, sha, binary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      c6: readCoreCapabilities(dataDirectory, file, sha).ffa4SharedExtraZones };
  } catch {
    return { path, sha: "", binary: undefined, c6: false };
  }
}

function viewers(format: DuelFormat): Array<number | null> {
  return [...Array.from({ length: seatCountFor(format) }, (_, seat) => seat), null];
}

async function start(mode: DuelMode, format: DuelFormat, binary: ArrayBuffer | undefined, extra: Partial<BoardSpec> = {}) {
  const board: BoardSpec = { mode, format, ...extra };
  if (mode === "domain") for (const seat of ["p0", "p1", "p2", "p3"] as const) {
    if (Number(seat[1]) < seatCountFor(format)) board[seat] = { ...board[seat], deckMaster: "Mystical Elf" };
  }
  const compiled = compileBoard(board, dataDirectory);
  const game = await createEngineGame({ ...compiled.options, settings: { ...compiled.options.settings!, drawPerTurn: 0 },
    seed: ["1", "2", "3", "4"], dataDirectory, ...(format === "1v1" ? {} : { multiWasmBinary: binary }) });
  const session = new Session(defineScenario({ id: "p5-view-live", title: "shared zones view", source: "Opus review finding 3",
    tags: ["multiplayer", "view"], setup: board, steps: [] }), game);
  session.reachMainPhase();
  return { game, session };
}

function expectPairing(game: EngineGame, pairs: Array<number | null>) {
  for (const viewer of viewers("ffa4")) {
    const view = game.view(viewer);
    expect(view.seats.map((seat) => seat.sharedExtraWith)).toEqual(pairs);
    expect(view.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 8000, 8000]);
  }
}

for (const mode of ["normal", "domain"] as const) {
  const loaded = core(mode);
  describeWithCores(`${mode} live shared EMZ view`, [needs.file(`${mode} multi core`, loaded.path), needs.cards(dataDirectory),
    needs.scripts(dataDirectory), needs.liveNseat(true), mode === "domain" ? [needs.domain(dataDirectory), needs.domainScript(dataDirectory)] : needs.standard(dataDirectory)], () => {
    it("keeps the pair pending and clears it after real MSG 200", async () => {
      const { game } = await start(mode, "ffa4", loaded.binary);
      try {
        expect(game.coreInfo().wasmSha).toBe(loaded.sha);
        const pairs = loaded.c6 ? [2, 3, 0, 1] : [null, null, null, null];
        expectPairing(game, pairs);
        game.eliminate(2, 0);
        expect(game.view(null).seats[2]).toMatchObject({ pendingElimination: true, eliminated: false });
        expectPairing(game, pairs);
        for (let guard = 0; guard < 12 && !game.diagnostics().some((entry) => entry.kind === "msg200" && entry.seat === 2); guard++) {
          const holder = viewers("ffa4").find((seat) => seat != null && game.view(seat).prompt);
          expect(holder).toBeTypeOf("number");
          const prompt = game.view(holder!).prompt!;
          game.answer(holder!, prompt.id, chooseSurrenderedAnswer(prompt));
        }
        expect(game.diagnostics().some((entry) => entry.kind === "msg200" && entry.seat === 2)).toBe(true);
        expectPairing(game, loaded.c6 ? [null, 3, null, 1] : [null, null, null, null]);
        for (const viewer of viewers("ffa4")) {
          const view = game.view(viewer);
          expect(view.result).toBeNull();
          for (const seat of view.seats) {
            expect(seat.eliminated).toBe(seat.seat === 2);
            expect(seat.pendingElimination ?? false).toBe(false);
            expect(seat.deckCount).toBe(seat.seat === 2 ? 0 : 20);
            expect(seat.hand).toEqual([]);
            expect(seat.monsters).toEqual(Array(7).fill(null));
            expect(seat.spells).toEqual(Array(8).fill(null));
            expect([seat.extra, seat.graveyard, seat.banished]).toEqual([[], [], []]);
            if (mode === "domain") expect(seat.deckMaster?.inZone).toBe(seat.seat !== 2);
          }
        }
      } finally { game.close(); }
    });

    it("checks the C6 flag against seat 2's real place prompt and projects seat 0's EMZ card", async () => {
      const { game, session } = await start(mode, "ffa4", loaded.binary, {
        p0: { monsters: [null, null, null, null, null, "Imduk the World Chalice Dragon"] },
        p2: { monsters: ["Mystical Elf"], extra: ["Link Spider"] },
      });
      try {
        const steps: Step[] = [endTurn("p0"), endTurn("p1"), specialSummon("Link Spider", "p2"),
          select({ card: "Mystical Elf", owner: "p2", from: "mzone", seq: 0 })];
        steps.forEach((step, index) => session.run(step, index + 1));
        const prompt = game.view(2).prompt!;
        expect(prompt.kind).toBe("places");
        const shared = prompt.options[0]?.sequence === 3;
        expect(prompt.options.map((option) => [option.controller, option.location, option.sequence]))
          .toEqual(shared
            ? [[2, OcgLocation.MZONE, 3], [2, OcgLocation.MZONE, 5]]
            : [[2, OcgLocation.MZONE, 5], [2, OcgLocation.MZONE, 6]]);
        expect(loaded.c6, "The SOURCE C6 flag must match the real core geometry").toBe(shared);
        expectPairing(game, shared ? [2, 3, 0, 1] : [null, null, null, null]);
        session.run(zone("p2", shared ? "m3" : "emz0", "p2"), 5);
        for (const viewer of viewers("ffa4")) {
          const view = game.view(viewer);
          expect(view.seats[0]!.monsters[5]).toMatchObject({ name: "Imduk the World Chalice Dragon", controller: 0, sequence: 5 });
          const sequence = shared ? 3 : 5;
          expect(view.seats[2]!.monsters[sequence]).toMatchObject({ name: "Link Spider", controller: 2, sequence });
          for (const seat of view.seats) {
            expect(seat.eliminated).toBe(false);
            expect(seat.lp).toBe(8000);
            expect(seat.deckCount).toBe(20);
            expect(seat.hand).toEqual([]);
            expect(seat.monsters.filter(Boolean).map((card) => card!.name))
              .toEqual(seat.seat === 0 ? ["Imduk the World Chalice Dragon"] : seat.seat === 2 ? ["Link Spider"] : []);
            expect(seat.graveyard.map((card) => card.name)).toEqual(seat.seat === 2 ? ["Mystical Elf"] : []);
            expect(seat.extraCount).toBe(0);
            expect([seat.extra, seat.banished]).toEqual([[], []]);
            expect(seat.spells).toEqual(Array(8).fill(null));
          }
        }
      } finally { game.close(); }
    });

    it.each<DuelFormat>(["ffa3", "tag", "1v1"])("keeps %s views separate on the real engine", async (format) => {
      const { game } = await start(mode, format, loaded.binary);
      try {
        for (const viewer of viewers(format)) {
          const view = game.view(viewer);
          for (const seat of view.seats) {
            if (format === "1v1") expect(seat).not.toHaveProperty("sharedExtraWith");
            else expect(seat.sharedExtraWith).toBeNull();
            expect(seat.lp).toBe(format === "tag" ? 16000 : 8000);
            expect(seat.deckCount).toBe(20);
            expect([seat.hand, seat.extra, seat.graveyard, seat.banished]).toEqual([[], [], [], []]);
            expect(seat.monsters).toEqual(Array(7).fill(null));
            expect(seat.spells).toEqual(Array(8).fill(null));
          }
        }
      } finally { game.close(); }
    });
  });
}
