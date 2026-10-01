import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";

const SECRET = "multi-domain-guard-secret";

const hosts: DuelHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A lobby with one organizer in a Domain table. The data directory holds only the files named in `files`. */
function lobby(format: DuelFormat, files: string[]) {
  const dataDirectory = mkdtempSync(join(tmpdir(), "host-multi-domain-"));
  dirs.push(dataDirectory);
  writeFileSync(join(dataDirectory, "manifest.json"), JSON.stringify({ bundleVersion: "test" }));
  for (const file of files) writeFileSync(join(dataDirectory, file), "wasm");
  const db = new Database(":memory:");
  migrate(db);
  const playerId = Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", "u0", "P0").lastInsertRowid,
  );
  const session = createDuelService(db).create({ guildId: "g1", organizerPlayerId: playerId, name: "Duel", mode: "domain", format });
  let workersCreated = 0;
  const host = createDuelHost({
    db,
    dataDirectory,
    secret: SECRET,
    searchCards: () => [],
    pollIntervalMs: 60_000,
    createWorker: () => {
      workersCreated += 1;
      throw new Error("the guard must answer before a worker is created");
    },
  });
  hosts.push(host);
  const start = async () => {
    const raw = JSON.stringify({ op: "start", slug: session.slug, guildId: "g1", playerId });
    const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
    const response = await host.handle(
      new Request("http://localhost/internal/duel", {
        method: "POST",
        headers: { "content-type": "application/json", "x-announce-signature": signature },
        body: raw,
      }),
    );
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };
  return { start, workersCreated: () => workersCreated };
}

describe("host start of a Domain table with 3 or more seats", () => {
  it.each(["ffa3", "ffa4", "tag"] as const)("answers 409 with the clear message at %s when the Domain multi core is missing", async (format) => {
    // The plain multi core is there; the Domain multi core is not.
    const t = lobby(format, ["ocgcore.multi.wasm"]);
    const started = await t.start();
    expect(started.status).toBe(409);
    expect(started.data.error).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
    expect(t.workersCreated()).toBe(0);
  });

  it("does not block on the Domain core once its file is installed (the next check is the seat check)", async () => {
    const t = lobby("ffa3", ["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]);
    const started = await t.start();
    expect(started.status).toBe(409);
    expect(started.data.error).toMatch(/3 players must submit valid decks/);
    expect(t.workersCreated()).toBe(0);
  });
});
