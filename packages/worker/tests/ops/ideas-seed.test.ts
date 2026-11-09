import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../../src/ops/cli.js";
import { fixture } from "./fixtures.js";

let f: ReturnType<typeof fixture>;
let reportNumber = 0;
afterEach(() => f?.close());

async function seed(flags: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const path = join(f.dir, `ideas-${++reportNumber}.json`);
  const output: string[] = [];
  const code = await runCli(["ideas-seed", ...flags, "--report", path], {
    env: { DATABASE_PATH: f.path, DISCORD_GUILD_ID: "guild", OWNER_USER_IDS: "bad, 7, 2", ...env },
    out: line => output.push(line), err: line => output.push(line),
  });
  return { code, path, output: output.join("\n") };
}

it("seeds the approved Team ideas and full historical lines with no invented activity", async () => {
  f = fixture(); f.user(7); f.user(2);
  const result = await seed(["--apply"]);
  expect(result.code).toBe(0);
  expect(f.db.prepare(`select seed_key,title,pitch,area,state,author_user_id from ideas
    where state != 'done' order by seed_key`).raw().all()).toEqual([
    ["NT-102", "Ranked queue", "Find a Standard or Domain match near your rating.", "Ranked", "open", 7],
    ["NT-103", "Placement series", "Your first five rated series move your rating faster.", "Ranked", "open", 7],
    ["NT-104", "Separate Standard and Domain ratings", "Each format gets its own rating and tier.", "Ranked", "open", 7],
    ["NT-105", "Seasons with a soft reset", "A new season every 8 weeks. Ratings move halfway back to 1000.", "Ranked", "open", 7],
    ["NT-106", "Season crest and seat frame", "Your best tier each season becomes a crest and a seat frame.", "Ranked", "open", 7],
    ["NT-107", "Ladder sorted by rating", "Sort the leaderboard by rating as well as winnings.", "Ranked", "open", 7],
    ["NT-108", "Swiss rounds with a top cut", "Play rounds against equal records, then a top 4 or 8 bracket.", "Tournaments", "open", 7],
    ["NT-109", "Friends and playing now", "Add friends, see who is online, and challenge in one tap.", "Community", "open", 7],
    ["NT-110", "Share a deck or cube by link", "A read-only page anyone signed in can view and copy.", "Decks & cubes", "open", 7],
    ["NT-111", "Jump in from your own replays", "Stop a replay where it went wrong and play on from there.", "Replays & watching", "open", 7],
    ["NT-112", "Quick reactions in duels", "A fixed set of short reactions with a mute. No free chat.", "Duels", "open", 7],
    ["NT-113", "A practice bot that plays a real deck", "Pick a saved deck for the practice bot to play.", "Duels", "open", 7],
    ["NT-114", "Draft recap", "Step through every pack you saw after a draft.", "Drafts", "open", 7],
    ["NT-115", "Inbox for challenges, round calls and updates", "One place for challenges, round calls and draft starts.", "App", "open", 7],
    ["NT-116", "Theme drafts", "Each player drafts from a cube theme assigned to them.", "Drafts", "in_progress", 7],
    ["NT-117", "Card details that fit on a phone", "Card text, clock names and lobby wording stop getting cut off.", "App", "in_progress", 7],
    ["NT-118", "Readable text everywhere", "Nothing in the app smaller than 11px.", "App", "open", 7],
    ["NT-119", "Clear, consistent format names", "Standard, Domain and Genesys read the same on every screen.", "App", "open", 7],
  ]);
  expect(f.db.prepare(`select shipped_week,title,area,pitch,shipped_before_board from ideas
    where state = 'done' order by seed_key`).raw().all()).toEqual([
    ["2026-09-28", "Play Tag 2v2 and three- or four-player free-for-all.", "Duels", null, 1],
    ["2026-09-28", "Export draft decks and turn a finished draft into a tournament.", "Drafts", null, 1],
    ["2026-10-05", "Make drafts and tournaments open or private, with invitations.", "Drafts", null, 1],
    ["2026-10-05", "Follow each chain link as it resolves, with a table log and negation marks.", "Duels", null, 1],
    ["2026-10-12", "Import decks in bulk, with better previews and an editor that fits your screen.", "Decks & cubes", null, 1],
    ["2026-10-12", "Build and play Genesys decks with point budgets.", "Decks & cubes", null, 1],
    ["2026-10-12", "Replay older games even after engine updates.", "Replays & watching", null, 1],
    ["2026-10-19", "Search cards by what they do: effects, partners, counters, release dates and format staples.", "Decks & cubes", null, 1],
    ["2026-10-19", "See live card statuses, protections and counters on the board.", "Duels", null, 1],
    ["2026-10-19", "Get legal deck suggestions and start a Test duel straight from the editor.", "Decks & cubes", null, 1],
    ["2026-10-19", "Hosts can remove players before a table starts, and replays load faster.", "Duels", null, 1],
    ["2026-10-19", "Fixed: decision clocks, Damage Step timing, card sorting and multiplayer LP effects.", "Duels", null, 1],
  ]);
  expect(f.db.prepare("select count(*) n from ideas where guild_id='guild' and team=1 and show_author=0 and approved_at is not null").get()).toEqual({ n: 30 });
  expect(f.db.prepare("select count(*) n from ideas where state='in_progress' and started_at is not null").get()).toEqual({ n: 2 });
  expect(f.db.prepare("select count(*) n from ideas where state='done' and done_at is not null").get()).toEqual({ n: 12 });
  expect(f.db.prepare("select count(*) n from idea_votes").get()).toEqual({ n: 0 });
  expect(f.db.prepare("select count(*) n from idea_notices").get()).toEqual({ n: 0 });
  expect(f.db.prepare("select count(*) n from users").get()).toEqual({ n: 2 });
  expect(JSON.parse(readFileSync(result.path, "utf8"))).toMatchObject({
    command: "ideas-seed", status: "applied", guildId: "guild", authorUserId: 7,
    planned: 30, inserted: 30, existing: 0, counts: { open: 16, inProgress: 2, done: 12 },
  });
});

