import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
import { guildId, players } from "../stack/env.mjs";
import { seedDatabase } from "../stack/seed.mjs";

test("manual seed gives each player owned Standard and Domain saved decks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-manual-seed-"));
  const databasePath = join(dir, "test.sqlite");
  const standard = { name: "Manual Standard", mode: "normal", deck: { main: [69247929], extra: [], side: [] } };
  const domain = { name: "Manual Domain", mode: "domain", deck: { main: [4148264], extra: [], side: [], deckMaster: 48305365 } };
  try {
    await seedDatabase({ databasePath, savedDecks: [standard, domain] });
    const db = openDatabase(databasePath);
    try {
      assert.equal((db.prepare("select count(*) as n from players").get() as { n: number }).n, 4);
      assert.equal((db.prepare("select count(*) as n from saved_decks").get() as { n: number }).n, 8);
      const service = createSavedDeckService(db);
      const ids = new Set<number>();
      for (const player of players) {
        const decks = service.list(guildId, player.discordId);
        assert.equal(decks.length, 2);
        assert.deepEqual(decks.find((deck) => deck.mode === "normal")?.deck, standard.deck);
        assert.deepEqual(decks.find((deck) => deck.mode === "domain")?.deck, domain.deck);
        for (const deck of decks) ids.add(deck.id);
      }
      assert.equal(ids.size, 8, "every player owns separate saved decks");
      assert.deepEqual(service.list(guildId, "someone-else"), []);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ordinary e2e seed keeps saved decks empty and resets only its database", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-normal-seed-"));
  const databasePath = join(dir, "test.sqlite");
  try {
    await seedDatabase({ databasePath });
    const db = openDatabase(databasePath);
    try {
      assert.equal((db.prepare("select count(*) as n from players").get() as { n: number }).n, 4);
      assert.equal((db.prepare("select count(*) as n from saved_decks").get() as { n: number }).n, 0);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
