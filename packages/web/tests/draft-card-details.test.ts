import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDraftDeck } from "./helpers/draft-deck-fixture";

const tempDirs: string[] = [];

beforeEach(() => vi.resetModules());
afterEach(async () => {
  if (tempDirs.length) {
    const { getDb } = await import("../src/lib/db");
    getDb().close();
  }
  vi.unstubAllEnvs();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

async function setup(picks: number[]) {
  // Preserve the caller's environment when the fixture configures its temporary DB.
  vi.stubEnv("DATABASE_PATH", process.env.DATABASE_PATH);
  vi.stubEnv("DISCORD_GUILD_ID", process.env.DISCORD_GUILD_ID);
  const fixture = await seedDraftDeck({ picks });
  tempDirs.push(fixture.dir);
  return fixture;
}

describe("draft card details", () => {
  it("returns catalog passcodes for both copies while retaining distinct draft card ids", async () => {
    await setup([53183600, 46986414, 53183600]);
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");

    const response = await buildDraftResponse("slug-1", "drafter");

    expect(response?.myPool).toMatchObject([
      { id: 1, passcode: 53183600, name: "Card 53183600" },
      { id: 2, passcode: 46986414, name: "Card 46986414" },
      { id: 3, passcode: 53183600, name: "Card 53183600" },
    ]);
  });

  it("keeps details on the correct picks when a catalog card is missing", async () => {
    const fixture = await setup([46986414, 53183600, 46986414]);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(fixture.dir, "test.sqlite"));
    db.pragma("foreign_keys = OFF");
    db.prepare("delete from card_catalog where ygoprodeck_id = ?").run(46986414);
    db.close();
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");

    const response = await buildDraftResponse("slug-1", "drafter");

    expect(response?.myPool).toMatchObject([
      { id: 1, passcode: 46986414, name: "Card 46986414", type: "Unknown", imageUrl: "" },
      { id: 2, passcode: 53183600, name: "Card 53183600", type: "Fusion Monster", imageUrl: "u" },
      { id: 3, passcode: 46986414, name: "Card 46986414", type: "Unknown", imageUrl: "" },
    ]);
  });
  it("sends each card's archetype, or null when the catalog has none", async () => {
    const fixture = await setup([46986414, 53183600]);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(join(fixture.dir, "test.sqlite"));
    db.prepare("update card_catalog set archetype = 'Dark Magician' where ygoprodeck_id = ?").run(46986414);
    db.close();
    const { buildDraftResponse } = await import("../app/api/drafts/[slug]/helpers");

    const response = await buildDraftResponse("slug-1", "drafter");

    expect(response?.myPool).toMatchObject([
      { passcode: 46986414, archetype: "Dark Magician" },
      { passcode: 53183600, archetype: null },
    ]);
  });
});
