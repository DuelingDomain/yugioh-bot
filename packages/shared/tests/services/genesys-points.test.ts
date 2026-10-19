import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createGenesysPointsReader, parseGenesysPointsResponse, parseGenesysPointsSnapshot, publishGenesysPointsSnapshot } from "../../src/services/genesys-points.js";
import { checkGenesysDeck } from "../../src/duels/genesys.js";

function sourceCard(id: number, points?: number) {
  return { id, name: `Card ${id}`, type: "Effect Monster", frameType: "effect",
    card_images: [{ id, image_url: `https://images.ygoprodeck.com/images/cards/${id}.jpg`, image_url_small: `https://images.ygoprodeck.com/images/cards_small/${id}.jpg` }],
    misc_info: [points === undefined ? {} : { genesys_points: points }] };
}

const official = JSON.parse(readFileSync(new URL("../fixtures/genesys-official-2026-10-05.json", import.meta.url), "utf8")) as Record<string, number>;
const officialNames = ["Albion the Branded Dragon", ...Object.keys(official).filter(name => name !== "Albion the Branded Dragon")];
function completeSnapshot() {
  return { data: Array.from({ length: 14_615 }, (_, i) => {
    const card = sourceCard(i + 1, i < officialNames.length ? official[officialNames[i]] : undefined);
    if (i < officialNames.length) card.name = officialNames[i];
    return card;
  }) };
}

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  let payload: unknown = completeSnapshot();
  let ok = true;
  const urls: string[] = [];
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async input => {
    urls.push(String(input));
    return { ok, status: ok ? 200 : 503, json: async () => payload };
  } });
  return { db, catalog, urls, payload: (value: unknown) => { payload = value; }, fail: () => { ok = false; } };
}

