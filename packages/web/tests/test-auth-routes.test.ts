import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { POST } from "../app/api/test-auth/session/route";
import { POST as signOut } from "../app/api/test-auth/sign-out/route";
import { verifyE2ESession } from "../src/lib/e2e-auth";
const secret = "x".repeat(32);
const req = (body: unknown, url = "https://example.com/api/test-auth/session") => new Request(url, { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { state.db = new Database(":memory:"); migrate(state.db); state.db.exec("insert into users(id,username,display_name) values(42,'offline','Offline')"); vi.stubEnv("E2E_AUTH", "1"); vi.stubEnv("E2E_AUTH_SECRET", secret); });
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); });
it("issues the agreed signed cookie with secure flags and application identity", async () => {
 const res = await POST(req({ userId: 42, secret })); expect(res.status).toBe(200); expect(await res.json()).toEqual({ user: { id: "42", name: "Offline" } });
 const header = res.headers.get("set-cookie")!; expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=lax"); expect(header).toContain("Secure"); expect(header).toContain("Max-Age=3600"); expect(header).toContain("Path=/");
 expect(verifyE2ESession(header.split(";")[0].split("=")[1], secret)).toBe(42);
 expect((await POST(req({ userId: 42, secret }, "http://localhost/api/test-auth/session"))).headers.get("set-cookie")).not.toContain("Secure");
});
it("checks secret and rejects missing users and malformed numeric IDs", async () => {
 expect((await POST(req({ userId: 42, secret: "wrong" }))).status).toBe(401);
 for (const userId of [0, -1, 1.5, "42", 9007199254740993]) expect((await POST(req({ userId, secret }))).status).toBe(404);
 expect((await POST(req({ userId: 43, secret }))).status).toBe(404);
});
it("disables both endpoints per request and clears the cookie on sign-out", async () => {
 const res = await signOut(); expect(res.status).toBe(204); expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
 vi.stubEnv("E2E_AUTH", "0"); expect((await POST(req({ userId: 42, secret }))).status).toBe(404); expect((await signOut()).status).toBe(404);
});
