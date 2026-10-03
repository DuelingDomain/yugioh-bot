import { describe, it, expect } from "vitest";
import { activeNavHref, pageTitle, groupedNav } from "../../../src/components/layout/shell-model";

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
    expect(pageTitle("/")).toBe("YugiDraft");
  });

  it("groups every nav link once, Settings excluded", () => {
    const hrefs = groupedNav().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toHaveLength(7);
    expect(new Set(hrefs).size).toBe(7);
    expect(hrefs).not.toContain("/settings");
  });
});
