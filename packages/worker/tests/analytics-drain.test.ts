import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { recordProductEvent } from "@yugidraft/shared/analytics";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { drainProductEvents } from "../src/analytics-drain.js";

let db: Database.Database;
const now = Date.UTC(2026, 9, 13, 12);
const configured = { key: "test-project-key", host: "https://eu.i.posthog.com", personalApiKey: "test-personal-key", projectId: "42" };
beforeEach(() => { db = new Database(":memory:"); migrate(db); db.prepare("insert into users(id,username,display_name) values(7,'member_7','Member')").run(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("delivers at most 100 events, with application IDs and anonymous events without profiles", async () => {
  db.transaction(() => {
    recordProductEvent(db, "waitlist_joined", null);
    for (let i = 0; i < 100; i++) recordProductEvent(db, "deck_saved", 7, { mode: "normal" });
  })();
  const delivered: any[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url !== "https://eu.i.posthog.com/batch/") return new Response(null, { status: 404 });
    const payload = JSON.parse(String(init.body));
    if (payload.api_key !== "test-project-key") return new Response(null, { status: 401 });
    delivered.push(...payload.batch);
    return Response.json({ status: 1 });
  });
  await drainProductEvents(db, configured);
  expect(delivered).toHaveLength(100);
  expect(delivered[0]).toMatchObject({ event: "waitlist_joined", timestamp: "2026-10-13T12:00:00.000Z", properties: { $process_person_profile: false } });
  expect(delivered[0].properties.distinct_id).toMatch(/^anonymous:[0-9a-f-]{36}$/);
  expect(delivered[1]).toMatchObject({ event: "deck_saved", properties: { distinct_id: "7", mode: "normal" } });
  expect(db.prepare("select count(*) as n from product_events where sent_at=?").get(now)).toEqual({ n: 100 });
  expect(db.prepare("select count(*) as n from product_events where sent_at is null").get()).toEqual({ n: 1 });
});

it("backs off failed delivery durably, preserves event identity on retry and stops after ten attempts", async () => {
  db.transaction(() => recordProductEvent(db, "waitlist_joined", null))();
  const { event_uuid } = db.prepare<[], { event_uuid: string }>("select event_uuid from product_events").get()!;
  const received: any[] = [];
  let acknowledged = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    received.push(JSON.parse(String(init.body)).batch[0]);
    if (!acknowledged) throw new TypeError("Response lost after acceptance");
    return new Response(null, { status: 200 });
  });
  await drainProductEvents(db, configured);
  await drainProductEvents(db, configured);
  expect(received).toHaveLength(1);
  expect(db.prepare("select attempts,sent_at from product_events").get()).toEqual({ attempts: 1, sent_at: null });
  vi.setSystemTime(now + 10_000); acknowledged = true;
  await drainProductEvents(db, configured);
  expect(received).toHaveLength(2);
  expect(received.map(event => ({ uuid: event.uuid, distinct_id: event.properties.distinct_id }))).toEqual([
    { uuid: event_uuid, distinct_id: `anonymous:${event_uuid}` },
    { uuid: event_uuid, distinct_id: `anonymous:${event_uuid}` },
  ]);
  db.exec("update product_events set sent_at=null,attempts=10");
  vi.setSystemTime(now + 30 * 86400_000 - 1);
  await drainProductEvents(db, configured);
  expect(received).toHaveLength(2);
});

it("prunes sent rows after seven days and abandoned rows after thirty, retaining younger rows", async () => {
  const insert = db.prepare("insert into product_events(name,props_json,occurred_at,sent_at,attempts,event_uuid) values('deck_saved','{}',?,?,?,?)");
  insert.run(now - 8 * 86400_000, now - 7 * 86400_000 - 1, 0, "old-sent");
  insert.run(now - 8 * 86400_000, now - 7 * 86400_000 + 1, 0, "young-sent");
  insert.run(now - 30 * 86400_000 - 1, null, 10, "old-unsent");
  insert.run(now - 30 * 86400_000 + 1, null, 10, "young-unsent");
  vi.stubGlobal("fetch", () => { throw new Error("No pending delivery"); });
  await drainProductEvents(db, configured);
  expect(db.prepare("select id from product_events order by id").all()).toEqual([{ id: 2 }, { id: 4 }]);
});

it("discards events and deletion jobs without any HTTP when the project key is empty", async () => {
  db.transaction(() => { recordProductEvent(db, "deck_saved", 7); recordProductEvent(db, "$delete_person", 7); })();
  vi.stubGlobal("fetch", () => { throw new Error("No HTTP in local mode"); });
  await drainProductEvents(db, { ...configured, key: "" });
  expect(db.prepare("select count(*) as n from product_events").get()).toEqual({ n: 0 });
});

it("deletes the matching person by distinct ID using only the persons API and worker credentials", async () => {
  db.transaction(() => recordProductEvent(db, "$delete_person", 7))();
  const persons = new Map([["person-7", "7"], ["person-8", "8"]]);
  let visible = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.headers && new Headers(init.headers).get("Authorization") !== "Bearer test-personal-key") return new Response(null, { status: 401 });
    if (url.pathname === "/api/projects/42/persons/" && url.searchParams.get("distinct_id") === "7") {
      return Response.json({ results: visible ? [{ id: "person-7", distinct_ids: ["7"] }] : [], next: null });
    }
    if (url.pathname === "/api/projects/42/persons/person-7/" && url.searchParams.get("delete_events") === "true" && init.method === "DELETE") {
      persons.delete("person-7"); return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  });
  await drainProductEvents(db, configured);
  expect(db.prepare("select sent_at,attempts from product_events").get()).toEqual({ sent_at: null, attempts: 1 });
  visible = true; vi.setSystemTime(now + 10_000);
  await drainProductEvents(db, configured);
  expect([...persons]).toEqual([["person-8", "8"]]);
  expect(db.prepare("select sent_at,attempts from product_events").get()).toEqual({ sent_at: now + 10_000, attempts: 1 });
});
