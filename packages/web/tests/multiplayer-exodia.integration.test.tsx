// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { defaultDuelSettings, seatCountFor, teamOfSeat, type DuelRoom } from "@yugidraft/shared/duels";
import { GameWorker } from "../../duel-server/src/worker-client.js";
import { chooseSurrenderedAnswer } from "../../duel-server/src/practice-bot.js";
import { compileBoard } from "../../duel-server/src/presets/board.js";
import { OWNER_HANDS_EXODIA_SCENARIOS } from "../../duel-server/tests/scenarios/multiplayer/owner-hands-exodia.js";
import { describeWithCores, needs } from "../../duel-server/tests/support/cores.js";
import { engineDataDirectory as DATA } from "../../duel-server/tests/engine-data-dir.js";
import { describeDuelResult, DuelResultScreen } from "../src/components/duel/duel-result";
import { placings, placeLabel } from "../src/components/duel/table/seat-state";
import { makeSeriesRoom } from "./helpers/duel-series";

const PIECES = [33396948, 8124921, 44519536, 70903634, 7902349];
// Vite treats the server helper's static new URL as a browser asset in jsdom. Use its explicit test data path.
vi.mock("../../duel-server/tests/engine-data-dir.js", () => {
  const engineDataDirectory = process.env.DUEL_DATA_DIR ?? `${process.cwd()}/../../data/duel-engine-next`;
  return { engineDataDirectory, currentEngineDataDirectory: () => engineDataDirectory };
});
describeWithCores("real 1v1 Domain Exodia result screen", [needs.cards(DATA), needs.domain(DATA),
  needs.file("legacy Domain core", `${DATA}/ocgcore.domain.legacy.wasm`)], () => {
  const cases = (["legacy", "pinned"] as const).flatMap(engine => [0, 1].map(winner => ({ engine, winner })));
  it.each(cases)("$engine: seat $winner wins with reason 0x10 and both players see the result", async ({ engine, winner }) => {
    const settings = { ...defaultDuelSettings("domain"), shuffleDeck: false, validateDeck: false };
    const worker = new GameWorker();
    try {
      await worker.create({ engine, mode: "domain", format: "1v1", dataDirectory: DATA, seed: ["1", "2", "3", "4"], settings,
        decks: [0, 1].map(seat => ({ main: [...(seat === winner ? PIECES : Array(5).fill(15025844)), ...Array(55).fill(15025844)],
          extra: [], side: [], deckMaster: 48305365 })) });
      const result = (await worker.view(null)).result!;
      expect(result).toEqual({ winnerSeat: winner, reason: 'Victory by the effect of "Exodia the Forbidden One"' });
      if (engine === "pinned") expect(await worker.diagnostics()).toContainEqual(
        expect.objectContaining({ kind: "win", detail: `player ${winner} reason 16` }));
      for (const viewer of [0, 1, null]) {
        const base = makeSeriesRoom({ mySeat: viewer, series: null });
        const room: DuelRoom = { ...base, session: { ...base.session, mode: "domain", format: "1v1", settings,
          winnerSeat: winner, resultReason: result.reason }, engine: await worker.view(viewer) };
        const model = describeDuelResult(room);
        expect(model.outcome).toBe(viewer === null ? "spectator" : viewer === winner ? "win" : "lose");
        expect(model.reason).toBe(result.reason);
        render(<DuelResultScreen room={room} slug={room.session.slug} reducedMotion soundEnabled={false} onClose={() => undefined} />);
        expect(screen.getByRole("dialog")).toHaveAccessibleName(model.headline);
        expect(screen.getByRole("dialog")).toHaveAccessibleDescription(result.reason);
        expect(screen.getByRole("list", { name: "Final Life Points" }).querySelector("[data-winner=true]"))
          .toHaveAttribute("data-seat", String(winner));
        cleanup();
      }
    } finally { cleanup(); await worker.close(); }
  }, 30_000);
});
describeWithCores("real multiplayer Exodia result screen", [needs.cards(DATA), needs.installedMulti(DATA), needs.file("Domain multi core", `${DATA}/ocgcore.multi-domain.wasm`)], () => {
  for (const mode of ["normal", "domain"] as const) {
    const cases = (["ffa3", "ffa4", "tag"] as const).flatMap(format => [false, true].map(draw => ({ format, draw })));
    it.each(cases)(`${mode} $format (draw: $draw): complete Exodia hands give the result without places`, async ({ format, draw }) => {
      const count = seatCountFor(format), actor = count - 1;
      const decks = Array.from({ length: count }, (_, i) => ({
        main: [...((draw ? [1, 2].includes(i) : i === actor) ? PIECES : Array(5).fill(15025844)), ...Array(mode === "domain" ? 55 : 35).fill(15025844)],
        extra: [], side: [], ...(mode === "domain" ? { deckMaster: 89631139 } : {}),
      }));
      const settings = { ...defaultDuelSettings(mode), startingHand: 5, shuffleDeck: false, validateDeck: false };
      const worker = new GameWorker();
      try {
        const scenario = OWNER_HANDS_EXODIA_SCENARIOS.find(s => s.id === `owner-exodia-draw-${format}-1-2${mode === "domain" ? "-domain" : ""}`)!;
        const options = draw ? compileBoard(scenario.setup, DATA).options : { mode, format, decks, settings };
        await worker.create({ ...options, seed: ["1", "2", "3", "4"], dataDirectory: DATA });
        if (draw) {
          for (let step = 0; step < 40 && !(await worker.view(null)).result; step++) {
            const views = await Promise.all(Array.from({ length: count }, (_, seat) => worker.view(seat)));
            const prompt = views.find(view => view.prompt)?.prompt;
            expect(prompt).toBeDefined();
            const activation = prompt!.options.find(option => option.id.startsWith("activate:") && option.card?.code === 72892473);
            await worker.answer(prompt!.seat, prompt!.id, activation ? { choice: activation.id } : chooseSurrenderedAnswer(prompt!));
          }
        }
        const engine = await worker.view(null);
        expect(engine.result).toMatchObject({ winnerSeat: draw ? null : format === "tag" ? actor % 2 : actor, victory: "exodia" });
        const session = { ...makeSeriesRoom().session, mode, format, settings, winnerSeat: engine.result!.winnerSeat,
          resultReason: engine.result!.reason, seats: Array.from({ length: count }, (_, seat) => ({
            seat, playerId: seat + 1, displayName: `Player ${seat + 1}`, ready: true, isBot: false,
          })) };
        for (let viewer = 0; viewer < count; viewer++) {
          const room: DuelRoom = { ...makeSeriesRoom({ mySeat: viewer, series: null }), session, engine: await worker.view(viewer) };
          const won = !draw && teamOfSeat(format, viewer) === teamOfSeat(format, actor);
          const model = describeDuelResult(room);
          expect(model.outcome).toBe(draw ? "draw" : won ? "win" : "lose");
          expect(model.scores.filter(score => score.isWinner).map(score => score.seat)).toEqual(
            engine.seats.filter(seat => !draw && teamOfSeat(format, seat.seat) === teamOfSeat(format, actor)).map(seat => seat.seat));
          const ranks = placings(room.engine!, [[0], [1], [2], [3]]);
          expect(ranks).toEqual([]);
          render(<DuelResultScreen room={room} slug={session.slug} reducedMotion soundEnabled={false} onClose={() => undefined}
            placings={ranks.length ? ranks.map(row => ({ seat: row.seat, place: row.place, label: placeLabel(row.place) })) : undefined} />);
          expect(screen.getByRole("dialog")).toHaveAccessibleName(draw ? "DRAW" : won ? "YOU WIN" : "YOU LOSE");
          expect(screen.getByRole("list", { name: "Final Life Points" }).querySelectorAll("[data-winner=true]")).toHaveLength(draw ? 0 : format === "tag" ? 2 : 1);
          expect(document.querySelector("[data-place]")).toBeNull();
          cleanup();
        }
      } finally { cleanup(); await worker.close(); }
    }, 30_000);
  }
});
