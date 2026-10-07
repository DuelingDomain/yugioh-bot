import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  db: null as Database.Database | null,
  access: vi.fn(),
  deleteUser: vi.fn(),
  createBackend: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => s.db! }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: s.access }));
vi.mock("@yugidraft/shared/clerk", async original => ({
  ...await original<typeof import("@yugidraft/shared/clerk")>(),
  createClerkBackend: (...args: unknown[]) => { s.createBackend(...args); return { deleteUser: s.deleteUser }; },
}));
import { POST } from "../app/api/account/delete/route";

const E2E_SECRET = "e".repeat(32);
const req = (body: unknown, raw = false) =>
  new Request("https://app.example.com/api/account/delete", { method: "POST", body: raw ? String(body) : JSON.stringify(body) });
const signedIn = (userId = 1) => s.access.mockResolvedValue({ ok: true, userId, discordUserId: "111", userName: "Display Name" });
const rowOf = (id: number) => s.db!.prepare("select * from users where id=?").get(id) as Record<string, unknown> | undefined;

beforeEach(() => {
  s.db = new Database(":memory:"); migrate(s.db); s.db.pragma("foreign_keys = on");
  s.db.exec(`
    insert into users(id,clerk_user_id,email,email_verified,username,display_name,discord_user_id)
      values (1,'user_one','one@example.com',1,'Yugi_1','Display Name','111'),(2,'user_two','two@example.com',1,'two','Two','222');
    insert into players(id,guild_id,user_id,discord_user_id,display_name) values (1,'g',1,'111','Display Name'),(2,'g',2,'222','Two');
    insert into matches(guild_id,player_one_id,player_two_id,winner_id,reporter_id,status,source) values ('g',1,2,1,1,'confirmed','casual');
    insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('g',1,'Deck','normal','{}');
    insert into waitlist_signups(email,created_at,source) values ('one@example.com','2026-10-01','form');
  `);
  vi.clearAllMocks();
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_secret");
  vi.stubEnv("E2E_AUTH", "");
  vi.stubEnv("E2E_AUTH_SECRET", "");
  s.deleteUser.mockResolvedValue(undefined);
  signedIn();
});
afterEach(() => { s.db?.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("answers 401 when signed out, without touching Clerk or the database", async () => {
  s.access.mockResolvedValue({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) });
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(s.deleteUser).not.toHaveBeenCalled();
  expect(rowOf(1)?.email).toBe("one@example.com");
});

it.each([
  [{ confirm: "yugi_1" }, "case matters"],
  [{ confirm: "Display Name" }, "the display name is not the username"],
  [{ confirm: "" }, "empty"],
  [{}, "missing"],
  [{ confirm: 5 }, "not a string"],
  [{ confirm: ["Yugi_1"] }, "an array"],
])("answers 400 confirm_mismatch for %j (%s)", async (body: unknown, _why: unknown) => {
  const res = await POST(req(body));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "confirm_mismatch" });
  expect(s.deleteUser).not.toHaveBeenCalled();
  expect(rowOf(1)?.email).toBe("one@example.com");
});

it("answers 400 for a body that is not JSON", async () => {
  const res = await POST(req("{nope", true));
  expect(res.status).toBe(400);
  expect(s.deleteUser).not.toHaveBeenCalled();
});

it("answers 401 when the signed-in user's row no longer exists", async () => {
  s.access.mockResolvedValue({ ok: true, userId: 99, discordUserId: null, userName: "x" });
  const res = await POST(req({ confirm: "x" }));
  expect(res.status).toBe(401);
  expect(s.deleteUser).not.toHaveBeenCalled();
});

it("deletes the Clerk user before it changes the database, then answers 200 with no store", async () => {
  s.deleteUser.mockImplementation(async () => {
    expect(rowOf(1)?.email).toBe("one@example.com"); // the database is still whole when Clerk is called
  });
  const res = await POST(req({ confirm: "  Yugi_1  " })); // trimmed
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(s.createBackend).toHaveBeenCalledWith(expect.objectContaining({ secretKey: "sk_test_secret" }));
  expect(s.deleteUser).toHaveBeenCalledExactlyOnceWith("user_one");
  expect(rowOf(1)).toMatchObject({ clerk_user_id: null, email: null, username: "deleted-1", display_name: "Deleted player", discord_user_id: null });
  expect(s.db!.prepare("select count(*) n from saved_decks").get()).toEqual({ n: 0 });
  expect(s.db!.prepare("select count(*) n from waitlist_signups").get()).toEqual({ n: 0 });
  expect(s.db!.prepare("select player_one_id, winner_id from matches").get()).toEqual({ player_one_id: 1, winner_id: 1 });
  expect(rowOf(2)?.email).toBe("two@example.com");
});

