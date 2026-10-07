import type Database from "better-sqlite3";
import { createPlayerService, createUserService, type Player } from "@yugidraft/shared/services";

export type { Player };

export function createPlayerRepository(db: Database.Database) {
  const players = createPlayerService(db);
  const users = createUserService(db);

  return {
    upsert(guildId: string, discordUserId: string, displayName: string): Player {
      return players.findOrCreateByDiscord(guildId, discordUserId, displayName);
    },

    ensureUser(discordUserId: string, displayName: string) {
      users.ensureDiscord({ discordUserId, displayName });
      return users.findByDiscordId(discordUserId)!;
    },

    findByDiscordId(guildId: string, discordUserId: string): Player | undefined {
      const user = users.findByDiscordId(discordUserId);
      return user ? players.findByGuildAndUser(guildId, user.id) : undefined;
    },

    findById(playerId: number): Player | undefined {
      const row = db.prepare("select guild_id, user_id from players where id = ?").get(playerId) as
        { guild_id: string; user_id: number } | undefined;
      return row ? players.findByGuildAndUser(row.guild_id, row.user_id) : undefined;
    },
  };
}

export type PlayerRepository = ReturnType<typeof createPlayerRepository>;
