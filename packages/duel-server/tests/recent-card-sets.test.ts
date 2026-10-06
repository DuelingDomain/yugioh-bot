import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createRecentCardSetCache, recentTcgSets } from "../src/recent-card-sets.js";
import { computeCardDataGap } from "../src/card-data-status.js";
const today = Date.parse("2026-10-06T00:00:00Z");
const sets = [
  { name: "Fresh & New", code: "NEW", releaseDate: "2026-09-30" },
  { name: "Older", code: "OLD", releaseDate: "2026-01-01" },
];
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database() { const db = new Database(":memory:"); migrate(db); databases.push(db); return db; }
function payload(set: string, id = 99) { return { data: [{ id, name: "Unrequested new card", type: "Normal Monster", frameType: "normal",
  card_images: [{ id }, { id: id + 1 }], card_sets: [{ set_name: set, set_code: `${set}-EN001` }], card_prices: [{ price: "huge unused payload" }] }] }; }

it("selects dated released TCG sets in the last 12 calendar months, including boundaries", () => {
  expect(recentTcgSets([...sets,
    { name: "Boundary", code: "B", releaseDate: "2025-10-06" },
    { name: "Too old", code: "O", releaseDate: "2025-10-05" },
    { name: "Future", code: "F", releaseDate: "2026-10-07" },
    { name: "Undated", code: "U", releaseDate: null },
    { name: "Invalid", code: "I", releaseDate: "2026-02-31" },
  ], today).map(s => s.name)).toEqual(["Fresh & New", "Older", "Boundary"]);
});

it("fetches set cards through the shared queue, caches compact per-set identities durably, and finds unrequested gaps", async () => {
  const db = database();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://db.ygoprodeck.com"); expect(url.pathname).toBe("/api/v7/cardinfo.php");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json(payload(url.searchParams.get("cardset")!));
  });
  const cache = createRecentCardSetCache(db, { fetch, now: () => today });
  expect(cache.read(sets).every(s => s.cards === null)).toBe(true);
  await cache.refresh(sets);
  expect(fetch).toHaveBeenCalledTimes(2);
  const recent = cache.read(sets);
  const gap = computeCardDataGap([], [], [], sets, recent);
  expect(gap.recentSetsMissingFromEngineCount).toBe(1); // same family across both sets
  expect(gap.recentSets).toEqual(sets.map(s => ({ ...s, status: "ok", checkedAt: new Date(today).toISOString(), total: 1,
    missingCount: 1, missingCards: [{ id: 99, name: "Unrequested new card", setCode: `${s.name}-EN001`, setReleaseDate: s.releaseDate }], idMismatch: [] })));
  expect(gap.cachedCatalogMissingCount).toBe(0);
  const stored = db.prepare("select cards_json from card_data_set_cache").all() as Array<{ cards_json: string }>;
  expect(stored.every(r => !r.cards_json.includes("card_prices") && !r.cards_json.includes("card_images"))).toBe(true);
  const restarted = createRecentCardSetCache(db, { fetch, now: () => today });
  expect(restarted.read(sets)).toEqual(recent);
  await restarted.refresh(sets); expect(fetch).toHaveBeenCalledTimes(2);
});

it("serves stale immediately, refreshes <=60-day sets daily, and never refetches immutable older sets", async () => {
  const db = database(); let now = today;
  let release: ((response: Response) => void) | undefined;
  let hang = false;
  const fetch = vi.fn(async (input: string | URL | Request) => hang ? new Promise<Response>(resolve => { release = resolve; }) : Response.json(payload(new URL(String(input)).searchParams.get("cardset")!)));
  const cache = createRecentCardSetCache(db, { fetch, now: () => now });
  await cache.refresh(sets); expect(fetch).toHaveBeenCalledTimes(2);
  now += 86_400_000 - 1; await cache.refresh(sets); expect(fetch).toHaveBeenCalledTimes(2);
  now++; hang = true;
  const stale = cache.read(sets);
  expect(stale[0].cards?.[0].id).toBe(99);
  const pending = cache.refresh(sets);
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(fetch).toHaveBeenCalledTimes(3);
  release!(Response.json(payload(sets[0].name, 101))); await pending;
  expect(cache.read(sets)[0].cards?.[0].id).toBe(101);
  now += 70 * 86_400_000; hang = false; await cache.refresh(sets); expect(fetch).toHaveBeenCalledTimes(3);
});

it("refreshes a set exactly 60 days old and isolates failures without treating unknown as an empty set", async () => {
  const db = database();
  const boundary = [{ name: "Boundary", code: "B", releaseDate: "2026-08-07" }];
  const fetch = vi.fn(async () => Response.json(payload("Boundary")));
  const cache = createRecentCardSetCache(db, { fetch, now: () => today });
  db.prepare("insert into card_data_set_cache values (?,?,?)").run("Boundary", "2026-10-04T00:00:00Z", "[]");
  await cache.refresh(boundary); expect(fetch).toHaveBeenCalledTimes(1);
  const failing = createRecentCardSetCache(db, { fetch: async () => new Response("offline", { status: 503 }), now: () => today });
  await failing.refresh(sets);
  const gap = computeCardDataGap([], [], [], sets, failing.read(sets));
  expect(gap.recentSetsMissingFromEngineCount).toBeNull();
  expect(gap.recentSets.every(s => s.status === "unknown" && s.total === null && s.missingCount === null)).toBe(true);
});

it("matches engine alias/API artwork families, excludes skills/tokens, and separates name/type ID mismatches", async () => {
  const db = database();
  const fetch = vi.fn(async () => Response.json({ data: [
    { id: 99, name: "Known", type: "Normal Monster", frameType: "normal", card_images: [{ id: 20 }] },
    { id: 88, name: " RENAMED ", type: "Normal Monster", frameType: "normal" },
    { id: 77, name: "Skill", type: "Skill Card", frame_type: "skill" },
    { id: 66, name: "Token", type: "Token", frameType: "token" },
    { id: 55, name: "Missing", type: "Normal Monster", frameType: "normal" },
  ] }));
  const cache = createRecentCardSetCache(db, { fetch, now: () => today }); await cache.refresh([sets[0]]);
  const gap = computeCardDataGap([
    { id: 10, alias: 0, name: "Known", type: 17 }, { id: 20, alias: 10, name: "Known", type: 17 },
    { id: 30, alias: 0, name: "Renamed", type: 17 },
  ], [], [], sets, cache.read([sets[0]]));
  expect(gap.recentSets[0]).toMatchObject({ total: 3, missingCount: 1, missingCards: [{ id: 55 }], idMismatch: [{ id: 88 }] });
});

it("retains successful stale cards after a refresh fails and backs off cold failures", async () => {
  const db = database(); let now = today;
  const fetch = vi.fn(async (input: string | URL | Request) => Response.json(payload(new URL(String(input)).searchParams.get("cardset")!)));
  const cache = createRecentCardSetCache(db, { fetch, now: () => now });
  await cache.refresh([sets[0]]);
  const before = cache.read([sets[0]])[0];
  now += 86_400_000;
  fetch.mockImplementation(async () => new Response("offline", { status: 503 }));
  await cache.refresh(sets);
  expect(cache.read([sets[0]])[0]).toEqual(before);
  const requests = fetch.mock.calls.length;
  now += 299_999; await cache.refresh(sets); expect(fetch).toHaveBeenCalledTimes(requests);
  now++; await cache.refresh(sets); expect(fetch).toHaveBeenCalledTimes(requests + 2);
});
