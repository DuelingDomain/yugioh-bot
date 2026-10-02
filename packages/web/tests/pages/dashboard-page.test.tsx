// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../../shared/src/db/schema";
import DashboardPage from "../../app/(app)/dashboard/page";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g1" } }));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

function readout(label: string) {
  const key = screen.getByText(label, { selector: ".lp-k" });
  return key.closest(".lp") as HTMLElement;
}

describe("DashboardPage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    getDb.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: "u1", name: "Yugi" } });
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.clearAllMocks();
  });

  it("shows the welcome panel, not dashes, when the user has no player yet", async () => {
    render(await DashboardPage());
    screen.getByRole("heading", { name: "Your first match puts you on the board" });
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your standing" })).toBeNull();
  });

  it("counts approved wins and losses in the configured guild only", async () => {
    db.prepare(
      `insert into players (id, guild_id, discord_user_id, display_name) values
       (1, 'g1', 'u1', 'Yugi'), (2, 'g1', 'u2', 'Kaiba'), (3, 'g1', 'u3', 'Joey'),
       (4, 'g2', 'u1', 'Yugi'), (5, 'g2', 'u2', 'Kaiba')`,
    ).run();
    db.prepare(
      `insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values
       ('g1', 1, 2, 1, 1, 'approved', 'casual'),
       ('g2', 5, 4, 4, 4, 'approved', 'casual'),
       ('g1', 2, 1, 2, 2, 'approved', 'casual'),
       ('g1', 1, 2, 1, 1, 'pending', 'casual'),
       ('g1', 1, 2, 2, 2, 'denied', 'casual'),
       ('g1', 2, 3, 2, 2, 'approved', 'casual')`,
    ).run();

    render(await DashboardPage());

    const record = readout("Record");
    expect(record).toHaveTextContent("1–1");
    expect(record).toHaveTextContent("50% won");
  });

  it("shows a zero record for a player with no matches", async () => {
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', 'u1', 'Yugi')").run();
    render(await DashboardPage());
    expect(readout("Record")).toHaveTextContent("0–0");
    expect(readout("Record")).toHaveTextContent("0% won");
  });

  it("reads tier, Elo and winnings from the profile", async () => {
    db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (1, 'g1', 'u1', 'Yugi')").run();
    render(await DashboardPage());
    const standing = screen.getByRole("heading", { name: "Your standing" }).closest("section") as HTMLElement;
    within(standing).getByText("Silver");
    within(standing).getByText("1000");
    within(standing).getByRole("img", { name: /of \d+ Elo through Silver/ });
  });

  it("lists live tournaments and drafts first, open and running only, each with the purple edge", async () => {
    db.prepare(
      `insert into players (id, guild_id, discord_user_id, display_name) values (1, 'g1', 'u1', 'Yugi'), (2, 'g1', 'u2', 'Kaiba')`,
    ).run();
    const t = db.prepare(
      "insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug, created_at) values ('g1', ?, 'round_robin', ?, 'u1', ?, ?)",
    );
    t.run("Open Cup", "pending", "open-cup", "2026-10-02 10:00:00");
    t.run("Running Cup", "active", "running-cup", "2026-10-01 10:00:00");
    t.run("Old Cup", "completed", "old-cup", "2026-09-01 10:00:00");
    const tp = db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)");
    for (const id of [1, 2, 3]) {
      tp.run(id, 1);
      tp.run(id, 2);
    }

    render(await DashboardPage());

    const section = screen.getByRole("region", { name: "Your tournaments" });
    const rows = within(section).getAllByRole("link").filter((a) => a.classList.contains("db-row"));
    expect(rows.map((r) => r.querySelector(".nm")?.textContent)).toEqual(["Running Cup", "Open Cup"]);
    rows.forEach((r) => expect(r).toHaveAttribute("data-you"));
    expect(rows[0]).toHaveAttribute("href", "/tournament/running-cup");
    within(rows[0]).getByText("In progress");
    within(rows[1]).getByText("Open to join");
    expect(screen.getByText(/not in a draft right now/i)).toBeInTheDocument();
  });
});
