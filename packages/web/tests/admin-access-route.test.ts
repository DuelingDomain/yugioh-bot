import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
let discord: ReturnType<typeof mockDiscordAccess>;
beforeEach(() => {
  vi.resetModules(); auth.mockReset();
  auth.mockResolvedValue({ user: { id: "1", discordUserId: "operator", name: "Operator" } });
  discord = mockDiscordAccess(); vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function get() { const { GET } = await import("../app/api/admin/access/route"); return GET(); }

it("rejects a request with no session", async () => {
  auth.mockResolvedValue(null);
  const response = await get();
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("reports admin: true for a guild admin", async () => {
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ admin: true });
});
it("reports admin: false for an ordinary member", async () => {
  discord.permissions = "0";
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ admin: false });
});
it("reports admin: false for a non-member", async () => {
  discord.memberStatus = 404;
  expect(await (await get()).json()).toEqual({ admin: false });
});
it("returns 503 when Discord cannot be verified", async () => {
  discord.guildStatus = 500;
  const response = await get();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("reports admin: false for a user with no linked Discord account", async () => {
  auth.mockResolvedValue({ user: { id: "1", discordUserId: null, name: "Operator" } });
  expect(await (await get()).json()).toEqual({ admin: false });
});
