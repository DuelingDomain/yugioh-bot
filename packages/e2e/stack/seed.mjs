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
  const { createSavedDeckService, createPlayerService } = await import("@yugidraft/shared/services");
  const db = openDatabase(databasePath);
  try {
    const decks = createSavedDeckService(db);
    const playerService = createPlayerService(db);
    const insert = db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)");
    db.transaction(() => {
      for (const player of players) {
        insert.run(player.userId, player.name, player.name, player.discordId);
        playerService.findOrCreate(guildId, player.userId, player.name);
        for (const deck of savedDecks) decks.create(guildId, player.userId, deck);
      }
    })();
  } finally {
    db.close();
  }
}
