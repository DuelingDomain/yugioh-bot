import { afterEach, expect, it } from "vitest";
import { runSeason } from "../../src/ops/season.js";
import { fixture } from "./fixtures.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.close());

it("leaves a dry-run start byte-for-byte unchanged", () => {
  f = fixture(); const before = f.checksum();
  runSeason({ db: f.db, apply: false, guildId: "guild" }, "start", {});
  expect(f.checksum()).toBe(before);
});
it("starts once with a real actor and rejects a second active season", () => {
  f = fixture(); f.user(1);
  runSeason({ db: f.db, apply: true, guildId: "guild" }, "start", { actor: 1, name: "Autumn" });
  expect(f.db.prepare("select name,created_by_user_id from seasons").get()).toEqual({ name: "Autumn", created_by_user_id: 1 });
  expect(() => runSeason({ db: f.db, apply: true, guildId: "guild" }, "start", {})).toThrow(/already active/i);
  expect(f.db.prepare("select count(*) n from seasons").get()).toEqual({ n: 1 });
});
it("reports no active season as a no-op and validates actors even in dry-run", () => {
  f = fixture();
  expect(runSeason({ db: f.db, apply: true, guildId: "guild" }, "end", {}).message).toMatch(/no active season/i);
  expect(() => runSeason({ db: f.db, apply: false, guildId: "guild" }, "start", { actor: 99 })).toThrow(/actor/i);
});
it("reports status and ends the active season", () => {
  f = fixture(); const ctx = { db: f.db, apply: true, guildId: "guild" };
  runSeason(ctx, "start", {});
  expect(runSeason(ctx, "status", {}).status).toBe("active");
  runSeason(ctx, "end", {});
  expect(runSeason(ctx, "status", {}).status).toBe("inactive");
});
