// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../../app/(app)/settings/page";

vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
    render(<SettingsPage />);
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
