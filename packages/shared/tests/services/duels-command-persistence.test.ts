import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/index.js";
import type { DuelCommand, DuelDeck } from "../../src/duels/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";

const deck = (start: number): DuelDeck => ({
  main: Array.from({ length: 40 }, (_, index) => start + index), extra: [start + 100], side: [start + 200],
});
const player = (db: ReturnType<typeof openDatabase>, discordUserId: string, name: string) =>
  seedIdentity(db, { guildId: "g", name, userId: seedUser(db, discordUserId).userId, discordUserId }).playerId;

// Production regression: `SqliteError: database is locked` on a player's answer. A deferred transaction reads, then
// writes. In WAL mode a commit from another process between the two makes the write fail at once with
// SQLITE_BUSY_SNAPSHOT, and busy_timeout is not honoured. The answer must wait for the writer slot instead.
it("journals an answer while another connection tries to commit between its read and its write", () => {
  const directory = mkdtempSync(join(tmpdir(), "duel-command-lock-"));
  const path = join(directory, "bot.sqlite");
  const db = openDatabase(path);
  const other = openDatabase(path);
  try {
    const p1 = player(db, "u1", "Yugi");
    const p2 = player(db, "u2", "Kaiba");
    const duels = createDuelService(db);
    const { slug } = duels.create({ guildId: "g", organizerPlayerId: p1, name: "Duel", mode: "normal" });
    duels.takeSeat(slug, "g", p2);
    duels.setDeck(slug, "g", p1, deck(1));
    duels.setDeck(slug, "g", p2, deck(1000));
    duels.activate(slug, "g", p1, ["seed"], "bundle", null);

    // JSON.stringify(command) runs after the transaction's reads and before its first write. A second process
    // commits there; with the lock already held it must fail fast instead of slipping in.
    other.pragma("busy_timeout = 0");
    let otherCommitted = false;
    let otherError: unknown = null;
    const command = {
      promptId: "p", revision: 1, answer: { choice: "a" },
      toJSON() {
        try { other.prepare("insert into duel_host_heartbeat (id, last_tick_at) values (1, 1) on conflict(id) do update set last_tick_at = last_tick_at + 1").run(); otherCommitted = true; }
        catch (error) { otherError = error; } // The writer slot is held by the answer, as intended.
        return { promptId: "p", revision: 1, answer: { choice: "a" } };
      },
    } as unknown as DuelCommand;

    duels.recordCommand(slug, "g", 0, command, null);
    expect(otherCommitted).toBe(false);
    // The competing commit must have been refused for being busy, not for some unrelated error.
    expect((otherError as { code?: string } | null)?.code).toMatch(/^SQLITE_BUSY/);
    expect(duels.privateState(slug, "g").commands.map(entry => entry.command.promptId)).toEqual(["p"]);
  } finally {
    other.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
