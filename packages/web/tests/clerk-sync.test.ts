import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ db: null as Database.Database | null, get: vi.fn(), update: vi.fn(), metadata: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => s.db! }));
vi.mock("@yugidraft/shared/clerk", async original => ({ ...await original<typeof import("@yugidraft/shared/clerk")>(), createClerkBackend: () => ({ getUser: s.get, updateUserExternalId: s.update, updateUserMetadata: s.metadata }) }));
import { syncClerkUser } from "../src/lib/clerk-sync";
const json = { id: "user_sync", username: "sync", first_name: null, last_name: null, image_url: null, external_id: null, primary_email_address_id: null, email_addresses: [], external_accounts: [] };
beforeEach(() => { s.db = new Database(":memory:"); migrate(s.db); vi.clearAllMocks(); s.get.mockResolvedValue(json); s.update.mockResolvedValue(json); s.metadata.mockResolvedValue(json); vi.stubEnv("CLERK_SECRET_KEY", "fake"); });
afterEach(() => { s.db?.close(); vi.unstubAllEnvs(); });
it("fetches outside a transaction and retries external ID repair twice", async () => {
 s.get.mockImplementation(async () => { expect(s.db!.inTransaction).toBe(false); return json; }); s.update.mockRejectedValueOnce(new Error("transport")).mockRejectedValueOnce(new Error("transport"));
 const outcome = await syncClerkUser("user_sync"); expect(outcome.user.clerkUserId).toBe("user_sync"); await vi.waitFor(() => expect(s.update).toHaveBeenCalledTimes(3)); expect(s.update).toHaveBeenLastCalledWith("user_sync", String(outcome.user.id));
});
it("does not fail a committed sync if external ID repair remains unavailable", async () => {
 s.update.mockRejectedValue(new Error("secret or identity must never be logged")); const log = vi.spyOn(console, "warn").mockImplementation(() => {});
 try { const result = await syncClerkUser("user_sync"); expect(createUserService(s.db!).findById(result.user.id)?.clerkUserId).toBe("user_sync"); await vi.waitFor(() => expect(log).toHaveBeenCalledExactlyOnceWith("[clerk-sync] External identity repair failed")); expect(s.update).toHaveBeenCalledTimes(3); expect(log.mock.calls.flat().join(" ")).not.toContain("secret or identity"); } finally { log.mockRestore(); }
});
it("clears an unsuccessful in-flight request so a later request can retry", async () => {
 s.get.mockRejectedValueOnce(new Error("failed")); await expect(syncClerkUser("user_sync")).rejects.toThrow("failed"); expect((await syncClerkUser("user_sync")).user.clerkUserId).toBe("user_sync"); expect(s.get).toHaveBeenCalledTimes(2);
});
it("refreshes a recovered profile on its original user and player without losing its proven Discord ID", async () => {
 const users = createUserService(s.db!);
 const existing = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "Original" });
 const playerId = Number(s.db!.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)").run(existing.id, existing.discordUserId, "Original").lastInsertRowid);
 users.claimExistingDiscordUser(existing.id, existing.discordUserId!, "user_sync");
 s.get.mockResolvedValue({ ...json, external_id: String(existing.id), private_metadata: { existingPlayerDiscordId: existing.discordUserId }, primary_email_address_id: "primary", email_addresses: [{ id: "primary", email_address: "yugi@test.dev", verification: { status: "verified" } }] });
 const result = await syncClerkUser("user_sync");
 expect(result.user).toMatchObject({ id: existing.id, clerkUserId: "user_sync", discordUserId: existing.discordUserId, email: "yugi@test.dev", emailVerified: true, username: "sync" });
 expect(s.db!.prepare("select id,user_id,discord_user_id from players").get()).toEqual({ id: playerId, user_id: existing.id, discord_user_id: existing.discordUserId });
 expect(s.db!.prepare("select count(*) as n from users").get()).toEqual({ n: 1 });
});
it("retires matching recovery metadata so a later Discord unlink clears users and players", async () => {
 const users = createUserService(s.db!);
 const existing = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "Original" });
 s.db!.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)").run(existing.id, existing.discordUserId, "Original");
 users.claimExistingDiscordUser(existing.id, existing.discordUserId!, "user_sync");
 const stored = { ...json, external_id: String(existing.id), private_metadata: { existingPlayerDiscordId: existing.discordUserId, unrelated: "keep" } as Record<string, unknown>,
  external_accounts: [{ provider: "oauth_discord", provider_user_id: existing.discordUserId!, verification: { status: "verified" } }] };
 s.get.mockImplementation(async () => stored);
 s.metadata.mockImplementation(async (id, params) => {
  expect(id).toBe("user_sync"); expect(params).toEqual({ privateMetadata: { existingPlayerDiscordId: null } });
  delete stored.private_metadata.existingPlayerDiscordId; return stored;
 });
 expect((await syncClerkUser("user_sync")).user.discordUserId).toBe(existing.discordUserId);
 await vi.waitFor(() => expect(s.metadata).toHaveBeenCalledTimes(1));
 expect(stored.private_metadata).toEqual({ unrelated: "keep" });
 stored.external_accounts = [];
 expect((await syncClerkUser("user_sync")).user.discordUserId).toBeNull();
 expect(s.db!.prepare("select user_id,discord_user_id from players").get()).toEqual({ user_id: existing.id, discord_user_id: null });
 expect(users.findByDiscordId("900000000000000101")).toBeUndefined();
});
it.each(["unverified", "different", "absent"])("keeps bootstrap metadata when the external Discord account is %s", async status => {
 s.get.mockResolvedValue({ ...json, private_metadata: { existingPlayerDiscordId: "900000000000000101" }, external_accounts: status === "absent" ? [] : [
  { provider: "oauth_discord", provider_user_id: status === "different" ? "900000000000000999" : "900000000000000101", verification: { status: status === "unverified" ? "unverified" : "verified" } } ] });
 const result = await syncClerkUser("user_sync");
 expect(result.user.discordUserId).toBe(status === "different" ? "900000000000000999" : "900000000000000101");
 expect(s.metadata).not.toHaveBeenCalled();
});
it("does not fail sync when recovery metadata cleanup rejects", async () => {
 s.get.mockResolvedValue({ ...json, private_metadata: { existingPlayerDiscordId: "900000000000000101" }, external_accounts: [
  { provider: "oauth_discord", provider_user_id: "900000000000000101", verification: { status: "verified" } } ] });
 s.metadata.mockRejectedValue(new Error("private provider failure"));
 expect((await syncClerkUser("user_sync")).user.discordUserId).toBe("900000000000000101");
 await vi.waitFor(() => expect(s.metadata).toHaveBeenCalledTimes(1));
});
it("returns the sync outcome without waiting for recovery metadata cleanup", async () => {
 s.get.mockResolvedValue({ ...json, private_metadata: { existingPlayerDiscordId: "900000000000000101" }, external_accounts: [
  { provider: "oauth_discord", provider_user_id: "900000000000000101", verification: { status: "verified" } } ] });
 let finish!: (value: typeof json) => void;
 s.metadata.mockReturnValue(new Promise<typeof json>(resolve => { finish = resolve; }));
 const sync = syncClerkUser("user_sync");
 try {
  const result = await Promise.race([sync, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
  expect(result?.user.discordUserId).toBe("900000000000000101");
  expect(s.metadata).toHaveBeenCalledTimes(1);
 } finally { finish?.(json); await sync; }
});
it("returns the committed outcome while external ID repair is still pending", async () => {
 let finishRepair!: (value: typeof json) => void;
 s.update.mockReturnValue(new Promise<typeof json>(resolve => { finishRepair = resolve; }));
 const sync = syncClerkUser("user_sync");
 try {
  const result = await Promise.race([sync, new Promise<null>(resolve => setImmediate(() => resolve(null)))]);
  expect(result).not.toBeNull();
  expect(createUserService(s.db!).findById(result!.user.id)?.clerkUserId).toBe("user_sync");
 } finally { finishRepair(json); await sync; }
});
