import { openDatabase } from "@yugidraft/shared/db";
import { createPlayerService } from "@yugidraft/shared/services";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

type SnapshotCard = {
  ygoprodeckId: number;
  name: string;
  type: string;
  frameType: string;
  effectText: string;
  atk?: number;
  def?: number;
  attribute?: string;
  level?: number;
  imageUrl: string;
  imageUrlSmall: string;
  cardSets: Array<{ set_name: string }>;
};

// Load .env from repo root so DISCORD_USER_ID / DISCORD_GUILD_ID are available
config({ path: join(process.cwd(), ".env") });

const dbPath = process.env.DATABASE_PATH || join(process.cwd(), "data", "bot.sqlite");
const userDiscordId = process.env.DISCORD_USER_ID ?? "123456789012345678";
const guildId = process.env.DISCORD_GUILD_ID ?? "987654321098765432";
const draftCatalogSnapshotPath = join(process.cwd(), "scripts", "data", "draft-catalog-legendary.json");
const draftCatalogSnapshot = JSON.parse(
  readFileSync(draftCatalogSnapshotPath, "utf8")
) as { cards: SnapshotCard[] };

if (!/^\d{17,20}$/.test(userDiscordId)) throw new Error("DISCORD_USER_ID must be a Discord snowflake");

const db = openDatabase(dbPath);
try {
  // Only the four named seed events are replaced. Unrelated histories and identities survive.
  db.transaction(() => {
    const drafts = "select id from drafts where guild_id=? and web_slug in ('legendary-draft','retro-draft')";
    for (const table of ["draft_passes", "draft_picks", "draft_cards", "draft_packs", "draft_deal", "draft_undealt", "draft_player_cube", "draft_players"]) {
      db.prepare(`delete from ${table} where draft_id in (${drafts})`).run(guildId);
    }
    db.prepare(`delete from drafts where id in (${drafts})`).run(guildId);
    const tournaments = "select id from tournaments where guild_id=? and web_slug in ('fnf-2026','weekend-champ')";
    db.prepare(`delete from tournament_matches where tournament_id in (${tournaments})`).run(guildId);
    db.prepare(`delete from matches where tournament_id in (${tournaments})`).run(guildId);
    db.prepare(`delete from tournament_participants where tournament_id in (${tournaments})`).run(guildId);
    db.prepare(`delete from tournaments where id in (${tournaments})`).run(guildId);
  }).immediate();

  // This development seed uses the same explicit application-ID allocation as
  // web/tests/fixtures/identity.ts. Runtime authentication still resolves only
  // canonical Discord identities; existing identities are never reassigned.
  let hash = 0;
  for (const char of userDiscordId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  db.transaction(() => {
    if (!db.prepare("select id from users where discord_user_id=?").get(userDiscordId)) {
      db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)")
        .run(101 + hash, "seed:you", "You", userDiscordId);
    }
  }).immediate();
  const playerService = createPlayerService(db);
  const me = playerService.findOrCreateByDiscord(guildId, userDiscordId, "You");
  const others = ["Yugi", "Kaiba", "Joey", "Pegasus"].map(name =>
    playerService.findOrCreateTestPlayer(guildId, `fake_${name.toLowerCase()}`, name));
  const players = [me, ...others];

  // ---------- CARD CATALOG ----------
  const insertCard = db.prepare(
    `insert into card_catalog
     (ygoprodeck_id, name, type, frame_type, effect_text, atk, def, attribute, level, image_url, image_url_small, card_sets_json, cached_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     on conflict(ygoprodeck_id) do update set
       name = excluded.name,
       type = excluded.type,
       frame_type = excluded.frame_type,
       effect_text = excluded.effect_text,
       atk = excluded.atk,
       def = excluded.def,
       attribute = excluded.attribute,
       level = excluded.level,
       image_url = excluded.image_url,
       image_url_small = excluded.image_url_small,
       card_sets_json = excluded.card_sets_json,
       cached_at = excluded.cached_at`
  );

  draftCatalogSnapshot.cards.forEach((card) => {
    insertCard.run(
      card.ygoprodeckId,
      card.name,
      card.type,
      card.frameType,
      card.effectText,
      card.atk ?? null,
      card.def ?? null,
      card.attribute ?? null,
      card.level ?? null,
      card.imageUrl,
      card.imageUrlSmall,
      JSON.stringify(card.cardSets)
    );
  });

  // ---------- TOURNAMENT 1: ACTIVE ----------
  const t1 = db
    .prepare(
      `insert into tournaments (guild_id, name, format, status, created_by_user_id, started_at, web_slug)
       values (?, ?, ?, ?, ?, datetime('now'), ?)`
    )
    .run(guildId, "Friday Night Fights", "round_robin", "active", me.userId, "fnf-2026");
  const t1Id = Number(t1.lastInsertRowid);

  // participants
  [me, ...others].forEach((p) => {
    db.prepare("insert or ignore into tournament_participants (tournament_id, player_id) values (?, ?)").run(t1Id, p.id);
  });

  // matches (round 1)
  const matchPairs = [
    [me.id, others[0].id],
    [others[1].id, others[2].id],
  ];
  matchPairs.forEach(([p1, p2], idx) => {
    const m = db
      .prepare(
        `insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source, tournament_id, resolved_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(guildId, p1, p2, p1, me.id, "approved", "tournament", t1Id);
    const mId = Number(m.lastInsertRowid);
    db.prepare(
      `insert into tournament_matches (tournament_id, match_id, player_one_id, player_two_id, round_number, status, metadata_json)
       values (?, ?, ?, ?, ?, ?, ?)`
    ).run(t1Id, mId, p1, p2, 1, "completed", "{}");
  });

  // open match (round 2)
  db.prepare(
    `insert into tournament_matches (tournament_id, match_id, player_one_id, player_two_id, round_number, status, metadata_json)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run(t1Id, null, me.id, others[1].id, 2, "open", "{}");

  // ---------- TOURNAMENT 2: PENDING ----------
  const t2 = db
    .prepare(
      `insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug)
       values (?, ?, ?, ?, ?, ?)`
    )
    .run(guildId, "Weekend Championship", "single_elim", "pending", me.userId, "weekend-champ");
  const t2Id = Number(t2.lastInsertRowid);

  [me, ...others].forEach((p) => {
    db.prepare("insert or ignore into tournament_participants (tournament_id, player_id) values (?, ?)").run(t2Id, p.id);
  });

  // ---------- DRAFT 1: PENDING ----------
  const d1 = db
    .prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, current_wave_number, current_pick_step, web_slug)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      guildId,
      "draft-channel-1",
      "Legendary Draft",
      "pending",
      me.userId,
      JSON.stringify({
        pickSeconds: 60,
        packSize: 5,
        packsPerPlayer: 3,
        setNames: [
          "Legend of Blue Eyes White Dragon",
          "Metal Raiders",
          "Spell Ruler",
        ],
      }),
      0,
      0,
      "legendary-draft"
    );
  const d1Id = Number(d1.lastInsertRowid);

  [me, ...others].forEach((p, i) => {
    db.prepare(
      `insert into draft_players (draft_id, player_id, seat_index) values (?, ?, ?)`
    ).run(d1Id, p.id, i);
  });

  // ---------- DRAFT 2: COMPLETED ----------
  const d2 = db
    .prepare(
      `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, current_wave_number, current_pick_step, started_at, ended_at, web_slug)
       values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
    )
    .run(
      guildId,
      "draft-channel-2",
      "Retro Draft",
      "completed",
      me.userId,
      JSON.stringify({
        pickSeconds: 45,
        packSize: 3,
        packsPerPlayer: 2,
        setNames: [
          "Legend of Blue Eyes White Dragon",
          "Metal Raiders",
          "Spell Ruler",
        ],
      }),
      2,
      6,
      "retro-draft"
    );
  const d2Id = Number(d2.lastInsertRowid);

  [me, ...others].forEach((p, i) => {
    db.prepare(`insert into draft_players (draft_id, player_id, seat_index, finished_at) values (?, ?, ?, datetime('now'))`).run(
      d2Id,
      p.id,
      i
    );
  });

  console.log("✅ Seed complete!");
  console.log("");
  console.log("Players created:", players.map((p) => `${p.displayName} (id=${p.id})`).join(", "));
  console.log("");
  console.log("Tournaments:");
  console.log(`  Active:   http://localhost:3000/tournament/${t1Id}  (slug: fnf-2026)`);
  console.log(`  Pending:  http://localhost:3000/tournament/${t2Id}  (slug: weekend-champ)`);
  console.log(`  Standings: http://localhost:3000/tournament/${t1Id}/standings`);
  console.log("");
  console.log("Drafts:");
  console.log(`  Active:    http://localhost:3000/draft/legendary-draft`);
  console.log(`  Completed: http://localhost:3000/draft/retro-draft`);
  console.log("");
  console.log("Dashboard: http://localhost:3000/dashboard");
  console.log("");
  console.log(`If your Discord User ID is not ${userDiscordId}, set DISCORD_USER_ID=YOUR_ID before running this script.`);

} finally { db.close(); }
