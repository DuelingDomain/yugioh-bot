// Makes a fresh temp SQLite with the guild's players. Guild membership itself is
// answered by stack/fetch-stub.mjs, so no code path in the web app changes.
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath, guildId, players } from "./env.mjs";

/** @param {{ databasePath?: string, savedDecks?: import("@yugidraft/shared/services").SavedDeckWrite[] }} [options] */
export async function seedDatabase({ databasePath = dbPath, savedDecks = [] } = {}) {
  mkdirSync(dirname(databasePath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(databasePath + suffix, { force: true });
  const { openDatabase } = await import("@yugidraft/shared/db");
  const { createSavedDeckService } = await import("@yugidraft/shared/services");
  const db = openDatabase(databasePath);
  try {
    const decks = createSavedDeckService(db);
    const insert = db.prepare(
      "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?) on conflict (guild_id, discord_user_id) do update set display_name = excluded.display_name",
    );
    db.transaction(() => {
      for (const player of players) {
        insert.run(guildId, player.discordId, player.name);
        for (const deck of savedDecks) decks.create(guildId, player.discordId, deck);
      }
    })();
  } finally {
    db.close();
  }
}
