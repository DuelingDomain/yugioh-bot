import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createWaitlistService } from "@yugidraft/shared/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, pending: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@yugidraft/shared/clerk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@yugidraft/shared/clerk")>(),
  createClerkBackend: () => ({ pendingInvitationEmail: state.pending }),
}));

let post: typeof import("../app/api/auth/invite-method/route").POST;
const ticket = (sid: string) => `h.${Buffer.from(JSON.stringify({ sid, st: "invitation" })).toString("base64url")}.s`;
const call = (body: unknown) => post(new Request("https://app.localhost/api/auth/invite-method", {
  method: "POST", headers: { origin: process.env.WEB_URL!, "x-forwarded-for": "192.0.2.9", "content-type": "application/json" }, body: JSON.stringify(body),
}) as never);

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
  vi.stubEnv("WEB_URL", "https://app.localhost");
  state.db = new Database(":memory:");
  migrate(state.db);
  post = (await import("../app/api/auth/invite-method/route")).POST;
});
afterEach(() => { state.db?.close(); vi.unstubAllEnvs(); });

describe("POST /api/auth/invite-method", () => {
  it("says discord only for a pending invite whose email joined with Discord, and answers false otherwise", async () => {
    const waitlist = createWaitlistService(state.db!);
    waitlist.join("disc@example.com", { source: "app-not-invited", viaDiscord: true });
    waitlist.join("mail@example.com", { source: "app-not-invited" });
    state.pending.mockImplementation(async (id: string) => ({ inv_disc: "disc@example.com", inv_mail: "mail@example.com" } as Record<string, string>)[id] ?? null);
    expect(await (await call({ ticket: ticket("inv_disc") })).json()).toEqual({ discord: true });
    expect(await (await call({ ticket: ticket("inv_mail") })).json()).toEqual({ discord: false });
    // Not pending (revoked, accepted), a bad ticket and a missing ticket never reveal anything.
    expect(await (await call({ ticket: ticket("inv_gone") })).json()).toEqual({ discord: false });
    expect(await (await call({ ticket: "not-a-ticket" })).json()).toEqual({ discord: false });
    expect(await (await call({})).json()).toEqual({ discord: false });
  });
});
