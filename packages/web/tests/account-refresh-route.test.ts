import { beforeEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: resolve }));
import { POST } from "../app/api/account/refresh/route";
beforeEach(() => vi.clearAllMocks());
it("returns the signed-in application identity", async () => {
 resolve.mockResolvedValue({ ok: true, identity: { userId: 42, clerkUserId: "user_one", name: "Yugi", email: null, image: null, discordUserId: null, conflict: "both_have_history" } });
 const res = await POST(); expect(res.status).toBe(200); const body = await res.json(); expect(body.user.id).toBe("42"); expect(body.conflict).toBe("both_have_history"); expect(resolve).toHaveBeenCalledWith({ forceSync: true });
});
it.each([401, 503])("maps session failure %s", async status => {
 resolve.mockResolvedValue({ ok: false, status }); const res = await POST(); expect(res.status).toBe(status); expect(await res.json()).toEqual({ error: status === 401 ? "unauthorized" : "session_unavailable" });
});
