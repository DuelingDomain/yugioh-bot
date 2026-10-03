import { vi } from "vitest";

export function mockDiscordAccess() {
  const state = { memberStatus: 200, guildStatus: 200, permissions: "32" };
  vi.stubEnv("DISCORD_TOKEN", "bot-token");
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/members/")) {
      return Response.json({ roles: ["manager"] }, { status: state.memberStatus });
    }
    if (url.startsWith("https://discord.com/api/v10/guilds/")) {
      return Response.json({
        owner_id: "guild-owner",
        roles: [{ id: "manager", permissions: state.permissions }],
      }, { status: state.guildStatus });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return state;
}
