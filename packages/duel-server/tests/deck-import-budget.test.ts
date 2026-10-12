import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardLookupBudget } from "@yugidraft/shared/services";
import { normalizeCardCodes } from "../src/deck-import.js";
import { createDuelHost } from "../src/host.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";

let directory: string;
let db: Database.Database;
const unknown = Array.from({ length: 200 }, (_, i) => 90000000 + i);
beforeEach(() => {
  vi.useFakeTimers();
  directory = createHostDataFixture([{ code: 10, name: "Dragon" }, { code: 11, name: "Dragon", alias: 10 }]);
  db = new Database(":memory:");
  migrate(db);
});
afterEach(() => {
  db.close(); rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("import lookup budget", () => {
  it.each([false, true])("spends no more than 50 remote calls for 200 uncached ids (matches: %s)", async matches => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const id = Number(new URL(String(input)).searchParams.get("id"));
      return { ok: true, async json() { return { data: matches ? [{
        id, name: "Dragon", type: "Normal Monster", frameType: "normal",
        card_images: [{ id, image_url: "https://example.test/card.jpg", image_url_small: "https://example.test/small.jpg" }],
      }] : [] }; } };
    });
    const budget = createCardLookupBudget();
    const lookupLimitedCodes = new Set<number>();
    const pending = normalizeCardCodes([...unknown, 10, 11], directory, db, { fetch, lookupBudget: budget, lookupLimitedCodes });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(50);
    expect(budget.remaining).toBe(0);
    expect([...lookupLimitedCodes]).toEqual(unknown.slice(50));
    expect(result.get(unknown[0])).toBe(matches ? 10 : null);
    expect(result.get(unknown[50])).toBeNull();
    expect(result.get(10)).toBe(10);
    expect(result.get(11)).toBe(10);
  });

  it("resolves cached catalog names and engine artwork without spending a lookup", async () => {
    db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (99, 'Dragon', 'Normal Monster', 'normal', '', '', '[]', current_timestamp)").run();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }));
    const canonicalCodes = new Map<number, number | null>();
    const pending = normalizeCardCodes([99, 10, 11, unknown[0]], directory, db, { fetch, cacheOnly: true, preserveArtwork: true, canonicalCodes });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(new Map([[99, 10], [10, 10], [11, 11], [unknown[0], null]]));
    expect(canonicalCodes.get(11)).toBe(10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still resolves cards added to the cache after the last allowed lookup", async () => {
    const fetch = vi.fn(async () => {
      db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (?, 'Dragon', 'Normal Monster', 'normal', '', '', '[]', current_timestamp)").run(unknown[1]);
      return { ok: true, json: async () => ({ data: [] }) };
    });
    const budget = { remaining: 1, lookupLimited: false };
    const lookupLimitedCodes = new Set<number>();
    const pending = normalizeCardCodes(unknown.slice(0, 3), directory, db, { fetch, lookupBudget: budget, lookupLimitedCodes });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.get(unknown[1])).toBe(10);
    expect([...lookupLimitedCodes]).toEqual([unknown[2]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors the budget through the signed normalize-codes operation", async () => {
    const user = seedUser(db, "budget");
    const playerId = seedIdentity(db, { guildId: "g", userId: user.userId, discordUserId: user.discordUserId, name: "Budget" }).playerId;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const secret = "budget-test";
    const host = createDuelHost({ db, dataDirectory: directory, secret, searchCards: () => [] });
    const post = (fields: object) => {
      const body = JSON.stringify({ op: "normalize-codes", guildId: "g", playerId, ...fields });
      return host.handle(new Request("http://test/internal/duel", { method: "POST", body,
        headers: { "x-announce-signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` } }));
    };
    try {
      const pending = post({ codes: unknown, lookupLimit: 50, includeCanonical: true, preserveArtwork: true });
      await vi.advanceTimersByTimeAsync(45000);
      const response = await pending;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(fetch).toHaveBeenCalledTimes(50);
      expect(body.lookupRemaining).toBe(0);
      expect(body.lookupLimited).toEqual(unknown.slice(50));
      const cached = await post({ codes: [11, unknown[0]], cacheOnly: true, lookupLimit: 0, includeCanonical: true, preserveArtwork: true });
      expect(await cached.json()).toMatchObject({ codes: { 11: 11, [unknown[0]]: null }, canonicalCodes: { 11: 10, [unknown[0]]: null } });
      expect(fetch).toHaveBeenCalledTimes(50);
      for (const lookupLimit of [-1, 51, 0.5, "50"]) {
        expect((await post({ codes: [10], lookupLimit })).status).toBe(400);
      }
    } finally { await host.close(); }
  });
});
