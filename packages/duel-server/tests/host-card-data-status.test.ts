import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelHost } from "../src/host.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "host-status-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test", sources: { database: "pin", databaseFiles: ["cards.cdb", "release-new.cdb"] } }));
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text); insert into datas values (10,0,1); insert into texts values (10,'Known')"); cdb.close();
  const db = new Database(":memory:"); migrate(db);
  return { dir, db };
}

it("serves global card status only on the signed channel with a guild actor, even when GitHub is down", async () => {
  const { dir, db } = setup();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  let now = Date.parse("2026-10-06T00:00:00Z");
  const host = createDuelHost({ db, dataDirectory: dir, secret: "secret", searchCards: () => [], pollIntervalMs: 60_000, now: () => now });
  // A bundle copied to disk later is not the manifest this running host loaded.
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "replacement", sources: {} }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const post = (body: object, signed = true) => {
    const raw = JSON.stringify(body);
    return host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: signed ? { "x-announce-signature": `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}` } : {} }));
  };
  try {
    expect((await post({ op: "engine-data-status", guildId: "g", playerId: 1 }, false)).status).toBe(401);
    expect((await post({ op: "engine-data-status" })).status).toBe(400);
    const res = await post({ op: "engine-data-status", guildId: "g", playerId: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      engine: { bundleVersion: "test", cardCount: 1, cdbFiles: ["cards.cdb", "release-new.cdb"] },
      catalog: { totalCards: 0, lastSuccessfulSyncAt: null },
      gap: { recentSetsMissingFromEngineCount: null, recentSets: [], cachedCatalogMissingCount: 0 },
      upstream: { sources: { database: { status: "unknown" } } },
      updateWorkflow: { lastRunStatus: "unknown", pullRequestStatus: "unknown" },
    });
    const calls = vi.mocked(fetch).mock.calls.length;
    expect((await post({ op: "engine-data-status", guildId: "g2", playerId: 2 })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(calls);
    now += 60_000;
    db.exec("drop table card_catalog");
    expect((await post({ op: "engine-data-status", guildId: "g", playerId: 1 })).status).toBe(503);
    expect(log).toHaveBeenCalledWith("[duel] engine-data-status", expect.any(Error));
  } finally { await host.close(); db.close(); log.mockRestore(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); }
});


it("closes the host in under one second while 50 sets and GitHub are pending", async () => {
  const { dir, db } = setup(); const signals: AbortSignal[] = [];
  const timestamp = "2026-10-06T00:00:00Z";
  const insert = db.prepare("insert into card_sets (set_name, synced_at, release_date) values (?, ?, ?)");
  for (let i = 0; i < 50; i++) insert.run(`Set ${i}`, timestamp, "2026-09-30");
  vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    signals.push(init!.signal!);
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  }));
  const host = createDuelHost({ db, dataDirectory: dir, secret: "secret", searchCards: () => [], pollIntervalMs: 60_000, now: () => Date.parse(timestamp) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = JSON.stringify({ op: "engine-data-status", guildId: "g", playerId: 1 });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}` } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ gap: { recentSetsMissingFromEngineCount: 0, recentSetsUnknownCount: 50 } });
    await vi.waitFor(() => expect(signals.length).toBe(6));
    const started = performance.now();
    await Promise.race([host.close(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Host close exceeded one second")), 1000);
    })]);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    db.close(); await new Promise(resolve => setTimeout(resolve, 250));
    expect(fetch).toHaveBeenCalledTimes(6);
  } finally {
    clearTimeout(timer); await host.close(); if (db.open) db.close();
    vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
  }
});
