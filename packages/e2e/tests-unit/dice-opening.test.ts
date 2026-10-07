import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seedOrderedDiceOpening } from "../helpers/dice-opening.ts";

for (const format of ["ffa3", "ffa4", "tag", "1v1"] as const) {
  test(`browser ${format} fixture keeps lobby seats and applies dice only to FFA`, () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      const service = createDuelService(db);
      const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
      const players = Array.from({ length: count }, (_, seat) => Number(db.prepare(
        "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
      ).run(`u${seat}`, `P${seat}`).lastInsertRowid));
      const session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Fixture", mode: "normal", format });
      for (const [seat, player] of players.entries()) {
        if (seat) service.takeSeat(session.slug, "g", player, seat);
        service.setDeck(session.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
      }
      seedOrderedDiceOpening(db, session.slug, "g", 1000);
      const state = service.openingState(session.slug, "g");
      if (format === "tag" || format === "1v1") assert.equal(state, null);
      else {
        assert.equal(state?.phase, "dice");
        assert.equal(state?.deadline, 4000);
        assert.ok(state && "order" in state);
        assert.deepEqual(state.order, Array.from({ length: count }, (_, seat) => seat));
        service.settleOpening(session.slug, "g", 4000);
        assert.deepEqual(service.get(session.slug, "g").seats.map((seat) => seat.playerId), players);
      }
    } finally { db.close(); }
  });
}
