import type Database from "better-sqlite3";

/** Stable test users: application IDs deliberately differ from gameplay IDs and Discord IDs. */
export function fixtureUserId(key: string): number {
  let hash = 0;
  for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return 101 + hash;
}

function isTestBot(key: string): boolean {
  return /^(bot_player_dev_[1-9][0-9]*|tournament_bot_dev_[1-3]|fake_(yugi|kaiba|joey|pegasus))$/.test(key);
}

export function fixtureDiscordId(key: string): string {
  if (isTestBot(key)) return key;
  return /^\d{17,20}$/.test(key) ? key : "900000" + String(fixtureUserId(key)).padStart(12, "0");
}

/** Seed only users, so owner-only fixtures never invent gameplay participants. */
export function seedFixtureUsers(db: Database.Database, keys: readonly string[]): void {
  const insert = db.prepare("insert or ignore into users(id, username, display_name, discord_user_id) values (?, ?, ?, ?)");
  for (const key of keys) insert.run(fixtureUserId(key), "fixture:" + key, key, isTestBot(key) ? null : fixtureDiscordId(key));
}
