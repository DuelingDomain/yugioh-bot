import { describe, it, expect } from "vitest";
import { activeNavHref, pageTitle, groupedNav, liveRowModel, autoCollapseRoute, parseLiveNow } from "../../../src/components/layout/shell-model";

describe("shell model", () => {
  it("lights the section for detail pages", () => {
    expect(activeNavHref("/tournament/x")).toBe("/tournaments");
    expect(activeNavHref("/draft/x")).toBe("/drafts");
    expect(activeNavHref("/cubes/12")).toBe("/cubes");
    expect(activeNavHref("/player/3", 7)).toBe("/leaderboard");
    expect(activeNavHref("/player/7", 7)).toBeNull();
    expect(activeNavHref("/unknown")).toBeNull();
  });

  it("does not let /tournamentsx match Tournaments", () => {
    expect(activeNavHref("/tournamentsx")).toBeNull();
  });

  it("titles pages from the nav, with the board's detail titles and a fallback", () => {
    expect(pageTitle("/dashboard")).toBe("Dashboard");
    expect(pageTitle("/tournaments")).toBe("Tournaments");
    expect(pageTitle("/tournaments/new")).toBe("New tournament");
    expect(pageTitle("/tournament/x")).toBe("Tournament");
    expect(pageTitle("/draft/x")).toBe("Draft");
    expect(pageTitle("/settings")).toBe("Settings");
    expect(pageTitle("/player/7", 7)).toBe("Your profile");
    expect(pageTitle("/player/8", 7)).toBe("Player");
    expect(pageTitle("/")).toBe("Duelists Kingdom");
  });

  it("groups every nav link once, Settings excluded", () => {
    const hrefs = groupedNav().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toHaveLength(7);
    expect(new Set(hrefs).size).toBe(7);
    expect(hrefs).not.toContain("/settings");
  });
});

describe("liveRowModel", () => {
  it("shows nothing without data or with nothing live", () => {
    expect(liveRowModel(null)).toBeNull();
    expect(liveRowModel({ yourDuel: null, liveCount: 0 })).toBeNull();
  });

  it("your duel wins over the count", () => {
    const row = liveRowModel({ yourDuel: { href: "/duels/abc", opponent: "Kestrel", state: "live" }, liveCount: 4 });
    expect(row).toMatchObject({ kind: "you", title: "Your duel", sub: "Kestrel", action: "Open duel", href: "/duels/abc" });
    expect(row?.name).toBe("Your duel against Kestrel. Open duel");
  });

  it("says the state when your duel is between games or waiting", () => {
    const base = { href: "/duels/abc", opponent: "Kestrel" } as const;
    expect(liveRowModel({ yourDuel: { ...base, state: "between" }, liveCount: 1 })?.sub).toBe("Kestrel, between games");
    expect(liveRowModel({ yourDuel: { ...base, state: "waiting" }, liveCount: 1 })?.sub).toBe("Kestrel, waiting");
  });

  it("falls back to the count and links to /duels", () => {
    expect(liveRowModel({ yourDuel: null, liveCount: 1 })).toMatchObject({ kind: "live", title: "Live now", sub: "1 duel", action: null, href: "/duels" });
    expect(liveRowModel({ yourDuel: null, liveCount: 5 })?.sub).toBe("5 duels");
  });
});

describe("parseLiveNow", () => {
  it("accepts the /api/live shape", () => {
    expect(parseLiveNow({ yourDuel: null, liveCount: 2 })).toEqual({ yourDuel: null, liveCount: 2 });
    expect(parseLiveNow({ yourDuel: { href: "/duels/x", opponent: "A", state: "waiting" }, liveCount: 0 })?.yourDuel?.state).toBe("waiting");
  });

  it.each([
    null,
    "x",
    {},
    { yourDuel: null },
    { yourDuel: null, liveCount: -1 },
    { yourDuel: null, liveCount: "2" },
    { yourDuel: { href: "https://evil.example", opponent: "A", state: "live" }, liveCount: 1 },
    { yourDuel: { href: "//evil.example", opponent: "A", state: "live" }, liveCount: 1 },
    { yourDuel: { href: "/duels/x", opponent: "A", state: "over" }, liveCount: 1 },
  ])("rejects %j", (raw) => {
    expect(parseLiveNow(raw)).toBeNull();
  });
});

describe("autoCollapseRoute", () => {
  it("is the tournament page only", () => {
    expect(autoCollapseRoute("/tournament/friday")).toBe(true);
    expect(autoCollapseRoute("/tournament")).toBe(true);
    expect(autoCollapseRoute("/tournaments")).toBe(false);
    expect(autoCollapseRoute("/tournamentsx")).toBe(false);
    expect(autoCollapseRoute("/dashboard")).toBe(false);
  });
});
