import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Engine passcode the fake duel host gives a YGOPRODeck id. */
export const passcodeOf = (id: number) => id + 100000;

export interface DraftDeckFixture {
  dir: string;
  /** Player ids by discord user id. */
  players: Record<string, number>;
  draftId: number;
}

/**
 * Makes a temp database with a draft and the picks of "drafter".
 * `picks` lists YGOPRODeck ids; repeat an id for a second copy. Ids from 2000 up are
 * Fusion Monsters (Extra Deck), the rest are Normal Monsters.
 */
export async function seedDraftDeck(options: {
  picks: number[];
  /** Zero-based pick indices that were forced. */
  forcedPicks?: number[];
  status?: string;
  /** Adds a tournament for the draft with these users as participants. */
  tournamentUsers?: string[];
  tournamentStatus?: string;
}): Promise<DraftDeckFixture> {
  const dir = mkdtempSync(join(tmpdir(), "yugioh-draft-deck-"));
  const dbPath = join(dir, "test.sqlite");
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";

  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);

  const insertCard = db.prepare(
    `insert or ignore into card_catalog (ygoprodeck_id, name, type, frame_type, effect_text, atk, def, attribute, level, image_url, image_url_small, card_sets_json, cached_at)
     values (?, ?, ?, ?, 'x', 1000, 1000, 'DARK', 4, 'u', 's', '[]', ?)`,
  );
  db.transaction(() => {
    for (const id of new Set(options.picks)) {
      const extra = id >= 2000;
      insertCard.run(id, `Card ${id}`, extra ? "Fusion Monster" : "Normal Monster", extra ? "fusion" : "normal", new Date().toISOString());
    }
  })();

  const players: Record<string, number> = {};
  for (const [user, name] of [["drafter", "Yugi"], ["outsider", "Kaiba"]] as const) {
    players[user] = Number(
      db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('guild-1', ?, ?)").run(user, name).lastInsertRowid,
    );
  }
  const draftId = Number(
    db.prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
       values ('guild-1', 'ch1', 'Friday Draft', ?, 'drafter', '{}', 'slug-1')`,
    ).run(options.status ?? "completed").lastInsertRowid,
  );
  db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(draftId, players.drafter);

  const insertCardRow = db.prepare(
    "insert into draft_cards (draft_id, wave_number, catalog_card_id, picked_by_player_id, picked_at) values (?, 1, ?, ?, ?)",
  );
  const insertPick = db.prepare(
    "insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, forced, picked_at) values (?, ?, ?, 1, ?, ?, ?)",
  );
  const now = new Date().toISOString();
  // One transaction: a thousand separate commits take tens of seconds.
  db.transaction(() => {
    options.picks.forEach((id, index) => {
      const cardId = Number(insertCardRow.run(draftId, id, players.drafter, now).lastInsertRowid);
      insertPick.run(draftId, players.drafter, cardId, index + 1, options.forcedPicks?.includes(index) ? 1 : 0, now);
    });
  })();

  if (options.tournamentUsers) {
    const tournamentId = Number(
      db.prepare(
        `insert into tournaments (guild_id, name, format, status, created_by_user_id)
         values ('guild-1', 'T', 'round_robin', ?, 'drafter')`,
      ).run(options.tournamentStatus ?? "pending").lastInsertRowid,
    );
    for (const user of options.tournamentUsers) {
      db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournamentId, players[user]);
    }
    db.prepare("update drafts set tournament_id = ? where id = ?").run(tournamentId, draftId);
  }
  db.close();
  return { dir, players, draftId };
}

/** ids 1..count as Normal Monsters, one copy each. */
export const mainIds = (count: number, from = 1) => Array.from({ length: count }, (_, index) => from + index);
