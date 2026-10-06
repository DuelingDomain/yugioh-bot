import { seedIdentity, seedUser } from "../../shared/tests/helpers/identity.js";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { MULTIPLAYER_TABLES_OFF_MESSAGE, MULTI_CORE_UNAVAILABLE_MESSAGE, MULTI_DOMAIN_UNAVAILABLE_MESSAGE, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";

const SECRET = "multi-domain-guard-secret";

const hosts: DuelHost[] = [];
const dirs: string[] = [];
beforeEach(() => vi.stubEnv("MULTIPLAYER_TABLES", "1"));
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** A lobby with one organizer in a table of `mode` (Domain by default). The data directory holds only the files named in `files`. */
function lobby(format: DuelFormat, files: string[], mode: DuelMode = "domain") {
  const dataDirectory = mkdtempSync(join(tmpdir(), "host-multi-domain-"));
  dirs.push(dataDirectory);
  writeFileSync(join(dataDirectory, "manifest.json"), JSON.stringify({ bundleVersion: "test" }));
  for (const file of files) writeFileSync(join(dataDirectory, file), "wasm");
  const db = new Database(":memory:");
  migrate(db);
  const playerId = seedIdentity(db, { guildId: "g1", name: "P0", userId: seedUser(db, "u0").userId, discordUserId: seedUser(db, "u0").discordUserId ?? "u0" }).playerId;
  const session = createDuelService(db).create({ guildId: "g1", organizerPlayerId: playerId, name: "Duel", mode, format });
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
  const post = async (op = "start", extra: Record<string, unknown> = {}) => {
    const raw = JSON.stringify({ op, ...(op === "capabilities" ? {} : { slug: session.slug }), guildId: "g1", playerId, ...extra });
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
  return { start: post, workersCreated: () => workersCreated };
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

  it.each(["ffa3", "ffa4", "tag"] as const)("blocks %s when multiplayer tables are off, even with the core", async (format) => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    const t = lobby(format, ["ocgcore.multi-domain.wasm"]);
    const started = await t.start();
    expect(started.status).toBe(403);
    expect(started.data.error).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(t.workersCreated()).toBe(0);
  });

  it.each([
    { multiCoreReady: false, multiDomainCoreReady: false, files: [] },
    { multiCoreReady: true, multiDomainCoreReady: false, files: ["ocgcore.multi.wasm"] },
    { multiCoreReady: false, multiDomainCoreReady: true, files: ["ocgcore.multi-domain.wasm"] },
    { multiCoreReady: true, multiDomainCoreReady: true, files: ["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"] },
  ])("reports installed cores to the creator: $multiCoreReady / $multiDomainCoreReady", async ({ files, multiCoreReady, multiDomainCoreReady }) => {
    const t = lobby("ffa3", files);
    const result = await t.start("capabilities");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ multiplayerTables: true, multiCoreReady, multiDomainCoreReady });
    expect(t.workersCreated()).toBe(0);
  });

  it.each(["normal", "domain"] as const)("blocks %s bot fill and start when the flag is off", async (mode) => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    const t = lobby("ffa4", ["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"], mode);
    for (const op of ["add-bot", "start"]) {
      const result = await t.start(op);
      expect(result.status).toBe(403);
      expect(result.data.error).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    }
    expect(t.workersCreated()).toBe(0);
  });

  it("also blocks a multiplayer preset before it makes a table when the flag is off", async () => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    vi.stubEnv("DUEL_SCENARIOS", "1");
    const t = lobby("ffa4", ["ocgcore.multi.wasm"]);
    const result = await t.start("start-preset", { presetId: "ffa4-chain-order-heavy-storm" });
    expect(result.status).toBe(403);
    expect(result.data.error).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(t.workersCreated()).toBe(0);
  });
});

describe("host start of a table with 3 or more seats when the multi core is missing", () => {
  it.each(["ffa3", "ffa4", "tag"] as const)("answers 409 with the clear message at %s, in Standard and in Domain, and opens no worker", async (format) => {
    for (const mode of ["normal", "domain"] as const) {
      const t = lobby(format, [], mode);
      const started = await t.start();
      expect(started.status).toBe(409);
      expect(started.data.error).toBe(MULTI_CORE_UNAVAILABLE_MESSAGE);
      expect(t.workersCreated()).toBe(0);
    }
  });
});
