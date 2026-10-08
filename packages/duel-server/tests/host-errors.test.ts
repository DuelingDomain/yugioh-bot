import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { expect, it, vi } from "vitest";
import { createDuelHost } from "../src/host.js";

it("logs unexpected DB errors once without logging request payloads or secrets", async () => {
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
  const host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [] });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const post = (body: object) => {
    const raw = JSON.stringify(body);
    return host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", body: raw,
      headers: { "x-announce-signature": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` },
    }));
  };
  try {
    expect((await post({ op: "view", guildId: "g", playerId: 1 })).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
    db.close();
    const response = await post({ op: "view", slug: "private-slug", guildId: "g", playerId: 1, note: "private-payload" });
    expect((await response.json()).error).toBe("The database connection is not open");
    expect(log).toHaveBeenCalledOnce();
    const line = log.mock.calls[0]!.join(" ");
    expect(line).toContain("[duel]");
    expect(line).not.toMatch(/host-errors-secret|private-slug|private-payload|[\r\n]/);
  } finally {
    await host.close();
    if (db.open) db.close();
    log.mockRestore();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
