// @vitest-environment jsdom
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { fixtureDiscordId, fixtureUserId, seedFixtureUsers } from "./fixtures/identity";

const auth = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn(async () => {}) }));

let directory: string;
let db: Database.Database;
afterEach(async () => {
  cleanup();
  const { getDb } = await import("../src/lib/db");
  getDb().close();
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("creates a fixed-clock ranked table through the creator and real API after selecting unlimited casual time", async () => {
  directory = mkdtempSync(join(tmpdir(), "ranked-creator-"));
  vi.stubEnv("DATABASE_PATH", join(directory, "bot.sqlite"));
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("DISCORD_BOT_ENABLED", "0");
  db = new Database(join(directory, "bot.sqlite"));
  migrate(db);
  seedFixtureUsers(db, ["ranked-host"]);
  db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values ('g', ?, ?, 'Host')")
    .run(fixtureUserId("ranked-host"), fixtureDiscordId("ranked-host"));
  auth.mockResolvedValue({ user: { id: String(fixtureUserId("ranked-host")), name: "Host" } });
  const { POST, GET } = await import("../app/api/duels/route");
  const { NextRequest } = await import("next/server");
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const request = new NextRequest(new URL(input, "http://localhost"), init ? { ...init, signal: init.signal ?? undefined } : undefined);
    return init?.method === "POST" ? POST(request) : GET(request);
  }));
  const { DuelCreator } = await import("../src/components/duel/creator");
  render(<DuelCreator />);
  fireEvent.change(screen.getByLabelText("Turn timer"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Ranked/ }));
  expect(screen.queryByLabelText("Turn timer")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "When the timer runs out" })).not.toBeInTheDocument();
  expect(screen.getByText("Ranked clock: fixed 3-minute bank. Lose on timeout.")).toBeInTheDocument();
  expect(screen.getByText(/3 min bank · \+3 s per move · \+45 s each turn/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create game" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/duels\//)));
  const row = db.prepare("select ranked, settings_json from duels").get() as { ranked: number; settings_json: string };
  expect(row.ranked).toBe(1);
  expect(JSON.parse(row.settings_json)).toMatchObject({ turnSeconds: 180, timeout: "loss" });
});
