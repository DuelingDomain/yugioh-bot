import * as observability from "@yugidraft/shared/observability";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { DuelServiceError, TournamentDuelError } from "@yugidraft/shared/services";
import { expect, it, vi } from "vitest";
import { DeckLegalityError } from "../src/deck-legality.js";
import { createDuelHost } from "../src/host.js";

it.each(["view", "private-operation\n", { private: "private-operation" }, null])("logs unexpected DB errors safely for op %j", async (op) => {
  // A synthetic manifest is enough; this test never needs an engine bundle.
  const dir = mkdtempSync(join(import.meta.dirname, ".host-errors-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test", sources: {} }));
  const cards = new Database(join(dir, "cards.cdb"));
  cards.exec("create table datas (id integer primary key, alias integer, type integer); create table texts (id integer primary key, name text)");
  cards.close();
  vi.stubEnv("DUEL_DATA_DIR", dir);
  const db = new Database(":memory:");
  migrate(db);
  const secret = "host-errors-secret";
  const searchCards = vi.fn(() => []);
  const host = createDuelHost({ db, dataDirectory: dir, secret, searchCards });
  const events: Array<{ error: unknown; context: observability.ReportContext }> = [];
  observability.setObservabilityAdapter({ report: (error, context) => { events.push({ error, context }); }, log() {}, async flush() {} });
  const post = (body: object) => {
    const raw = JSON.stringify(body);
    return host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", body: raw,
      headers: { "x-announce-signature": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` },
    }));
  };
  try {
    const invalid = await post({ op: "view", guildId: "g", playerId: 1 });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Duel slug is required" });
    expect(events).toHaveLength(0);
    for (const [error, status, unexpected] of [
      [new Error("private-message"), 500, true],
      [new observability.ExpectedError("Safe request message", 429), 429, false],
      [Object.assign(new Error("private-message"), { status: 403 }), 500, true],
      [Object.assign(new Error("private-message"), { status: 500 }), 500, true],
      [Object.assign(new Error("private-message"), { status: 503 }), 500, true],
      ["private-message", 500, true],
      [new DuelServiceError("private-message", 409), 409, false],
      [new DuelServiceError("private-message", 503), 503, false],
      [new TournamentDuelError("private-message", 403), 403, false],
      [new TournamentDuelError("private-message", 503), 503, false],
      [new DeckLegalityError("private-message"), 400, false],
    ] as const) {
      searchCards.mockImplementationOnce(() => { throw error; });
      const response = await post({ op: "cards", query: "private-query", guildId: "g", playerId: 1 });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: unexpected ? "Something went wrong" : error instanceof observability.ExpectedError ? "Safe request message" : "private-message" });
      expect(events).toHaveLength(unexpected ? 1 : 0);
      events.length = 0;
    }
    db.close();
    const response = await post({ op, slug: "private-slug", guildId: "g", playerId: 1, note: "private-payload" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong" });
    expect(events).toHaveLength(1);
    expect(events[0]!.context).toEqual({ tags: { operation: "[duel] Unexpected request error", ...(op === "view" ? { op } : {}) } });
    const line = JSON.stringify(events[0]!.context);
    expect(line).toContain("[duel]");
    expect(line).not.toMatch(/host-errors-secret|private-slug|private-payload|private-operation|private-message|private-query|database connection|[\r\n]/);
  } finally {
    await host.close();
    if (db.open) db.close();
    const { consoleAdapter } = await import("../../shared/dist/observability/console-adapter.js");
    observability.setObservabilityAdapter(consoleAdapter);
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
