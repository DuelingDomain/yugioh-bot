// @vitest-environment jsdom
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../shared/src/db/schema";
import { findRejoinDrafts } from "@/lib/rejoin-drafts";
import DashboardPage from "../app/(app)/dashboard/page";
import DraftsPage from "../app/(app)/drafts/page";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g1" } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

// A player who is in a lobby or a live draft gets a way back into it from the Dashboard and the Drafts page.

describe("rejoin draft call to action", () => {
  let db: Database.Database;
  let me: number;
  let n = 0;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedFixtureUsers(db, FIXTURE_KEYS);
    getDb.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u1")), discordUserId: fixtureDiscordId("u1"), name: "Yugi" } });
    me = Number(db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u1")}, '${fixtureDiscordId("u1")}', 'Yugi')`).run().lastInsertRowid);
  });

  afterEach(() => {
    cleanup();
    db.close();
    vi.clearAllMocks();
  });

  function draft(name: string, status: string, o: { slug?: string | null; guild?: string; joined?: boolean; player?: number } = {}) {
    n += 1;
    const id = Number(
      db
        .prepare(
          `insert into drafts (guild_id, channel_id, created_by_user_id, name, status, web_slug, config_json) values (?, 'c', ${fixtureUserId("u2")}, ?, ?, ?, '{}')`,
        )
        .run(o.guild ?? "g1", name, status, o.slug === undefined ? `slug-${n}` : o.slug).lastInsertRowid,
    );
    if (o.joined !== false) db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(id, o.player ?? me);
    return id;
  }

  describe("findRejoinDrafts", () => {
    it("lists lobby and active drafts the user is in, live ones first", () => {
      draft("Lobby", "pending", { slug: "lobby" });
      draft("Live", "active", { slug: "live" });
      expect(findRejoinDrafts(db, "g1", fixtureUserId("u1"))).toEqual([
        { slug: "live", name: "Live", status: "active" },
        { slug: "lobby", name: "Lobby", status: "pending" },
      ]);
    });

    it("leaves out finished, cancelled, other-guild, not-joined and address-less drafts", () => {
      draft("Done", "completed");
      draft("Cancelled", "cancelled");
      draft("Other guild", "active", { guild: "g2" });
      draft("Not mine", "active", { joined: false });
      draft("No address", "active", { slug: null });
      const other = Number(db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u9")}, '${fixtureDiscordId("u9")}', 'Kaiba')`).run().lastInsertRowid);
      draft("Someone else", "active", { player: other });
      expect(findRejoinDrafts(db, "g1", fixtureUserId("u1"))).toEqual([]);
    });

    it("does not match a player row of the same Discord user in another guild", () => {
      const abroad = Number(db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g2', ${fixtureUserId("u1")}, '${fixtureDiscordId("u1")}', 'Yugi')`).run().lastInsertRowid);
      draft("Abroad", "active", { guild: "g2", player: abroad });
      expect(findRejoinDrafts(db, "g1", fixtureUserId("u1"))).toEqual([]);
    });
  });

  describe.each([
    ["the Dashboard", () => DashboardPage()],
    ["the Drafts page", () => DraftsPage()],
  ])("on %s", (_label, load) => {
    it("shows Rejoin draft for a live draft, linking to it", async () => {
      draft("Friday cube", "active", { slug: "friday-cube" });
      render(await load());
      const link = screen.getByRole("link", { name: "Rejoin draft" });
      expect(link).toHaveAttribute("href", "/draft/friday-cube");
      expect(link).toHaveClass("sv-btn", "primary");
      expect(screen.getByText("Your draft is live")).toBeInTheDocument();
    });

    it("shows Back to your draft for a lobby", async () => {
      draft("Friday cube", "pending", { slug: "friday-cube" });
      render(await load());
      expect(screen.getByRole("link", { name: "Back to your draft" })).toHaveAttribute("href", "/draft/friday-cube");
    });

    it("shows nothing when the only draft is finished", async () => {
      draft("Old cube", "completed", { slug: "old-cube" });
      render(await load());
      expect(screen.queryByRole("link", { name: /Rejoin draft|Back to your draft/ })).toBeNull();
      expect(screen.queryByRole("region", { name: "Your draft" })).toBeNull();
    });
  });
});

const FIXTURE_KEYS = ["u1", "u2", "u9"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
