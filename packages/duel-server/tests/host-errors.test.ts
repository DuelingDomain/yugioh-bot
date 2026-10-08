import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { expect, it, vi } from "vitest";
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
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(log).not.toHaveBeenCalled();
    for (const status of [403, 500]) {
      searchCards.mockImplementationOnce(() => { throw Object.assign(new Error("private-message"), { status }); });
      const response = await post({ op: "cards", query: "private-query", guildId: "g", playerId: 1 });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: status === 403 ? "private-message" : "Duel server error" });
      if (status === 403) expect(log).not.toHaveBeenCalled();
      else expect(log).toHaveBeenCalledExactlyOnceWith("[duel] Unexpected request error", { name: "Error", op: "cards" });
    }
    log.mockClear();
    db.close();
    const response = await post({ op, slug: "private-slug", guildId: "g", playerId: 1, note: "private-payload" });
    expect(await response.json()).toEqual({ error: "Duel server error" });
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[duel] Unexpected request error", { name: "TypeError", ...(op === "view" ? { op } : {}) });
    const line = JSON.stringify(log.mock.calls[0]);
    expect(line).toContain("[duel]");
    expect(line).not.toMatch(/host-errors-secret|private-slug|private-payload|private-operation|private-message|private-query|database connection|[\r\n]/);
  } finally {
    await host.close();
    if (db.open) db.close();
    log.mockRestore();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
