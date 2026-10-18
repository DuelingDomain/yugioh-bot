// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { defaultDuelSettings, seatCountFor, teamOfSeat, type DuelRoom } from "@yugidraft/shared/duels";
import { GameWorker } from "../../duel-server/src/worker-client.js";
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
describeWithCores("real multiplayer Exodia result screen", [needs.cards(DATA), needs.installedMulti(DATA), needs.file("Domain multi core", `${DATA}/ocgcore.multi-domain.wasm`)], () => {
  for (const mode of ["normal", "domain"] as const) {
    it.each(["ffa3", "ffa4", "tag"] as const)(`${mode} %s: an opening Exodia hand gives wins and losses without places`, async format => {
      const count = seatCountFor(format), actor = count - 1;
      const decks = Array.from({ length: count }, (_, i) => ({
        main: [...(i === actor ? PIECES : Array(5).fill(15025844)), ...Array(mode === "domain" ? 55 : 35).fill(15025844)],
        extra: [], side: [], ...(mode === "domain" ? { deckMaster: 89631139 } : {}),
      }));
      const settings = { ...defaultDuelSettings(mode), startingHand: 5, shuffleDeck: false, validateDeck: false };
      const worker = new GameWorker();
      try {
        await worker.create({ mode, format, decks, settings, seed: ["1", "2", "3", "4"], dataDirectory: DATA });
        const engine = await worker.view(null);
        expect(engine.result).toMatchObject({ winnerSeat: format === "tag" ? actor % 2 : actor, victory: "exodia" });
        const session = { ...makeSeriesRoom().session, mode, format, settings, winnerSeat: engine.result!.winnerSeat,
          resultReason: engine.result!.reason, seats: Array.from({ length: count }, (_, seat) => ({
            seat, playerId: seat + 1, displayName: `Player ${seat + 1}`, ready: true, isBot: false,
          })) };
        for (let viewer = 0; viewer < count; viewer++) {
          const room: DuelRoom = { ...makeSeriesRoom({ mySeat: viewer, series: null }), session, engine: await worker.view(viewer) };
          const won = teamOfSeat(format, viewer) === teamOfSeat(format, actor);
          const model = describeDuelResult(room);
          expect(model.outcome).toBe(won ? "win" : "lose");
          expect(model.scores.filter(score => score.isWinner).map(score => score.seat)).toEqual(
            engine.seats.filter(seat => teamOfSeat(format, seat.seat) === teamOfSeat(format, actor)).map(seat => seat.seat));
          const ranks = placings(room.engine!, [[0], [1], [2], [3]]);
          expect(ranks).toEqual([]);
          render(<DuelResultScreen room={room} slug={session.slug} reducedMotion soundEnabled={false} onClose={() => undefined}
            placings={ranks.length ? ranks.map(row => ({ seat: row.seat, place: row.place, label: placeLabel(row.place) })) : undefined} />);
          expect(screen.getByRole("dialog")).toHaveAccessibleName(won ? "YOU WIN" : "YOU LOSE");
          expect(screen.getByRole("list", { name: "Final Life Points" }).querySelectorAll("[data-winner=true]")).toHaveLength(format === "tag" ? 2 : 1);
          expect(document.querySelector("[data-place]")).toBeNull();
          cleanup();
        }
      } finally { cleanup(); await worker.close(); }
    }, 30_000);
  }
});
