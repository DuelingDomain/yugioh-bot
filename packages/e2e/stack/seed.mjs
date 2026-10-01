// Makes a fresh temp SQLite with the guild's players. Guild membership itself is
// answered by stack/fetch-stub.mjs, so no code path in the web app changes.
import { mkdirSync, rmSync } from "node:fs";
import { dbPath, guildId, players, stackDir } from "./env.mjs";

export async function seedDatabase() {
  mkdirSync(stackDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  const { openDatabase } = await import("@yugidraft/shared/db");
  const db = openDatabase(dbPath);
  const insert = db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?) on conflict (guild_id, discord_user_id) do update set display_name = excluded.display_name",
  );
  for (const player of players) insert.run(guildId, player.discordId, player.name);
  db.close();
}

