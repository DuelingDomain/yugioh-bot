import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost } from "../src/host.js";
import { seedIdentity } from "./helpers/identity.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

it("expires an abandoned empty lobby in the timer sweep and emits its invalidation", async () => {
  const directory = createHostDataFixture([]);
  const db = new Database(":memory:"); migrate(db);
  const playerId = seedIdentity(db, { guildId: "g", name: "Host" }).playerId;
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Abandoned", mode: "normal" });
  db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(session.id);
  const sandbox = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Dev sandbox", mode: "normal", sandbox: true });
  db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(sandbox.id);
  const changes: string[] = [];
  const host = createDuelHost({
    db, dataDirectory: directory, secret: "waiting-expiry-test", searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { throw new Error("An empty waiting table must not start an engine"); },
    onChange: slug => { changes.push(slug); },
  });
  try {
    await vi.waitFor(() => expect(duels.get(session.slug, "g").status).toBe("cancelled"));
    expect(changes).toEqual([session.slug]);
    expect(duels.get(sandbox.slug, "g")).toMatchObject({ sandbox: true, status: "lobby" });
    expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  } finally {
    await host.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
