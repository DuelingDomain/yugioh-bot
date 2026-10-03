import { createHmac } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelDeck, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { MULTIPLAYER_FORBIDDEN } from "../src/banlists/multiplayer.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { createDuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

export { HOST_FORBIDDEN_RULE_IDS } from "./host-rule-forbidden.rules.js";

const SECRET = "rule-forbidden-test";
const DESTINY_BOARD = 94212438;
const GRISAILLE_PRISON = 22888900;

function legalDeck(mode: DuelMode): DuelDeck {
  const cards = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const forbidden = new Set(MULTIPLAYER_FORBIDDEN.map((entry) => entry.code));
    const rows = cards.prepare(`SELECT datas.id FROM datas JOIN texts USING (id)
      WHERE type & 2 != 0 AND type & 1 = 0 AND type & 16384 = 0
      AND ot & 3 != 0 AND alias = 0 AND desc NOT LIKE '%always treated as%' ORDER BY datas.id`).all() as { id: number }[];
    return {
      main: rows.map((row) => row.id).filter((id) => !forbidden.has(id)).slice(0, mode === "domain" ? 60 : 40),
      extra: [], side: [], ...(mode === "domain" ? { deckMaster: 46986414 } : {}),
    };
  } finally { cards.close(); }
}

const cases = (["normal", "domain"] as const).flatMap((mode) =>
  (["ffa3", "ffa4", "tag"] as const).flatMap((format) =>
    Array.from({ length: seatCountFor(format) }, (_, seat) => ({ mode, format, seat }))));

for (const mode of ["normal", "domain"] as const) {
describeWithCores("live host forbidden list (" + mode + ")",
  mode === "normal" ? [needs.installedMulti(DATA)] : needs.domainMulti(), () => {
  it.each(cases.filter((entry) => entry.mode === mode))("R-COMMON-FL-LIST: $mode $format refuses seat $seat and starts after repair", async ({ mode, format, seat }) => {
    const db = new Database(":memory:");
    migrate(db);
    const count = seatCountFor(format);
    const players = Array.from({ length: count }, (_, index) => Number(db.prepare(
      "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)",
    ).run("g1", `u${index}`, `P${index}`).lastInsertRowid));
    const service = createDuelService(db);
    const room = service.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Rule proof", mode, format,
      settings: { banlist: "none", validateDeck: true, shuffleDeck: false, turnSeconds: 0 } });
    for (const player of players.slice(1)) service.join(room.slug, "g1", player);
    let game: EngineGame | undefined;
    let creates = 0;
    const worker: DuelGameWorker = {
      get running() { return game !== undefined; },
      async create(options) { creates++; game = await createEngineGame(options); },
      async view(viewer) { return game!.view(viewer); },
      async answer(actor, id, answer) { game!.answer(actor, id, answer); },
      async eliminate(actor, reason) { game!.eliminate(actor, reason); },
      async search(query) { return game!.searchCards(query); },
      async close() { game?.close(); game = undefined; },
    };
    const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
      createWorker: () => worker });
    const post = async (player: number, body: Record<string, unknown>) => {
      const raw = JSON.stringify({ slug: room.slug, guildId: "g1", playerId: player, ...body });
      const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
      const response = await host.handle(new Request("http://localhost/internal/duel", {
        method: "POST", headers: { "content-type": "application/json", "x-announce-signature": signature }, body: raw,
      }));
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    try {
      const legal = legalDeck(mode);
      const banned = format === "tag" ? DESTINY_BOARD : GRISAILLE_PRISON;
      const invalid = { ...legal, main: [banned, ...legal.main.slice(1)] };
      for (let index = 0; index < count; index++) {
        const submitted = await post(players[index]!, { op: "deck", deck: index === seat ? invalid : legal });
        expect(submitted.status, JSON.stringify(submitted.body)).toBe(index === seat ? 400 : 200);
      }
      expect(service.get(room.slug, "g1").seats.map((s) => s.ready)).toEqual(players.map((_, index) => index !== seat));
      expect((await post(players[0]!, { op: "start" })).status).toBe(409);
      expect(creates).toBe(0);
      // A deck from a prior service path must also fail the real check at start.
      service.setDeck(room.slug, "g1", players[seat]!, invalid);
      const refused = await post(players[0]!, { op: "start" });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/is forbidden in /);
      expect(service.get(room.slug, "g1").status).toBe("lobby");
      expect(creates).toBe(0);
      expect((await post(players[seat]!, { op: "deck", deck: legal })).status).toBe(200);
      const started = await post(players[0]!, { op: "start" });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect(creates).toBe(1);
      expect(service.get(room.slug, "g1").status).toBe("active");
      for (let viewer = 0; viewer < count; viewer++) {
        const projected = await post(players[viewer]!, { op: "view" });
        expect(projected.status).toBe(200);
        const view = projected.body.engine;
        expect(view.seats).toHaveLength(count);
        expect(view.result).toBeNull();
        expect(view.turnSeat).toBe(0);
        expect(view.seats.map((s: { lp: number }) => s.lp)).toEqual(players.map(() => format === "tag" ? 16000 : 8000));
        expect(view.seats[viewer].hand).toHaveLength(mode === "domain" && viewer === 0 ? 6 : 5);
        if (mode === "domain") expect(view.seats.every((s: { deckMaster?: { inZone: boolean } }) => s.deckMaster?.inZone)).toBe(true);
      }
    } finally { await host.close(); db.close(); }
  }, 30_000);
});
}
