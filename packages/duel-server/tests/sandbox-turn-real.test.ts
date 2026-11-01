import { expect } from "vitest";
import type { DuelEngineView, DuelFormat, DuelMode } from "@yugidraft/shared/duels";
import { parseSandboxBoard, seatCountFor } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { compileBoard, DUELIST_IDS } from "../src/presets/board.js";
import { resolveCard } from "../src/presets/catalog.js";
import { chooseScripted } from "../src/scripted-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary } from "./support/session.js";

function advanceUntil(game: EngineGame, predicate: (view: DuelEngineView) => boolean): DuelEngineView {
  for (let step = 0; step < 200; step++) {
    const view = game.view(0);
    if (predicate(view)) return view;
    expect(view.result).toBeNull();
    const current = view.seats.map((_, seat) => game.view(seat)).find((entry) => entry.prompt);
    expect(current?.prompt, JSON.stringify(view.log)).toBeTruthy();
    const prompt = current!.prompt!;
    game.answer(prompt.seat, prompt.id, chooseScripted([], prompt, current!, { seat: prompt.seat }).answer);
  }
  throw new Error("Did not reach the requested phase within 200 answers.");
}

for (const format of ["1v1", "ffa3", "ffa4", "tag"] satisfies DuelFormat[]) {
  const core = format === "1v1" ? needs.standard(DATA) : liveNseat;
  itWithCores(`${format} offers real Draw and Standby response windows`, [needs.cards(DATA), core], async () => {
    const jar = resolveCard("Jar of Greed", DATA);
    const compiled = compileBoard(parseSandboxBoard({ format, p0: { spells: [{ card: jar, pos: "set" }] } }), DATA);
    const game = await createEngineGame({ ...compiled.options, dataDirectory: DATA,
      multiWasmBinary: nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
    try {
      const draw = game.view(0);
      expect(draw.phase).toBe("draw");
      expect(draw.prompt?.options.some((option) => option.card?.code === jar)).toBe(true);
      expect(draw.seats[0].hand).toHaveLength(1);
      const standby = advanceUntil(game, (view) => view.phase === "standby");
      expect(standby.prompt?.options.some((option) => option.card?.code === jar)).toBe(true);
      expect(advanceUntil(game, (view) => view.phase === "main1").turn).toBe(1);
    } finally { game.close(); }
  });

  itWithCores(`${format} skips only the opening draw on the selected seat`, [needs.cards(DATA), core], async () => {
    const turn = seatCountFor(format) - 1;
    const compiled = compileBoard({ format, turn: DUELIST_IDS[turn], startAt: "draw", skipOpeningDraw: true }, DATA);
    const game = await createEngineGame({ ...compiled.options, dataDirectory: DATA,
      multiWasmBinary: nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
    try {
      const first = game.view(turn);
      expect(first.turnSeat).toBe(turn);
      expect(first.seats[turn].hand).toHaveLength(0);
      expect(first.log.map((entry) => entry.text)).toContain("standby");
      expect(first.log.map((entry) => entry.text)).not.toContain("draw");
      const next = advanceUntil(game, (view) => view.turn === first.turn + 1 && view.phase === "main1");
      expect(next.turnSeat).toBe(0);
      expect(next.seats[0].hand).toHaveLength(1);
    } finally { game.close(); }
  });

  for (const attackFirstTurn of [false, true]) {
    itWithCores(`${format} honors attackFirstTurn=${attackFirstTurn}`, [needs.cards(DATA), core], async () => {
      const compiled = compileBoard(parseSandboxBoard({ format, attackFirstTurn }), DATA);
      const game = await createEngineGame({ ...compiled.options, dataDirectory: DATA,
        multiWasmBinary: nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
      try {
        const main = advanceUntil(game, (view) => view.phase === "main1");
        expect(main.prompt?.options.some((option) => option.id === "to_bp")).toBe(attackFirstTurn);
      } finally { game.close(); }
    });
  }
}

itWithCores("ffa3 starts on p2, draws once, and restores p0 and p1 turns", [needs.cards(DATA), liveNseat], async () => {
  const compiled = compileBoard(parseSandboxBoard({ format: "ffa3", turn: "p2" }), DATA);
  const game = await createEngineGame({ ...compiled.options,
    dataDirectory: DATA, multiWasmBinary: nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
  try {
    const first = game.view(2);
    expect(first.turnSeat).toBe(2);
    expect(first.turn).toBe(3);
    expect(first.log.map((entry) => entry.text)).toEqual(expect.arrayContaining(["draw", "standby", "main1"]));
    expect(first.seats.map((seat) => seat.hand.length)).toEqual([0, 0, 1]);
    const main = advanceUntil(game, (view) => view.phase === "main1");
    expect(main.turnSeat).toBe(2);
    const next = advanceUntil(game, (view) => view.turn === 4 && view.phase === "main1");
    expect(next.turnSeat).toBe(0);
    expect(next.seats[0].hand).toHaveLength(1);
    const after = advanceUntil(game, (view) => view.turn === 5 && view.phase === "main1");
    expect(after.turnSeat).toBe(1);
  } finally {
    game.close();
  }
});

for (const mode of ["normal", "domain"] satisfies DuelMode[]) {
  for (const format of ["1v1", "ffa3", "ffa4", "tag"] satisfies DuelFormat[]) {
    const count = seatCountFor(format);
    const core = format === "1v1" ? [mode === "domain" ? needs.domain(DATA) : needs.standard(DATA)]
      : [liveNseat, ...(mode === "domain" ? needs.domainMulti(DATA) : [])];
    for (let turn = 0; turn < count; turn++) {
      itWithCores(`${mode} ${format} starts on p${turn} and then visits every seat`, [needs.cards(DATA), ...core], async () => {
        const seats = Object.fromEntries(DUELIST_IDS.slice(0, count).map((id) => [id, mode === "domain" ? { deckMaster: 15025844 } : {}]));
        const compiled = compileBoard(parseSandboxBoard({ format, mode, turn: DUELIST_IDS[turn], ...seats }), DATA);
        const game = await createEngineGame({ ...compiled.options,
          dataDirectory: DATA, multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
        try {
          const first = game.view(turn);
          expect(first.turnSeat).toBe(turn);
          expect(first.turn).toBe(turn + 1);
          expect(first.seats[turn].hand).toHaveLength(1);
          for (let offset = 1; offset <= seatCountFor(format); offset++) {
            const next = advanceUntil(game, (view) => view.turn === first.turn + offset && view.phase === "main1");
            expect(next.turnSeat).toBe((turn + offset) % seatCountFor(format));
          }
        } finally { game.close(); }
      });
    }
  }
}
