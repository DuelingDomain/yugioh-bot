import { beforeEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: resolve }));
import { GET } from "../app/api/auth/session/route";
beforeEach(() => vi.clearAllMocks());
it("returns the signed-in application identity", async () => {
 resolve.mockResolvedValue({ ok: true, identity: { userId: 42, clerkUserId: "user_one", name: "Yugi", email: null, image: null, discordUserId: null, conflict: "both_have_history" } });
 const res = await GET(); expect(res.status).toBe(200); const body = await res.json(); expect(body.user.id).toBe("42"); expect(body.user.discordUserId).toBeNull(); expect(body.expires).toEqual(expect.any(String));
});
it.each([401, 503])("maps session failure %s", async status => {
 resolve.mockResolvedValue({ ok: false, status }); const res = await GET(); expect(res.status).toBe(status === 401 ? 200 : 503); expect(await res.json()).toEqual(status === 401 ? null : { error: "session_unavailable" });
});
