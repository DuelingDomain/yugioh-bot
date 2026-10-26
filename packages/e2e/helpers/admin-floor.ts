import { openDatabase } from "@yugidraft/shared/db";
import { createPlayerService } from "@yugidraft/shared/services";
import { easternDayStart } from "@yugidraft/shared/util/eastern-time";
import { dbPath, guildId } from "../stack/env.mjs";

/**
 * A busy evening for the admin console specs: 11 people online, a 4-way ranked duel, a 1v1 ranked duel,
 * a 3-way Genesys table with a practice bot, a cube draft with two bots, five duels that ended in the last
 * three hours (Tag, 3-way, a 4-way closed early, a draw) and a week of finished duels for the trends. Written straight into the stack database.
 */
export const FLOOR = {
  fours: "e2e-adm-fours", ranked: "e2e-adm-ranked", threeWay: "e2e-adm-three", draft: "e2e-adm-cube",
  tag: "e2e-adm-end-3", cut: "e2e-adm-end-4", draw: "e2e-adm-end-5",
  people: ["kaibaCorp", "neo_spacian", "ruby.lynx", "valon_x", "pharaoh_atem", "mai_v", "tealeaf", "joeyw", "hikari", "zane.t", "sol.ring"],
} as const;
const FIRST_ID = 201;
const MIN = 60_000;
const sqlTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