describe("Genesys points snapshots", () => {
  it("accepts missing points only within a complete misc response and hashes list contents consistently", () => {
    const payload = completeSnapshot();
    const first = parseGenesysPointsSnapshot(payload);
    expect(first.cards.find(card => card.id === 751)?.points).toBe(0);
    expect(first.revision).toMatch(/^tcg-sha256-[a-f0-9]{64}$/);
    expect(parseGenesysPointsSnapshot({ data: [...payload.data].reverse() }).revision).toBe(first.revision);
    payload.data[0].misc_info = [{ genesys_points: 7 }];
    expect(() => parseGenesysPointsSnapshot(payload)).toThrow(/unverified/);
    expect(() => parseGenesysPointsSnapshot(payload, { effectiveDate: "2027-01-01" })).toThrow(/unverified/);
    expect(parseGenesysPointsSnapshot(payload, { effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(payload).revision }).revision).not.toBe(first.revision);
  });

  it.each([
    ["empty", () => ({ data: [] })],
    ["partial", () => ({ data: [sourceCard(1)] })],
    ["paginated", () => ({ ...completeSnapshot(), meta: { next_page: "https://example.test/page2" } })],
    ["missing misc", () => { const p = completeSnapshot(); delete (p.data[0] as any).misc_info; return p; }],
    ["invalid points", () => { const p = completeSnapshot(); p.data[0].misc_info = [{ genesys_points: -1 }]; return p; }],
    ["null points", () => { const p = completeSnapshot(); (p.data[0] as any).misc_info = [{ genesys_points: null }]; return p; }],
    ["duplicate identity", () => { const p = completeSnapshot(); p.data[1] = p.data[0]; return p; }],
    ["lost points column", () => ({ data: completeSnapshot().data.map(card => ({ ...card, misc_info: [{}] })) })],
  ])("rejects %s snapshots", (_label, payload) => {
    expect(() => parseGenesysPointsSnapshot(payload())).toThrow(/Genesys/);
  });

  it("rejects a lost nonzero field even when row and nonzero counts look healthy", () => {
    const payload = completeSnapshot();
    const expectedRevision = parseGenesysPointsSnapshot(payload).revision;
    payload.data[0].misc_info = [{}];
    expect(() => parseGenesysPointsSnapshot(payload)).toThrow(/unverified/);
    expect(() => parseGenesysPointsSnapshot(payload, { effectiveDate: "2026-10-05" })).toThrow(/unverified/);
    expect(() => parseGenesysPointsSnapshot(payload, { effectiveDate: "2027-01-01", expectedRevision })).toThrow(/unverified/);
  });

  it("retains the official revision for zero-card and artwork additions", () => {
    const payload = completeSnapshot();
    const first = parseGenesysPointsSnapshot(payload);
    payload.data.push(sourceCard(30_002));
    payload.data[0].card_images.push({ ...payload.data[0].card_images[0], id: 30_003 });
    expect(parseGenesysPointsSnapshot(payload)).toMatchObject({ revision: first.revision, effectiveDate: "2026-10-05" });
  });

  it("rejects a response smaller than the last published source catalog", async () => {
    const { catalog, payload } = setup();
    const grown = completeSnapshot();
    grown.data.push(sourceCard(30_004));
    payload(grown);
    const first = await catalog.syncGenesysPoints();
    payload(completeSnapshot());
    await expect(catalog.syncGenesysPoints()).rejects.toThrow(/incomplete/);
    expect(first.effectiveDate).toBe("2026-10-05");
  });

  it("publishes an exactly verified new list with one fewer card, while unverified ticks keep the strict floor", async () => {
    const { db, catalog, payload } = setup();
    const first = await catalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 7 }];
    const expectedRevision = parseGenesysPointsResponse(changed).revision;
    changed.data.pop();
    payload(changed);
    await expect(catalog.syncGenesysPoints()).rejects.toThrow(/incomplete card list/);
    expect(() => parseGenesysPointsSnapshot(changed, { minimumCards: 1 })).toThrow(/incomplete card list/);
    expect(createGenesysPointsReader(db).list()).toEqual(first);
    await expect(catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: first.revision })).rejects.toThrow();
    const next = await catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision });
    expect(next).toMatchObject({ revision: expectedRevision, effectiveDate: "2027-01-01" });
    const reader = createGenesysPointsReader(db);
    expect(reader.cardCount()).toBe(14_614);
    expect(reader.points([1, 14_615])).toEqual(new Map([[1, 7], [14_615, null]]));
    await expect(catalog.syncGenesysPoints()).rejects.toThrow(/incomplete card list/);
  });

  it.each([73, 74])("limits verified shrinkage to 0.5 percent (%s missing cards)", missing => {
    const changed = completeSnapshot();
    const expectedRevision = parseGenesysPointsResponse(changed).revision;
    changed.data.splice(-missing);
    const parse = () => parseGenesysPointsSnapshot(changed, { expectedRevision });
    if (missing === 73) expect(parse().cards).toHaveLength(14_615 - missing);
    else expect(parse).toThrow(/incomplete card list/);
  });

  it("requires the exact revision again when publishing a smaller snapshot", async () => {
    const { db, catalog } = setup();
    const first = await catalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data.pop();
    const snapshot = parseGenesysPointsSnapshot(changed, { expectedRevision: first.revision });
    expect(() => publishGenesysPointsSnapshot(db, snapshot, { cacheCards: () => {}, canonicalId: code => code }))
      .toThrow(/incomplete card list/);
    expect(createGenesysPointsReader(db).list()).toEqual(first);
  });

  it("rechecks the shrink allowance against a concurrently published larger catalog", async () => {
    const { db, catalog, payload } = setup();
    await catalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 7 }];
    const expectedRevision = parseGenesysPointsResponse(changed).revision;
    changed.data.pop();
    let release!: () => void;
    const delayedCatalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return { ok: true, status: 200, json: async () => changed };
    } });
    const pending = delayedCatalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision });
    const grown = completeSnapshot();
    grown.data.push(...Array.from({ length: 100 }, (_, index) => sourceCard(30_100 + index)));
    payload(grown);
    const latest = await catalog.syncGenesysPoints();
    release();
    await expect(pending).rejects.toThrow(/incomplete card list/);
    expect(createGenesysPointsReader(db).list()).toEqual(latest);
    expect(createGenesysPointsReader(db).cardCount()).toBe(14_715);
  });

  it("remembers an explicitly verified later list and refuses another mapping at the same date", async () => {
    const { db, catalog, payload } = setup();
    await catalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 7 }];
    payload(changed);
    await expect(catalog.syncGenesysPoints()).rejects.toThrow(/unverified/);
    const next = await catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision });
    expect(await catalog.syncGenesysPoints()).toMatchObject({ revision: next.revision, effectiveDate: "2027-01-01" });
    await expect(catalog.syncGenesysPoints({ effectiveDate: "2026-10-05" })).rejects.toThrow(/unverified/);
    changed.data[0].misc_info = [{}];
    await expect(catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision })).rejects.toThrow(/unverified/);
    expect(createGenesysPointsReader(db).points([1]).get(1)).toBe(7);
    payload(completeSnapshot());
    await expect(catalog.syncGenesysPoints()).rejects.toThrow(/unverified/);
  }, 30_000);

  it("does not roll back a newer list when an older concurrent fetch finishes late", async () => {
    const { db, catalog, payload } = setup();
    await catalog.syncGenesysPoints();
    let release!: () => void;
    const staleCatalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return { ok: true, status: 200, json: async () => completeSnapshot() };
    } });
    const stale = staleCatalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 7 }];
    payload(changed);
    const latest = await catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision });
    release();
    await expect(stale).rejects.toThrow(/unverified/);
    expect(createGenesysPointsReader(db).list()).toEqual(latest);
    expect(createGenesysPointsReader(db).points([1]).get(1)).toBe(7);
  });

  it("waits for an expected new revision when the source is still serving the previous list", async () => {
    const { db, catalog, payload } = setup();
    const original = await catalog.syncGenesysPoints();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 7 }];
    const approval = { effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision };
    await expect(catalog.syncGenesysPoints(approval)).rejects.toThrow(/unverified/);
    expect(createGenesysPointsReader(db).list()).toEqual(original);
    payload(changed);
    expect(await catalog.syncGenesysPoints(approval)).toMatchObject({ effectiveDate: approval.effectiveDate, revision: approval.expectedRevision });
  });

  it("publishes values, artwork points, revision and provenance together, including uncached cards", async () => {
    const { db, catalog, urls, payload } = setup();
    const data = completeSnapshot();
    data.data[0].card_images.push({ ...data.data[0].card_images[0], id: 20_001 });
    payload(data);
    const before = Date.now();
    const list = await catalog.syncGenesysPoints();
    expect(urls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes"]);
    expect(list.effectiveDate).toBe("2026-10-05");
    expect(Date.parse(list.syncedAt)).toBeGreaterThanOrEqual(before);
    const reader = createGenesysPointsReader(db);
    expect(reader.list()).toEqual(list);
    expect(reader.points([1, 751, 20_001, 30_001])).toEqual(new Map([[1, 5], [751, 0], [20_001, 5], [30_001, null]]));
    expect(catalog.findByIds([20_001])[0]).toMatchObject({ genesysPoints: 5, genesysRevision: list.revision });
    expect(db.prepare("select count(*) as n from card_catalog where genesys_revision = ?").get(list.revision)).toEqual({ n: 14_616 });
  });

  it("keeps the last successful snapshot on fetch, partial-data and database failures", async () => {
    const { db, catalog, payload, fail } = setup();
    const list = await catalog.syncGenesysPoints();
    payload({ data: [sourceCard(1)] });
    await expect(catalog.syncGenesysPoints()).rejects.toThrow();
    const changed = completeSnapshot();
    changed.data[0].misc_info = [{ genesys_points: 9 }];
    payload(changed);
    db.exec("create trigger reject_genesys_meta before update on genesys_points_meta begin select raise(abort, 'test rollback'); end");
    await expect(catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision })).rejects.toThrow("test rollback");
    fail();
    await expect(catalog.syncGenesysPoints()).rejects.toThrow();
    const reader = createGenesysPointsReader(db);
    expect(reader.list()).toEqual(list);
    expect(reader.points([1])).toEqual(new Map([[1, 5]]));
  });

  it("invalidates absent cards and stale revisions without guessing zero, and refreshes long-lived readers", async () => {
    const { db, catalog, payload } = setup();
    const reader = createGenesysPointsReader(db);
    expect(reader.points([1]).get(1)).toBeNull();
    await catalog.syncGenesysPoints();
    expect(reader.points([1]).get(1)).toBe(5);
    const changed = completeSnapshot();
    changed.data[0] = sourceCard(20_002, 7);
    payload(changed);
    await catalog.syncGenesysPoints({ effectiveDate: "2027-01-01", expectedRevision: parseGenesysPointsResponse(changed).revision });
    expect(reader.points([1, 20_002])).toEqual(new Map([[1, null], [20_002, 7]]));
    db.prepare("update card_catalog set genesys_revision = 'old-list' where ygoprodeck_id = 2").run();
    expect(reader.points([2]).get(2)).toBeNull();
    expect(catalog.findByIds([2])[0].genesysPoints).toBeNull();
  });

  it("preserves points on ordinary card refreshes and resolves engine-only artworks by canonical identity", async () => {
    const { db, catalog, payload } = setup();
    const list = await catalog.syncGenesysPoints();
    payload({ data: [sourceCard(1)] });
    await catalog.syncByArchetype("Test");
    expect(catalog.findByIds([1])[0]).toMatchObject({ genesysPoints: 5, genesysRevision: list.revision });
    const identity = new Map([[1, { name: "Card 1", type: 33 }], [30_001, { name: "Card 1", type: 33, alias: 1 }]]);
    expect(createGenesysPointsReader(db).points([30_001], identity).get(30_001)).toBe(5);
  });

  it("supplies current points to an engine identity catalog for authoritative deck admission", async () => {
    const { db, catalog } = setup();
    const engineCards = new Map([
      [1, { name: "Card 1", type: 33 }],
      [30_001, { name: "Card 1", type: 33, alias: 1 }],
      [751, { name: "Card 751", type: 33 }],
    ]);
    const reader = createGenesysPointsReader(db);
    const deck = { main: [1, 30_001, 751], extra: [], side: [] };
    expect(checkGenesysDeck(deck, reader.attach(engineCards), { pointCap: 10 }).valid).toBe(false);
    await catalog.syncGenesysPoints();
    expect(checkGenesysDeck(deck, reader.attach(engineCards), { pointCap: 10 })).toMatchObject({ valid: true, totalPoints: 10 });
    expect(checkGenesysDeck(deck, reader.attach(engineCards), { pointCap: 9 })).toMatchObject({ valid: false, totalPoints: 10 });
    db.prepare("update card_catalog set genesys_revision = 'stale' where ygoprodeck_id = 1").run();
    expect(checkGenesysDeck(deck, reader.attach(engineCards), { pointCap: 10 })).toMatchObject({ valid: false, totalPoints: null });
  });
});
