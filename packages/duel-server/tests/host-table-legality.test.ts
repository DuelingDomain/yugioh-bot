import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import type { DuelDeck, DuelFormat, DuelMode } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { MULTIPLAYER_FORBIDDEN } from "../src/banlists/multiplayer.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

// The host must check a deck against the real table format. Before this, every check used the 1v1 list,
// so alt-win cards and the FFA turn-count cards were accepted at a real FFA or Tag table.

const SECRET = "table-legality-secret";
const DESTINY_BOARD = 94212438; // alt-win: forbidden at ffa3, ffa4 and tag
const SWORDS = 72302403; // legal at every table (owner 2026-10-02 night)
const DARK_MAGICIAN = 46986414; // a legal Deck Master for the Domain tests
const NO_BANLIST = { banlist: "none" };

const hosts: DuelHost[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
});

/** Legal filler cards: Spells and Traps that are not on the multiplayer list. */
function fillers(count: number): number[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const skip = new Set(MULTIPLAYER_FORBIDDEN.map((entry) => entry.code));
    const rows = db
      .prepare(
        `SELECT datas.id FROM datas JOIN texts USING (id)
         WHERE type & 2 != 0 AND type & 1 = 0 AND type & 16384 = 0
           AND (ot & 3) != 0 AND alias = 0
           AND desc NOT LIKE '%always treated as%'
         ORDER BY datas.id`,
      )
      .all() as Array<{ id: number }>;
    return rows.map((row) => row.id).filter((id) => !skip.has(id)).slice(0, count);
  } finally {
    db.close();
  }
}

function deckWith(mode: DuelMode, ...cards: number[]): DuelDeck {
  const size = mode === "domain" ? 60 : 40;
  const deck: DuelDeck = { main: [...cards, ...fillers(size).slice(0, size - cards.length)], extra: [], side: [] };
  // Domain needs a Deck Master, so the forbidden card is the only reason to refuse the deck.
  if (mode === "domain") deck.deckMaster = DARK_MAGICIAN;
  return deck;
}

function room(format: DuelFormat, mode: DuelMode = "normal") {
  const db = new Database(":memory:");
  migrate(db);
  const player = seedIdentity(db, { guildId: "g1", name: "P0", userId: seedUser(db, "u0").userId, discordUserId: seedUser(db, "u0").discordUserId ?? "u0" }).playerId;
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: player, name: "Duel", mode, format, settings: NO_BANLIST });
  const host = createDuelHost({
    db,
    dataDirectory: DATA,
    secret: SECRET,
    searchCards: () => [],
    pollIntervalMs: 60_000,
    createWorker: () => {
      throw new Error("No duel should start in these tests");
    },
  });
  hosts.push(host);
  const who = { slug: session.slug, guildId: "g1", playerId: player };
  const post = async (body: Record<string, unknown>) => {
    const raw = JSON.stringify({ ...who, ...body });
    const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
    const response = await host.handle(new Request("http://localhost/internal/duel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-announce-signature": signature },
      body: raw,
    }));
    return { status: response.status, data: (await response.json()) as Record<string, any> };
  };
  return { db, duels, post, who };
}

const FORBIDDEN_AT_TABLE = /is forbidden in /;

