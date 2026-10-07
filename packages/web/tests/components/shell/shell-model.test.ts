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
    expect(pageTitle("/settings")).toBe("Account");
    expect(pageTitle("/settings/account")).toBe("Account");
    expect(pageTitle("/player/7", 7)).toBe("Your profile");
    expect(pageTitle("/player/8", 7)).toBe("Player");
    expect(pageTitle("/")).toBe("Dueling Domain");
  });

  it("groups every nav link once, Settings excluded", () => {
    const hrefs = groupedNav().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toHaveLength(7);
    expect(new Set(hrefs).size).toBe(7);
    expect(hrefs).not.toContain("/settings");
  });
});

describe("liveRowModel", () => {
  it("uses socket presence rather than lobby readiness for the opponent", () => {
    const live = { yourDuel: { href: "/duels/abc", opponent: "milansteg", state: "waiting" as const,
      opponents: [{ seat: 1, name: "milansteg", isBot: false }] }, liveCount: 0 };
    expect(liveRowModel(live, { onlineSeats: [1], spectatorCount: 0 }))
      .toMatchObject({ sub: "milansteg · in the room", present: true });
    expect(liveRowModel(live, { onlineSeats: [0], spectatorCount: 0 }))
      .toMatchObject({ sub: "milansteg · away", present: false });
    expect(liveRowModel(live, null)).toMatchObject({ sub: "milansteg · presence unavailable", present: false });
  });

  it("shows presence per opponent in a multiplayer lobby and labels bots", () => {
    const live = { yourDuel: { href: "/duels/abc", opponent: "A", state: "waiting" as const,
      opponents: [{ seat: 0, name: "A", isBot: false }, { seat: 2, name: "B", isBot: false },
        { seat: 3, name: "Practice Bot", isBot: true }] }, liveCount: 0 };
    expect(liveRowModel(live, { onlineSeats: [2], spectatorCount: 0 }))
      .toMatchObject({ sub: "A · away; B · in the room; Practice Bot · bot", present: true });
  });
  it("shows nothing without data or with nothing live", () => {
    expect(liveRowModel(null)).toBeNull();
    expect(liveRowModel({ yourDuel: null, liveCount: 0 })).toBeNull();
  });

  it("your duel wins over the count", () => {
    const row = liveRowModel({ yourDuel: { href: "/duels/abc", opponent: "Kestrel", state: "live" }, liveCount: 4 });
    expect(row).toMatchObject({ kind: "you", title: "Your duel", sub: "Kestrel · presence unavailable", action: "Open duel", href: "/duels/abc" });
    expect(row?.name).toBe("Your duel against Kestrel · presence unavailable. Open duel");
  });

  it("does not use the game state as evidence of room presence", () => {
    const base = { href: "/duels/abc", opponent: "Kestrel" } as const;
    expect(liveRowModel({ yourDuel: { ...base, state: "between" }, liveCount: 1 })?.sub).toBe("Kestrel · presence unavailable");
    expect(liveRowModel({ yourDuel: { ...base, state: "waiting" }, liveCount: 1 })?.sub).toBe("Kestrel · presence unavailable");
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
