import type Database from "better-sqlite3";
import { createUserService } from "./users.js";

export type Player = {
  id: number;
  guildId: string;
  userId: number;
  discordUserId: string | null;
  displayName: string;
  createdAt: string;
};

type PlayerRow = {
  id: number;
  guild_id: string;
  user_id: number;
  discord_user_id: string | null;
  display_name: string;
  created_at: string;
};

function mapPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    discordUserId: row.discord_user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export function createPlayerService(db: Database.Database) {
  const users = createUserService(db);
  const select = db.prepare<[string, number], PlayerRow>(
    "select * from players where guild_id = ? and user_id = ?",
  );
  const upsert = db.prepare(`
    insert into players (guild_id, user_id, discord_user_id, display_name) values (?, ?, ?, ?)
    on conflict(guild_id, user_id) do update set
      display_name = excluded.display_name,
      discord_user_id = case when excluded.discord_user_id is not null
        then excluded.discord_user_id else players.discord_user_id end
  `);
  const findOrCreate = db.transaction((guildId: string, userId: number, displayName: string): Player => {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid application user ID");
    const user = users.findById(userId);
    if (!user) throw new Error("User not found");
    upsert.run(guildId, userId, user.discordUserId, displayName);
    return mapPlayer(select.get(guildId, userId)!);
  });

  return {
    findByGuildAndUser(guildId: string, userId: number): Player | undefined {
      const row = select.get(guildId, userId);
      return row && mapPlayer(row);
    },
    findOrCreate(guildId: string, userId: number, displayName: string): Player {
      return findOrCreate.immediate(guildId, userId, displayName);
    },
    findOrCreateByDiscord(guildId: string, discordUserId: string, displayName: string): Player {
      return db.transaction(() => {
        const user = users.ensureDiscord({ discordUserId, displayName });
        return findOrCreate(guildId, user.id, displayName);
      }).immediate();
    },
    findOrCreateTestPlayer(guildId: string, legacyKey: string, displayName: string): Player {
      if (!/^bot_player_dev_[1-9][0-9]*$/.test(legacyKey)
        && !/^tournament_bot_dev_[1-3]$/.test(legacyKey)
        && !["fake_yugi", "fake_kaiba", "fake_joey", "fake_pegasus"].includes(legacyKey)) {
        throw new Error("Unknown test player key");
      }
      return db.transaction(() => {
        const old = db.prepare<[string, string], PlayerRow>(
          "select * from players where guild_id = ? and discord_user_id = ?",
        ).get(guildId, legacyKey);
        if (old) return mapPlayer(old);
        const same = db.prepare<[string], { user_id: number }>(
          "select user_id from players where discord_user_id = ? order by id limit 1",
        ).get(legacyKey);
        const userId = same?.user_id ?? users.createNonLogin(displayName).id;
        db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)")
          .run(guildId, userId, legacyKey, displayName);
        return mapPlayer(select.get(guildId, userId)!);
      }).immediate();
    },
  };
}

export type PlayerService = ReturnType<typeof createPlayerService>;
