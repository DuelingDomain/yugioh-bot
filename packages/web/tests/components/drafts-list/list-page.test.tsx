// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../../../shared/src/db/schema";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g1" } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import DraftsPage from "../../../app/(app)/drafts/page";

describe("DraftsPage", () => {
  let db: Database.Database;
  let playerId: number;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    getDb.mockReturnValue(db);
    auth.mockResolvedValue({ user: { id: "u1" } });
    playerId = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1','u1','Me')").run().lastInsertRowid);
  });
  afterEach(() => {
    cleanup();
    db.close();
    vi.clearAllMocks();
  });

  let n = 0;
  function add(name: string, status: string, o: { createdAt?: string; endedAt?: string | null; slug?: string | null; config?: object; wave?: number; pick?: number; players?: number; guild?: string; joined?: boolean } = {}) {
    n += 1;
    const id = Number(
      db
        .prepare(
          "insert into drafts (guild_id, channel_id, created_by_user_id, name, status, web_slug, config_json, current_wave_number, current_pick_step, created_at, ended_at) values (?,'c','u1',?,?,?,?,?,?,?,?)",
        )
        .run(o.guild ?? "g1", name, status, o.slug === undefined ? `s${n}` : o.slug, JSON.stringify(o.config ?? {}), o.wave ?? 0, o.pick ?? 0, o.createdAt ?? "2026-09-01 00:00:00", o.endedAt ?? null)
        .lastInsertRowid,
    );
    if (o.joined !== false) db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(id, playerId);
    for (let i = 1; i < (o.players ?? 1); i++) {
      const pid = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)").run(`x${n}-${i}`, `P${i}`).lastInsertRowid);
      db.prepare("insert into draft_players (draft_id, player_id) values (?, ?)").run(id, pid);
    }
    return id;
  }

  it("shows the empty state naming /draft create", async () => {
    render(await DraftsPage());
    expect(screen.getByRole("heading", { name: "No drafts yet" })).toBeTruthy();
    expect(screen.getByText("/draft create")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /new draft/i }).map((a) => a.getAttribute("href"))).toEqual(["/drafts/new", "/drafts/new"]);
  });

  it("lists only joined drafts in this guild, in live, waiting, finished order", async () => {
    add("Live cube", "active", { slug: "live", wave: 2, pick: 4, players: 6, config: { packsPerPlayer: 3, pickSeconds: 45 } });
    add("Waiting theme", "pending", { slug: "wait", players: 1, config: { mode: "theme" }, createdAt: "2026-10-01 10:00:00" });
    add("Not joined", "active", { joined: false });
    add("Elsewhere", "active", { guild: "g2" });
    add("Done", "completed", { endedAt: "2026-09-28T12:00:00.000Z" });
    add("Gone", "cancelled", { createdAt: "2026-09-29 00:00:00" });
    render(await DraftsPage());

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Live now", "Waiting to start", "Finished"]);
    expect(document.querySelector(".page-sub")?.textContent).toBe("Drafts you're in1 live1 waiting to start2 finished");

    const live = within(screen.getByRole("region", { name: "Live now" })).getByRole("link");
    expect(live.getAttribute("href")).toBe("/draft/live");
    expect(live.textContent).toContain("Cube draft");
    expect(live.textContent).toContain("6 players");
    expect(live.textContent).toContain("45 s a pick");
    expect(live.textContent).toContain("Pack 2 of 3");
    expect(live.textContent).toContain("pick 4");
    expect(live.textContent).toContain("Open draft room");

    const wait = within(screen.getByRole("region", { name: "Waiting to start" })).getByRole("link");
    expect(wait.getAttribute("href")).toBe("/draft/wait");
    expect(wait.textContent).toContain("Theme draft");
    expect(wait.textContent).toContain("Created Thu, Oct 1");
    expect(within(wait).getByLabelText("1 player joined")).toBeTruthy();
    expect(wait.textContent).not.toContain("Hosting");

    const fin = within(screen.getByRole("region", { name: "Finished" }));
    const rows = fin.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["Gone", "Done"]);
    expect(within(rows[0]).getByText("Cancelled").className).toContain("early");
    expect(within(rows[1]).getByText("Sep 28")).toBeTruthy();
    expect(document.body.textContent).not.toContain("→");
    expect(document.body.textContent).not.toMatch(/\b1 players\b/);
  });

  it("caps the ledger at ten rows with Show all N", async () => {
    for (let i = 0; i < 12; i++) add(`F${i}`, "completed", { endedAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` });
    render(await DraftsPage());
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBe(1 + 10 + 1);
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(within(table).getAllByRole("row").length).toBe(1 + 12);
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
  });

  it("theme draft live row counts rounds and shows the Extra deck stop", async () => {
    add("Mirror", "active", { slug: "m", wave: 41, players: 2, config: { mode: "theme", cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15 } });
    render(await DraftsPage());
    const row = screen.getByRole("link", { name: /Mirror/ });
    expect(row.textContent).toContain("Theme draft");
    expect(row.textContent).toContain("Round 41 of 55");
    expect(row.textContent).toContain("Extra deck");
  });
});