it("defaults to a read-only preview and reports the rows it would insert", async () => {
  f = fixture(); f.user(7);
  const before = f.checksum();
  const result = await seed();
  expect(result.code).toBe(0);
  expect(JSON.parse(readFileSync(result.path, "utf8"))).toMatchObject({ status: "dry-run", planned: 30, inserted: 0, existing: 0 });
  expect(result.output).toContain(`Report written: ${result.path}`);
  expect(f.checksum()).toBe(before);
});

it("reapplying is byte-for-byte unchanged, preserves later decisions, and scopes seeds to the guild", async () => {
  f = fixture(); f.user(7);
  expect((await seed(["--apply"])).code).toBe(0);
  f.db.prepare("update ideas set state='in_progress',started_at='2026-11-01 12:00:00' where seed_key='NT-102'").run();
  const before = f.checksum();
  const repeated = await seed(["--apply"]);
  expect(repeated.code).toBe(0);
  expect(JSON.parse(readFileSync(repeated.path, "utf8"))).toMatchObject({ status: "noop", planned: 0, inserted: 0, existing: 30 });
  expect(f.checksum()).toBe(before);
  expect((await seed(["--apply"], { DISCORD_GUILD_ID: "other-guild" })).code).toBe(0);
  expect(f.db.prepare("select guild_id,count(*) n from ideas group by guild_id order by guild_id").all())
    .toEqual([{ guild_id: "guild", n: 30 }, { guild_id: "other-guild", n: 30 }]);
});

it.each([
  [{ DISCORD_GUILD_ID: "" }, /DISCORD_GUILD_ID/],
  [{ DISCORD_GUILD_ID: "   " }, /DISCORD_GUILD_ID/],
  [{ OWNER_USER_IDS: "" }, /OWNER_USER_IDS/],
  [{ OWNER_USER_IDS: "bad,0,-1,9007199254740992" }, /OWNER_USER_IDS/],
  [{ OWNER_USER_IDS: "99,7" }, /first.*OWNER_USER_IDS.*existing users.id/i],
])("fails without writes for invalid seed configuration %j", async (env, message) => {
  f = fixture(); f.user(7);
  const before = f.checksum();
  const result = await seed([], env);
  expect(result.code).toBe(1);
  expect(result.output).toMatch(message);
  expect(JSON.parse(readFileSync(result.path, "utf8"))).toMatchObject({ command: "ideas-seed", status: "failed" });
  expect(f.checksum()).toBe(before);
});
