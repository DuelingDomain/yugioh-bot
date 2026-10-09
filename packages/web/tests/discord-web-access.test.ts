import { afterEach, beforeEach, expect, it, vi } from "vitest";
const checks = vi.hoisted(() => ({ member: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "configured-guild" } }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: checks.member }));
vi.mock("@/lib/discord-guild-admin", () => ({ verifyDiscordGuildAdmin: checks.admin }));
import { checkDiscordWebAccess } from "../src/lib/discord-web-access";
beforeEach(() => {
  checks.member.mockReset().mockResolvedValue({ ok: true });
  checks.admin.mockReset().mockResolvedValue({ ok: true });
  vi.stubEnv("DISCORD_TOKEN", "test-bot-token");
});
afterEach(() => vi.unstubAllEnvs());
it("checks membership and guild admin permissions with the configured guild", async () => {
  expect(await checkDiscordWebAccess("linked-discord-id", "admin")).toEqual({ ok: true });
  const input = { guildId: "configured-guild", userId: "linked-discord-id", botToken: "test-bot-token" };
  expect(checks.member).toHaveBeenCalledWith(input);
  expect(checks.admin).toHaveBeenCalledWith(input);
});
it.each([403, 503] as const)("does not grant admin access when membership returns %s", async status => {
  checks.member.mockResolvedValue({ ok: false, status });
  expect(await checkDiscordWebAccess("linked-discord-id", "admin")).toEqual({ ok: false, status });
  expect(checks.admin).not.toHaveBeenCalled();
});