it("removes a user with no history entirely", async () => {
  s.db!.exec("insert into users(id,clerk_user_id,username,display_name) values (3,'user_three','three','Three')");
  signedIn(3);
  const res = await POST(req({ confirm: "three" }));
  expect(res.status).toBe(200);
  expect(rowOf(3)).toBeUndefined();
});

it.each([
  ["a server error", new ClerkBackendError("Down", 503, null, null)],
  ["a rate limit", new ClerkBackendError("Slow", 429, null, 3000)],
  ["a denied key", new ClerkBackendError("No", 401, null, null)],
  ["a transport failure", new ClerkBackendError("Timed out", 0, null, null)],
  ["an unexpected exception", new Error("kaboom")],
])("answers 503 retry_later and leaves the database untouched when Clerk fails with %s", async (_label, error) => {
  s.deleteUser.mockRejectedValue(error);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "retry_later" });
  expect(rowOf(1)).toMatchObject({ clerk_user_id: "user_one", email: "one@example.com", username: "Yugi_1" });
  expect(s.db!.prepare("select count(*) n from saved_decks").get()).toEqual({ n: 1 });
  expect(s.db!.prepare("select count(*) n from waitlist_signups").get()).toEqual({ n: 1 });
  expect([...log.mock.calls, ...warn.mock.calls].flat().join(" ")).not.toMatch(/one@example|sk_test_secret|user_one/);
});

it("answers 503 retry_later when the Clerk secret is missing, with the database untouched", async () => {
  vi.stubEnv("CLERK_SECRET_KEY", "");
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "retry_later" });
  expect(s.deleteUser).not.toHaveBeenCalled();
  expect(rowOf(1)?.email).toBe("one@example.com");
});

it("answers 500 server_error when the database step fails after Clerk, logging only the user ID", async () => {
  s.db!.exec("create trigger boom before delete on waitlist_signups begin select raise(abort, 'one@example.com exploded'); end");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "server_error" });
  expect(s.deleteUser).toHaveBeenCalledOnce();
  // The transaction rolled back, so the owner command can finish the job.
  expect(rowOf(1)).toMatchObject({ clerk_user_id: "user_one", email: "one@example.com" });
  const logged = log.mock.calls.flat().map(String).join(" ");
  expect(logged).toContain("1");
  expect(logged).not.toMatch(/example\.com|exploded|Yugi_1|Display Name|sk_test_secret/);
  expect(log.mock.calls.flat().some(arg => arg instanceof Error)).toBe(false);
});

it("skips Clerk when the row has no Clerk user ID", async () => {
  s.db!.exec("update users set clerk_user_id=null where id=1");
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(200);
  expect(s.createBackend).not.toHaveBeenCalled();
  expect(s.deleteUser).not.toHaveBeenCalled();
  expect(rowOf(1)?.username).toBe("deleted-1");
});

it("is safe to repeat: a second request after success is answered 401 by the session, and a replay on the same row is a no-op", async () => {
  expect((await POST(req({ confirm: "Yugi_1" }))).status).toBe(200);
  // The row is now anonymised and nobody can sign in as it: its username no longer matches the old text.
  const replay = await POST(req({ confirm: "Yugi_1" }));
  expect(replay.status).toBe(400);
  expect(s.deleteUser).toHaveBeenCalledOnce();
});

it("in E2E mode never calls Clerk, works without a Clerk secret, and clears the session cookie", async () => {
  vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", E2E_SECRET); vi.stubEnv("CLERK_SECRET_KEY", "");
  const res = await POST(req({ confirm: "Yugi_1" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(s.createBackend).not.toHaveBeenCalled();
  expect(s.deleteUser).not.toHaveBeenCalled();
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toContain("dd_e2e_session=;");
  expect(cookie).toContain("Max-Age=0");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("HttpOnly");
  expect(rowOf(1)).toMatchObject({ username: "deleted-1", clerk_user_id: null });
});

it("in E2E mode still checks the confirmation text", async () => {
  vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", E2E_SECRET);
  const res = await POST(req({ confirm: "nope" }));
  expect(res.status).toBe(400);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(rowOf(1)?.email).toBe("one@example.com");
});