describe("host deck check uses the real table format", () => {
  it.each(["ffa3", "ffa4", "tag"] as const)("refuses an alt-win card (Destiny Board) at %s", async (format) => {
    const t = room(format);
    const result = await t.post({ op: "deck", deck: deckWith("normal", DESTINY_BOARD) });
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/^Destiny Board is forbidden in /);
    // The refused deck is not saved.
    expect(t.duels.get(t.who.slug, "g1").seats[0]!.ready).toBe(false);
  });

  it.each(["ffa3", "ffa4"] as const)("accepts Swords of Revealing Light at %s", async (format) => {
    const t = room(format);
    const result = await t.post({ op: "deck", deck: deckWith("normal", SWORDS) });
    expect(result.status).toBe(200);
    expect(t.duels.get(t.who.slug, "g1").seats[0]!.ready).toBe(true);
  });

  it("accepts Swords of Revealing Light at Tag (the list names only the FFA tables)", async () => {
    const t = room("tag");
    const result = await t.post({ op: "deck", deck: deckWith("normal", SWORDS) });
    expect(result.status).toBe(200);
    expect(t.duels.get(t.who.slug, "g1").seats[0]!.ready).toBe(true);
  });

  it("accepts Destiny Board and Swords of Revealing Light in 1v1", async () => {
    const t = room("1v1");
    expect((await t.post({ op: "deck", deck: deckWith("normal", DESTINY_BOARD, SWORDS) })).status).toBe(200);
    expect(t.duels.get(t.who.slug, "g1").seats[0]!.ready).toBe(true);
  });

  it("accepts an ordinary deck at every table", async () => {
    for (const format of ["1v1", "tag", "ffa3", "ffa4"] as const) {
      const t = room(format);
      expect((await t.post({ op: "deck", deck: deckWith("normal") })).status, format).toBe(200);
    }
  });

  it("the validate-deck check answers the same issues as the deck op", async () => {
    const ffa = room("ffa4");
    const refused = await ffa.post({ op: "validate-deck", deck: deckWith("normal", DESTINY_BOARD) });
    expect(refused.status).toBe(200);
    expect(refused.data.issues.map((issue: { message: string }) => issue.message)).toEqual([expect.stringMatching(/^Destiny Board is forbidden in 4-player/)]);
    const duel = room("1v1");
    const accepted = await duel.post({ op: "validate-deck", deck: deckWith("normal", DESTINY_BOARD) });
    expect(accepted.data.issues).toEqual([]);
  });

  it("start refuses a saved deck that the table does not allow", async () => {
    // A deck saved by another path (old row, direct service call) must still be checked when the duel starts.
    const t = room("ffa3");
    t.duels.setDeck(t.who.slug, "g1", t.who.playerId, deckWith("normal", DESTINY_BOARD));
    // Fill the other two seats with legal practice bots through the host (their decks are checked as well).
    expect((await t.post({ op: "add-bot", seat: 1 })).status).toBe(200);
    expect((await t.post({ op: "add-bot", seat: 2 })).status).toBe(200);
    expect(t.duels.get(t.who.slug, "g1").seats[0]!.ready).toBe(true);
    const started = await t.post({ op: "start" });
    expect(started.status).toBe(400);
    expect(started.data.error).toMatch(/^Destiny Board is forbidden in 3-player/);
    expect(t.duels.get(t.who.slug, "g1").status).toBe("lobby");
  });

  it("keeps the practice bot deck legal at every table", async () => {
    for (const format of ["ffa4", "tag", "1v1"] as const) {
      const t = room(format);
      expect((await t.post({ op: "add-bot" })).status, format).toBe(200);
    }
  });

  describe("Domain Format", () => {
    it.each(["ffa4", "tag"] as const)("refuses a forbidden card in a Domain deck at %s", async (format) => {
      const t = room(format, "domain");
      const result = await t.post({ op: "validate-deck", deck: deckWith("domain", DESTINY_BOARD) });
      expect(result.status).toBe(200);
      expect(result.data.issues.some((issue: { message: string }) => FORBIDDEN_AT_TABLE.test(issue.message))).toBe(true);
      const saved = await t.post({ op: "deck", deck: deckWith("domain", DESTINY_BOARD) });
      expect(saved.status).toBe(400);
      expect(saved.data.error).toMatch(/^Destiny Board is forbidden in /);
    });

    it("accepts a Domain deck with a forbidden card in 1v1", async () => {
      const t = room("1v1", "domain");
      const result = await t.post({ op: "validate-deck", deck: deckWith("domain", DESTINY_BOARD) });
      expect(result.data.issues).toEqual([]);
      expect((await t.post({ op: "deck", deck: deckWith("domain", DESTINY_BOARD) })).status).toBe(200);
    });
  });
});
