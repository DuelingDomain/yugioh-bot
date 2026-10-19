// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../../app/(app)/settings/page";

const { auth } = vi.hoisted(() => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth", () => ({ auth }));

vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("SettingsPage", () => {
  it("renders the season and announcement sections without the card pools manager or announcement switches", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/settings") {
        return Response.json({ guildId: "g1", announceChannelId: null });
      }
      if (url === "/api/admin/season") return Response.json({ season: null });
      return Response.json({ channels: [] });
    }));
    render(await SettingsPage());
    screen.getByRole("heading", { level: 1, name: /settings/i });
    screen.getByRole("heading", { name: "Season" });
    screen.getByRole("heading", { name: "Announcements" });
    await screen.findByRole("heading", { name: "What the bot posts" });
    // The only switch is the per-device 3D mode toggle; the announcements section has none.
    expect(screen.getAllByRole("switch").map((el) => el.getAttribute("aria-labelledby"))).toHaveLength(1);
    screen.getByRole("switch", { name: /3D mode/i });
    expect(screen.queryByRole("heading", { name: /card pools/i })).toBeNull();
  });
});


it.each([["101", true], ["202", false]])("shows the report link for %s according to OWNER_USER_IDS", async (userId, visible) => {
  vi.stubEnv("OWNER_USER_IDS", "101");
  auth.mockResolvedValue({ user: { id: userId, name: "User" } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ channels: [], season: null })));
  render(await SettingsPage());
  await screen.findByRole("heading", { name: "What the bot posts" });
  const link = screen.queryByRole("link", { name: "Bug reports" });
  if (visible) expect(link).toHaveAttribute("href", "/settings/bug-reports");
  else expect(link).toBeNull();
});