export function seedAdminFloor(): void {
  const db = openDatabase(dbPath);
  try {
    if (db.prepare("select 1 from duels where web_slug = ?").get(FLOOR.fours)) return;
    const now = Date.now();
    // The "today" duels start up to 160 minutes ago. "Today" is the Eastern day (ET), so right after Eastern midnight they
    // are squeezed into the time since midnight (order and relative ages stay the same).
    const sinceMidnightMin = Math.floor((now - easternDayStart(now)) / MIN);
    const squeeze = Math.min(1, Math.max(1, sinceMidnightMin - 2) / 160);
    const playerService = createPlayerService(db);
    const insertUser = db.prepare(`insert into users(id,username,display_name,first_sign_in_at,created_at) values (?,?,?,?,?)`);
    const player = new Map<string, number>();
    db.transaction(() => {
      FLOOR.people.forEach((name, i) => {
        const id = FIRST_ID + i;
        insertUser.run(id, name.replace(/[^a-z0-9_]/gi, "").toLowerCase(), name, now - (i % 7) * 24 * 60 * MIN - 3 * 60 * MIN, sqlTime(now - (40 + i * 9) * 24 * 60 * MIN));
        player.set(name, playerService.findOrCreate(guildId, id, name).id);
      });
      for (const [i, name] of ["Bot 1", "Bot 2"].entries()) {
        const id = FIRST_ID + 50 + i;
        insertUser.run(id, `bot${i + 1}`, name, null, sqlTime(now));
        const bot = playerService.findOrCreate(guildId, id, name).id;
        db.prepare("update players set discord_user_id = ? where id = ?").run(`bot_player_dev_e2e_${i + 1}`, bot);
        player.set(name, bot);
      }

      const duel = db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,ranked,created_at,started_at,ended_at,
        last_activity_at,winner_seat,turn_count,clock_json,settings_json,kind) values (?,?,?,?,'domain',?,?,?,?,?,?,?,?,?,?,?,'play')`);
      const seat = db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot) values (?,?,?,?)");
      const addDuel = (p: { slug: string; name: string; status: string; format: string; ranked?: boolean; seats: (string | "bot")[]; startedMin: number;
        endedMin?: number; history?: boolean; winner?: number; turns?: number; clock?: { turn: number; activeSeat: number }; genesys?: boolean }) => {
        const first = p.seats.find((s) => s !== "bot")!;
        if (!p.history && squeeze < 1) {
          // Ceil the start and floor the end, so an ended duel still ends after it started and every start is inside the Eastern day.
          p = { ...p, startedMin: Math.max(1, Math.ceil(p.startedMin * squeeze)), endedMin: p.endedMin === undefined ? undefined : Math.floor(p.endedMin * squeeze) };
        }
        const id = Number(duel.run(guildId, p.slug, p.name, player.get(first), p.status, p.format, p.ranked ? 1 : 0,
          sqlTime(now - (p.startedMin + 2) * MIN), sqlTime(now - p.startedMin * MIN), p.endedMin === undefined ? null : sqlTime(now - p.endedMin * MIN),
          sqlTime(now - (p.endedMin ?? 0) * MIN), p.winner ?? null, p.turns ?? null,
          p.clock ? JSON.stringify({ turn: p.clock.turn, remainingMs: p.seats.map(() => 300_000), activeSeat: p.clock.activeSeat, startedAt: now }) : null,
          p.genesys ? JSON.stringify({ genesys: { pointCap: 100 } }) : null).lastInsertRowid);
        p.seats.forEach((who, i) => seat.run(id, i, who === "bot" ? null : player.get(who), who === "bot" ? 1 : 0));
      };
      // A week of finished duels for the trend lines, first so that ids follow time as in real data.
      const perDay = [6, 9, 5, 11, 13, 16, 8];
      perDay.forEach((count, dayIndex) => {
        for (let k = 0; k < count; k++) {
          const startedMin = (6 - dayIndex) * 24 * 60 + 90 + k * 37;
          const pair = [FLOOR.people[(k + dayIndex) % 11], FLOOR.people[(k + dayIndex + 3) % 11]];
          addDuel({ slug: `e2e-adm-hist-${dayIndex}-${k}`, name: "Casual", status: "completed", format: "1v1", seats: pair, startedMin, endedMin: startedMin - 25, winner: k % 2, turns: 8 + (k % 9), history: true });
        }
      });

      addDuel({ slug: FLOOR.fours, name: "Friday Fours", status: "active", format: "ffa4", ranked: true, seats: ["kaibaCorp", "ruby.lynx", "neo_spacian", "valon_x"], startedMin: 24, clock: { turn: 9, activeSeat: 2 } });
      addDuel({ slug: FLOOR.ranked, name: "Ranked queue", status: "active", format: "1v1", ranked: true, seats: ["pharaoh_atem", "mai_v"], startedMin: 11, clock: { turn: 5, activeSeat: 0 } });
      addDuel({ slug: FLOOR.threeWay, name: "joey's table", status: "active", format: "ffa3", seats: ["joeyw", "tealeaf", "bot"], startedMin: 3, clock: { turn: 2, activeSeat: 1 }, genesys: true });
      addDuel({ slug: "e2e-adm-end-1", name: "Ranked queue", status: "completed", format: "1v1", ranked: true, seats: ["mai_v", "sol.ring"], startedMin: 45, endedMin: 19, winner: 0, turns: 14 });
      addDuel({ slug: "e2e-adm-end-2", name: "Three way", status: "completed", format: "ffa3", seats: ["kaibaCorp", "hikari", "zane.t"], startedMin: 70, endedMin: 31, winner: 0, turns: 22 });
      addDuel({ slug: "e2e-adm-end-3", name: "Tag night", status: "completed", format: "tag", seats: ["ruby.lynx", "kaibaCorp", "valon_x", "neo_spacian"], startedMin: 95, endedMin: 52, winner: 0, turns: 17 });
      // Two more for the Today list: a 4-way the host closed early, and a 1v1 draw.
      addDuel({ slug: FLOOR.cut, name: "Late fours", status: "interrupted", format: "ffa4", seats: ["hikari", "zane.t", "tealeaf", "sol.ring"], startedMin: 130, endedMin: 118, turns: 6 });
      addDuel({ slug: FLOOR.draw, name: "Mirror match", status: "completed", format: "1v1", seats: ["joeyw", "pharaoh_atem"], startedMin: 160, endedMin: 140, turns: 31 });
      const draftId = Number(db.prepare(`insert into drafts(guild_id,channel_id,name,status,created_by_user_id,config_json,current_wave_number,current_pick_step,
        created_at,started_at,web_slug) values (?,?,?,?,?,?,?,?,?,?,?)`).run(guildId, "web", "Sunday Cube", "active", String(FIRST_ID + 8),
        JSON.stringify({ cardsPerPlayer: 45, poolSource: { cubeId: 1, cubeName: "Vintage 540" } }), 2, 6, sqlTime(now - 33 * MIN), sqlTime(now - 31 * MIN), FLOOR.draft).lastInsertRowid);
      ["hikari", "zane.t", "Bot 1", "Bot 2"].forEach((name, i) =>
        db.prepare("insert into draft_players(draft_id,player_id,seat_index,pick_count) values (?,?,?,?)").run(draftId, player.get(name), i, 21));
    })();
  } finally {
    db.close();
  }
}

const ROUTES: Record<string, string> = {
  kaibaCorp: "/duels/[slug]", neo_spacian: "/duels/[slug]", "ruby.lynx": "/duels/[slug]", valon_x: "/duels/[slug]", pharaoh_atem: "/duels/[slug]",
  mai_v: "/duels/[slug]", tealeaf: "/duels/[slug]", joeyw: "/duels/[slug]", hikari: "/draft/[slug]", "zane.t": "/draft/[slug]", "sol.ring": "/decks/[id]",
};
const ONLINE_FOR_MIN = [72, 125, 38, 27, 52, 19, 100, 9, 44, 31, 6];

/** Marks the floor people as seen just now (the console counts people seen in the last 2 minutes). */
export function touchAdminFloor(): void {
  const db = openDatabase(dbPath);
  try {
    const now = Date.now();
    const update = db.prepare("update users set last_seen_at = ?, last_route = ?, online_since = coalesce(online_since, ?) where id = ?");
    db.transaction(() => FLOOR.people.forEach((name, i) => update.run(now - (i % 4) * 7_000, ROUTES[name], now - ONLINE_FOR_MIN[i] * MIN, FIRST_ID + i)))();
    // Live tables stay live: the console hides tables idle for more than 10 minutes.
    db.prepare("update duels set last_activity_at = ? where web_slug in (?,?,?)").run(sqlTime(now), FLOOR.fours, FLOOR.ranked, FLOOR.threeWay);
  } finally {
    db.close();
  }
}
