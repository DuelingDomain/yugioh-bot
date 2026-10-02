// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../../shared/src/db/schema";
import DashboardPage from "../../app/(app)/dashboard/page";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));

describe("DashboardPage match stats", () => {
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

  it("shows approved wins and losses across guilds, excluding pending, denied and unrelated matches", async () => {
    db.prepare(
      `insert into players (id, guild_id, discord_user_id, display_name) values
       (1, 'g1', 'u1', 'Yugi'),
       (2, 'g1', 'u2', 'Kaiba'),
       (3, 'g1', 'u3', 'Joey'),
       (4, 'g2', 'u1', 'Yugi'),
       (5, 'g2', 'u2', 'Kaiba')`,
    ).run();
    db.prepare(
      `insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values
       ('g1', 1, 2, 1, 1, 'approved', 'casual'),
       ('g2', 5, 4, 4, 4, 'approved', 'casual'),
       ('g1', 2, 1, 2, 2, 'approved', 'casual'),
       ('g1', 1, 2, 1, 1, 'pending', 'casual'),
       ('g1', 1, 2, 2, 2, 'pending', 'casual'),
       ('g1', 1, 2, 1, 1, 'denied', 'casual'),
       ('g1', 1, 2, 2, 2, 'denied', 'casual'),
       ('g1', 2, 3, 2, 2, 'approved', 'casual')`,
    ).run();

    render(await DashboardPage());

    expect(screen.getByText("Wins").parentElement?.nextElementSibling).toHaveTextContent(/^2$/);
    expect(screen.getByText("Losses").parentElement?.nextElementSibling).toHaveTextContent(/^1$/);
    expect(screen.getByText("Matches").parentElement?.nextElementSibling).toHaveTextContent(/^3$/);
    expect(screen.getByText("Win Rate").parentElement?.nextElementSibling).toHaveTextContent(/^67%$/);
  });

  it("shows zero stats when the player has no matches", async () => {
    db.prepare(
      "insert into players (guild_id, discord_user_id, display_name) values ('g1', 'u1', 'Yugi')",
    ).run();

    render(await DashboardPage());

    expect(screen.getByText("Wins").parentElement?.nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText("Losses").parentElement?.nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText("Matches").parentElement?.nextElementSibling).toHaveTextContent(/^0$/);
    expect(screen.getByText("Win Rate").parentElement?.nextElementSibling).toHaveTextContent(/^0%$/);
  });
});
