import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { seedIdentity } from "../helpers/identity.js";

type Message = { stage: string; slug?: string; error?: string };
const worker = `
  import Database from "better-sqlite3";
  import { createDuelService } from ${JSON.stringify(new URL("../../dist/services/index.js", import.meta.url).href)};
  const [filename, host, key] = process.argv.slice(1);
  const db = new Database(filename);
  const duels = createDuelService(db);
  process.on("message", () => {
    process.send({ stage: "attempting" });
    try {
      const result = duels.createRequest({ guildId: "g", organizerPlayerId: Number(host), requestKey: key, fingerprint: "same" },
        () => ({ session: duels.create({ guildId: "g", organizerPlayerId: Number(host), name: "Concurrent", mode: "normal" }) }));
      process.send({ stage: "done", slug: result.session.slug });
    } catch (error) { process.send({ stage: "done", error: String(error) }); }
    finally { db.close(); process.disconnect(); }
  });
  process.send({ stage: "ready" });
`;

function waitFor(child: ChildProcess, stage: string): Promise<Message> {
  return new Promise((resolve, reject) => {
    const message = (value: Message) => { if (value.stage === stage) { clear(); resolve(value); } };
    const error = (cause: Error) => { clear(); reject(cause); };
    const exit = (code: number | null) => { clear(); reject(new Error(`Creation worker exited before ${stage}: ${code}`)); };
    const clear = () => { child.off("message", message); child.off("error", error); child.off("exit", exit); };
    child.on("message", message); child.on("error", error); child.on("exit", exit);
  });
}

it.each([true, false])("serializes two real processes on a held SQLite write lock (same key: %s)", async sameKey => {
  const directory = mkdtempSync(join(tmpdir(), "duel-create-race-"));
  const filename = join(directory, "race.sqlite");
  const db = new Database(filename); migrate(db);
  const host = seedIdentity(db, { guildId: "g", name: "Host" }).playerId;
  const children: ChildProcess[] = [];
  try {
    for (const key of ["concurrent-key-1", sameKey ? "concurrent-key-1" : "concurrent-key-2"]) {
      children.push(spawn(process.execPath, ["--input-type=module", "-e", worker, filename, String(host), key], {
        cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: ["ignore", "ignore", "inherit", "ipc"],
      }));
    }
    await Promise.all(children.map(child => waitFor(child, "ready")));
    // Both processes attempt creation while a third connection holds the writer lock.
    db.exec("begin immediate");
    const attempting = children.map(child => waitFor(child, "attempting"));
    const done = children.map(child => waitFor(child, "done"));
    children.forEach(child => child.send("create"));
    await Promise.all(attempting);
    db.exec("commit");
    const results = await Promise.all(done);
    expect(results.every(result => !result.error)).toBe(true);
    expect(new Set(results.map(result => result.slug)).size).toBe(sameKey ? 1 : 2);
    expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: sameKey ? 1 : 2 });
    expect(db.prepare("select count(*) as n from duels where status = 'lobby'").get()).toEqual({ n: 1 });
    if (!sameKey) expect(db.prepare("select result_reason from duels where status = 'cancelled'").get())
      .toEqual({ result_reason: "This table was replaced by a new table from its host." });
  } finally {
    if (db.inTransaction) db.exec("rollback");
    for (const child of children) if (child.exitCode === null && child.pid) child.kill();
    db.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

it("reads a fresh heartbeat without seeking the SQLite writer lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "duel-heartbeat-lock-"));
  const filename = join(directory, "heartbeat.sqlite");
  const db = new Database(filename, { timeout: 0 }); migrate(db);
  const host = seedIdentity(db, { guildId: "g", name: "Host" }).playerId;
  const duels = createDuelService(db);
  const table = duels.create({ guildId: "g", organizerPlayerId: host, name: "Waiting", mode: "normal" });
  const writer = new Database(filename);
  try {
    writer.exec("begin immediate");
    expect(() => duels.touchWaiting(table.slug, "g", host)).not.toThrow();
  } finally {
    writer.exec("rollback"); writer.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});
