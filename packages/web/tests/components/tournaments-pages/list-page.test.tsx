// @vitest-environment jsdom
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "../../fixtures/identity";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../../../shared/src/db/schema";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("../../fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g1" } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import TournamentsPage from "../../../app/(app)/tournaments/page";
import { OPEN_DRAFT, stubOpenNow } from "../../fixtures/open-now";

describe("TournamentsPage", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    getDb.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u1")), discordUserId: fixtureDiscordId("u1") } });
    stubOpenNow();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    db.close();
    vi.clearAllMocks();
  });

  const add = (name: string, status: string, createdAt: string, slug: string | null = null, format = "round_robin", guild = "g1") =>
    db
      .prepare(`insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug, created_at) values (?, ?, ?, ?, ${fixtureUserId("u1")}, ?, ?)`)
      .run(guild, name, format, status, slug, createdAt);

  it("shows the empty state without a Discord command, with one primary action over a faded preview", async () => {
    const { container } = render(await TournamentsPage());
    expect(screen.getByRole("heading", { name: "No tournaments yet" })).toBeTruthy();
    expect(screen.queryByText("/event create")).toBeNull();
    expect(screen.getByText(/Create one and share the link/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("link", { name: /new tournament/i })).toHaveLength(2));
    expect(screen.getAllByRole("link", { name: /new tournament/i }).map((a) => a.getAttribute("href"))).toEqual(["/tournaments/new", "/tournaments/new"]);
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(container.querySelector(".sv-bar a.sv-btn")).not.toHaveClass("primary");
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(document.querySelector(".sv-bar-sub")).toBeNull();
  });

  it("leads with open drafts and running duels when there are any, the top row holding the one primary", async () => {
    stubOpenNow({ tournaments: [], drafts: [OPEN_DRAFT], duelsInProgress: 1 });
    const { container } = render(await TournamentsPage());
    await screen.findByRole("heading", { name: "Open right now" });
    expect(screen.getByRole("link", { name: "Join draft" })).toHaveClass("primary");
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Cube night" })).toHaveAttribute("href", "/draft/cube-night");
    expect(screen.getByText("1 duel in progress")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /new tournament/i })).toHaveLength(1);
  });

  it("falls back to the plain empty state when the open list fails", async () => {
    stubOpenNow(503);
    const { container } = render(await TournamentsPage());
    await screen.findAllByRole("link", { name: /new tournament/i });
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Open right now" })).toBeNull();
  });

  it("keeps the New tournament bar button primary once there are tournaments", async () => {
    add("Open one", "pending", "2026-02-01 00:00:00", "open-one");
    render(await TournamentsPage());
    expect(document.querySelector(".sv-bar a.sv-btn")).toHaveClass("primary");
    expect(screen.queryByText("No tournaments yet")).toBeNull();
  });

  it("orders running, then open, then finished, newest first, and skips cancelled and other guilds", async () => {
    add("Old finished", "completed", "2026-01-01 00:00:00");
    add("New finished", "completed", "2026-03-01 00:00:00");
    add("Open one", "pending", "2026-02-01 00:00:00", "open-one");
    add("Older run", "active", "2026-01-05 00:00:00");
    add("Newer run", "active", "2026-02-05 00:00:00", "newer-run", "single_elim");
    add("Gone", "cancelled", "2026-02-06 00:00:00");
    add("Elsewhere", "active", "2026-02-07 00:00:00", null, "round_robin", "g2");
    render(await TournamentsPage());

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["In progress", "Open to join", "Finished"]);

    const running = within(screen.getByRole("region", { name: "In progress" })).getAllByRole("link");
    expect(running.map((a) => a.getAttribute("href"))).toEqual(["/tournament/newer-run", expect.stringMatching(/^\/tournament\/\d+$/)]);
    expect(running[0].textContent).toContain("Newer run");
    expect(Array.from(running[0].parentElement!.querySelector("p")!.children, (item) => item.textContent)).toEqual([
      "In progress", "Single elimination", "0 players",
    ]);
    expect(running[1].textContent).toContain("Older run");

    const open = within(screen.getByRole("region", { name: "Open to join" })).getAllByRole("link");
    expect(open).toHaveLength(1);
    expect(open[0].getAttribute("href")).toBe("/tournament/open-one");

    const fin = within(screen.getByRole("region", { name: "Finished" })).getAllByRole("link");
    expect(fin).toHaveLength(2);
    expect(fin[0].textContent).toMatch(/^New finished/);
    expect(fin[1].textContent).toMatch(/^Old finished/);

    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(document.querySelector(".sv-bar-sub")!.textContent).toBe("2 in progress, 1 open to join, 2 finished");
  });

  it("writes the summary in plain commas and leaves out empty groups", async () => {
    add("Running", "active", "2026-02-01 00:00:00");
    add("Open", "pending", "2026-02-02 00:00:00");
    render(await TournamentsPage());

    const sub = document.querySelector(".sv-bar-sub")!;
    expect(sub.textContent).toBe("1 in progress, 1 open to join");
    expect(sub.textContent).not.toContain("·");
    expect(screen.queryByRole("region", { name: "Finished" })).toBeNull();
  });

  it("shows the first five finished tournaments, then all of them on Show all", async () => {
    for (let i = 1; i <= 7; i++) add(`Done ${i}`, "completed", `2026-01-0${i} 00:00:00`);
    render(await TournamentsPage());
    const region = screen.getByRole("region", { name: "Finished" });
    expect(within(region).getAllByRole("link")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(within(region).getAllByRole("link")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
  });
});

const FIXTURE_KEYS = ["u1"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
