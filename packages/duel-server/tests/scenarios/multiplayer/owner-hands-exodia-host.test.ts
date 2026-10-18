import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, teamOfSeat, type DuelReplayV2, type DuelRoom } from "@yugidraft/shared/duels";
import { createDuelHost } from "../../../src/host.js";
import { getCurrentEngineResources } from "../../../src/engine-resource-resolver.js";
import { chooseSurrenderedAnswer } from "../../../src/practice-bot.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { engineDataDirectory as DATA } from "../../engine-data-dir.js";
import { seedIdentity } from "../../helpers/identity.js";
import { OWNER_HANDS_EXODIA_SCENARIOS } from "./owner-hands-exodia.js";
import { fileURLToPath } from "node:url";
// Load the UI source at runtime. Its separate TypeScript project uses browser module resolution.
const { placings } = await import(fileURLToPath(new URL("../../../../web/src/components/duel/table/seat-state.ts", import.meta.url)));

const SECRET = "owner-hands-exodia-integration";
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`${mode}: Exodia host, saved result and replay`, [needs.cards(DATA), needs.installedMulti(DATA), ...needs.domainMulti()], () => {
    const cases = ["ffa3", "ffa4", "tag"].map(format => ({ format: format as "ffa3" | "ffa4" | "tag", priorLoss: false }));
    cases.push({ format: "ffa3", priorLoss: true }, { format: "ffa4", priorLoss: true });
    it.each(cases)("$format (prior loss: $priorLoss) records one whole-duel result for every seat", async ({ format, priorLoss }) => {
      const db = new Database(":memory:"); migrate(db);
      const count = seatCountFor(format), actor = count - 1;
      const players = Array.from({ length: count }, (_, i) => seedIdentity(db, { guildId: "g", userId: 100 + i }).playerId);
      const service = createDuelService(db);
      const scenario = OWNER_HANDS_EXODIA_SCENARIOS.find(s => s.id === `owner-exodia-${format}-p${actor}${mode === "domain" ? "-domain" : ""}`)!;
      const compiled = compileBoard(scenario.setup).options;
      const resources = getCurrentEngineResources(DATA, { mode, format });
      const created = service.create({ guildId: "g", organizerPlayerId: players[0], name: "Exodia integration", mode, format,
        settings: { ...compiled.settings, turnSeconds: 0 } });
      for (const player of players.slice(1)) service.takeSeat(created.slug, "g", player);
      for (let i = 0; i < count; i++) service.setDeck(created.slug, "g", players[i], compiled.decks[i]);
      service.activateRecorded(created.slug, "g", players[0], ["1", "2", "3", "4"], resources.bundleVersion, null,
        { engine: "pinned", firstTurnDraw: false, scriptErrorMode: "strict", startupScripts: compiled.startupScripts!.map(s => s.content) }, resources.identity);
      const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000 });
      async function post<T>(op: string, seat = 0, extra: Record<string, unknown> = {}): Promise<T> {
        const raw = JSON.stringify({ op, guildId: "g", slug: created.slug, playerId: players[seat], ...extra });
        const url = "http://localhost/internal/duel";
        const response = await host.handle(new Request(url, { method: "POST", body: raw,
          headers: signedRequestHeaders({ url, method: "POST", body: raw, secret: SECRET, purpose: "duel-host" }) }));
        const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body as T;
      }
      try {
        expect(() => service.create({ guildId: "g", organizerPlayerId: players[0], name: "Ranked", mode, format, ranked: true })).toThrow("Only a 1v1 duel");
        if (priorLoss) {
          await post("view");
          const lost = await post<DuelRoom>("surrender", 1);
          expect(lost.engine?.eliminationOrder).toEqual([[1]]);
          expect(lost.engine?.result).toBeNull();
        }
        for (let step = 0; step < 100 && service.get(created.slug, "g").status === "active"; step++) {
          const rooms = await Promise.all(players.map((_, i) => post<DuelRoom>("view", i)));
          const open = rooms.find(room => room.engine?.prompt);
          if (!open) break;
          const view = open.engine!, prompt = view.prompt!;
          const action = prompt.context?.type === "action";
          const pot = prompt.options.find(o => o.id.startsWith("activate:") && o.card?.code === 55144522);
          const answer = action ? { choice: view.turnSeat === actor && pot ? pot.id : "to_ep" } : chooseSurrenderedAnswer(prompt);
          await post("respond", prompt.seat, { command: { promptId: prompt.id, revision: view.revision, answer } });
        }
        const session = service.get(created.slug, "g");
        const winnerSeat = format === "tag" ? actor % 2 : actor;
        expect(session).toMatchObject({ status: "completed", winnerSeat, winnerPlayerId: players[winnerSeat], ranked: false });
        expect(session.resultReason).toContain("Exodia the Forbidden One");
        const expected = { winnerSeat, reason: session.resultReason, victory: "exodia", ...(format === "tag" ? { winnerTeam: actor % 2 } : {}) };
        for (let viewer = 0; viewer < count; viewer++) {
          const saved = service.room(created.slug, "g", players[viewer], { includeStoredBoard: true });
          const live = await post<DuelRoom>("view", viewer);
          for (const room of [saved, live]) {
            expect(room.engine?.result).toEqual(expected);
            expect(room.engine?.eliminationOrder).toEqual([]);
            expect(placings(room.engine!, [[0], [1], [2], [3]])).toEqual([]);
            for (const seat of room.engine!.seats) expect(seat.eliminated).toBe(teamOfSeat(format, seat.seat) !== teamOfSeat(format, actor));
          }
          const history = service.listHistory("g", players[viewer]).duels.find(item => item.slug === created.slug)!;
          expect(history.seats.map(seat => seat.result)).toEqual(players.map((_, i) => teamOfSeat(format, i) === teamOfSeat(format, actor) ? "win" : "loss"));
          const replay = await post<DuelReplayV2>("replay", viewer, { version: 2 });
          expect(replay.frames.length).toBeGreaterThan(2);
          const final = replay.frames.at(-1)!;
          expect(final.kind).toBe("result");
          expect(final.view.result).toEqual(expected);
          expect(final.view.eliminationOrder).toEqual([]);
          expect(placings(final.view)).toEqual([]);
        }
        expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
      } finally { await host.close(); db.close(); }
    }, 60_000);
  });
}
