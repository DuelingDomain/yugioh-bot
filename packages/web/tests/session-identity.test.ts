import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), getUser: vi.fn(), update: vi.fn(), cookie: undefined as string | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.auth }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
vi.mock("@yugidraft/shared/clerk", async importOriginal => ({ ...await importOriginal<typeof import("@yugidraft/shared/clerk")>(), createClerkBackend: () => ({ getUser: state.getUser, updateUserExternalId: state.update }) }));
import { resolveSessionIdentity } from "../src/lib/session-identity";
import { signE2ESession } from "../src/lib/e2e-auth";
const json = { id: "user_one", username: "yugi", first_name: "Yugi", last_name: null, image_url: "avatar", external_id: null, primary_email_address_id: "email", email_addresses: [{ id: "email", email_address: "yugi@example.com", verification: { status: "verified" } }], external_accounts: [{ provider: "oauth_discord", provider_user_id: "123", verification: { status: "verified" } }] };
beforeEach(() => {
  state.db = new Database(":memory:"); migrate(state.db); state.db.pragma("foreign_keys=on");
  vi.clearAllMocks(); state.cookie = undefined; state.auth.mockResolvedValue({ userId: "user_one" }); state.getUser.mockResolvedValue(json); state.update.mockResolvedValue(json);
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret"); vi.stubEnv("E2E_AUTH", "0");
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); });
it("uses a fresh row without a backend call", async () => {
  createUserService(state.db!).resolveClerkProfile({ clerkUserId: "user_one", username: "yugi", displayName: "Yugi", email: null, emailVerified: false, discordUserId: null, imageUrl: null });
  expect(await resolveSessionIdentity()).toMatchObject({ ok: true, identity: { name: "Yugi", clerkUserId: "user_one", discordUserId: null } });
  expect(state.getUser).not.toHaveBeenCalled();
});
it("syncs a missing row and folds concurrent first access into the imported history", async () => {
  const imported = createUserService(state.db!).ensureDiscord({ discordUserId: "123", displayName: "Imported" });
  state.db!.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g','History',?)").run(imported.id);
  state.db!.prepare("insert into players(id,guild_id,user_id,discord_user_id,display_name) values(61,'g',?,'123','Imported')").run(imported.id);
  const [a, b] = await Promise.all([resolveSessionIdentity(), resolveSessionIdentity()]);
  expect(a).toMatchObject({ ok: true, identity: { userId: imported.id, discordUserId: "123" } }); expect(b).toEqual(a);
  expect(state.getUser).toHaveBeenCalledTimes(1);
  expect(state.db!.prepare("select count(*) as n from users").get()).toEqual({ n: 1 });
  expect(state.db!.pragma("foreign_key_check")).toEqual([]);
  expect(state.db!.prepare("select id,user_id from players").all()).toEqual([{ id: 61, user_id: imported.id }]);
});
it.each([false, true])("syncs stale or forced rows (force=%s)", async forceSync => {
  await resolveSessionIdentity(); state.getUser.mockClear();
  if (!forceSync) state.db!.exec("update users set synced_at='2000-01-01T00:00:00Z'");
  expect(await resolveSessionIdentity({ forceSync })).toMatchObject({ ok: true }); expect(state.getUser).toHaveBeenCalledTimes(1);
});
it.each([0, 429, 500, 404])("maps backend status %s without advancing synced_at", async status => {
  await resolveSessionIdentity(); state.db!.exec("update users set synced_at='2000-01-01T00:00:00Z'");
  state.getUser.mockRejectedValue(new ClerkBackendError("failure", status, null, null));
  expect(await resolveSessionIdentity()).toEqual({ ok: false, status: status === 404 ? 401 : 503 });
  expect(createUserService(state.db!).findByClerkId("user_one")?.syncedAt).toBe("2000-01-01T00:00:00Z");
});
it("maps a missing secret to unavailable", async () => {
  vi.stubEnv("CLERK_SECRET_KEY", ""); expect(await resolveSessionIdentity()).toEqual({ ok: false, status: 503 }); expect(state.getUser).not.toHaveBeenCalled();
});
it("bypasses Clerk entirely only with the enabled gate and a signed cookie for an existing user", async () => {
  const user = createUserService(state.db!).createNonLogin("Offline"); const secret = "x".repeat(32);
  vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", secret); state.cookie = signE2ESession(user.id, secret);
  expect(await resolveSessionIdentity()).toMatchObject({ ok: true, identity: { userId: user.id, clerkUserId: null } }); expect(state.auth).not.toHaveBeenCalled();
  state.cookie = signE2ESession(user.id + 1, secret); expect(await resolveSessionIdentity()).toEqual({ ok: false, status: 401 });
  vi.stubEnv("E2E_AUTH", "0"); state.auth.mockResolvedValue({ userId: null }); expect(await resolveSessionIdentity()).toEqual({ ok: false, status: 401 });
  expect(state.auth).toHaveBeenCalledTimes(1);
});

it("keeps two histories separate and returns the conflict to forced refresh", async () => {
 const users = createUserService(state.db!);
 const imported = users.ensureDiscord({ discordUserId: "123", displayName: "Imported" });
 const signedIn = users.resolveClerkProfile({ clerkUserId: "user_one", username: "signed_in", displayName: "Signed in", email: null, emailVerified: false, discordUserId: null, imageUrl: null }).user;
 const insert = state.db!.prepare("insert into cubes(guild_id,name,created_by_user_id) values('g',?,?)"); insert.run("Imported history", imported.id); insert.run("Signed-in history", signedIn.id);
 const { POST } = await import("../app/api/account/refresh/route"); const res = await POST();
 expect(res.status).toBe(200); expect(await res.json()).toEqual({ user: { id: String(signedIn.id) }, conflict: "both_have_history" });
 expect(users.findById(imported.id)?.clerkUserId).toBeNull(); expect(users.findById(signedIn.id)?.discordUserId).toBeNull(); expect(state.db!.prepare("select created_by_user_id from cubes order by id").all()).toEqual([{ created_by_user_id: imported.id }, { created_by_user_id: signedIn.id }]);
});
