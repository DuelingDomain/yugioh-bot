import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
import { seedIdentity } from "./helpers/identity.js";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "install-engine-bundle.sh");
const roots: string[] = [];

function sha(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The multi-scripts hash of the install script: the lines "<path>\0<sha256 of the file>\n", sorted by path.
function multiScriptsHash(files: Record<string, string>): string {
  const lines = Object.keys(files).sort().map((name) => `${name}\0${sha(files[name]!)}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** A small, complete bundle. `tag` changes manifest.json, `multi` changes only the multi core. */
function writeBundle(dir: string, options: { tag: string; multi?: string; legacy?: false | "bad-hash" }): void {
  const overlay = { "mp-utility.lua": "-- overlay", "MANIFEST.json": "{}" };
  mkdirSync(join(dir, "card-scripts"), { recursive: true });
  mkdirSync(join(dir, "multi-scripts"), { recursive: true });
  writeFileSync(join(dir, "cards.cdb"), "cdb");
  writeFileSync(join(dir, "strings.conf"), "strings");
  writeFileSync(join(dir, "ocgcore.domain.wasm"), "domain");
  writeFileSync(join(dir, "ocgcore.standard.wasm"), `standard-${options.tag}`);
  writeFileSync(join(dir, "card-scripts", "domain.lua"), "-- domain");
  const patched = "-- stock\n-- BEGIN HOST CARD SCRIPT PATCH\n-- patched\n";
  const stockPath = "official/c3743515.lua";
  mkdirSync(join(dir, "card-scripts/official"), { recursive: true });
  writeFileSync(join(dir, "card-scripts", stockPath), patched);
  writeFileSync(join(dir, "card-scripts/utility.lua"), patched);
  writeFileSync(join(dir, "card-scripts/.host-card-script-patches.json"), JSON.stringify([{ stockPath }, { stockPath: "utility.lua" }]));
  if (options.legacy !== false) {
    writeFileSync(join(dir, "ocgcore.domain.legacy.wasm"), "legacy domain");
    writeFileSync(join(dir, "card-scripts", "domain.legacy.lua"), "-- legacy domain");
  }
  for (const [name, text] of Object.entries(overlay)) writeFileSync(join(dir, "multi-scripts", name), text);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    tag: options.tag,
    integrity: {
      multiScripts: multiScriptsHash(overlay),
      cardScriptPatches: sha(`${stockPath}\0${sha(patched)}\nutility.lua\0${sha(patched)}\n`),
      domainLegacyWasm: sha(options.legacy === "bad-hash" ? "other" : "legacy domain"),
      domainLegacyLua: sha("-- legacy domain"),
    },
  }));
  if (options.multi !== undefined) {
    writeFileSync(join(dir, "ocgcore.multi.wasm"), options.multi);
    writeFileSync(join(dir, "ocgcore.multi.sha256"), `${sha(options.multi)}  ocgcore.multi.wasm\n`);
  }
}

interface Fixture {
  src: string;
  dst: string;
  root: string;
}

/** `installed` is what the VM holds, `incoming` is the new bundle. The database sits next to the data directory. */
function fixture(installed: { tag: string; multi?: string }, incoming: { tag: string; multi?: string }, duels: Array<{ format: string | null; status: string }>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "install-bundle-"));
  roots.push(root);
  const dst = join(root, "data", "engine-bundle");
  const src = join(root, "incoming");
  mkdirSync(dst, { recursive: true });
  mkdirSync(src, { recursive: true });
  writeBundle(dst, installed);
  writeBundle(src, incoming);
  const db = new Database(join(root, "data", "bot.sqlite"));
  const withFormat = duels.every((duel) => duel.format !== null);
  db.exec(withFormat ? "create table duels (id integer primary key, status text, format text)" : "create table duels (id integer primary key, status text)");
  for (const duel of duels) {
    if (withFormat) db.prepare("insert into duels (status, format) values (?, ?)").run(duel.status, duel.format);
    else db.prepare("insert into duels (status) values (?)").run(duel.status);
  }
  db.close();
  return { src, dst, root };
}

/** A bundle that was made without the legacy 1v1 files (or with a wrong hash) is refused, also in the preflight. */
function incompleteFixture(legacy: false | "bad-hash"): Fixture {
  const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
  rmSync(f.src, { recursive: true, force: true });
  mkdirSync(f.src, { recursive: true });
  writeBundle(f.src, { tag: "new", multi: "m1", legacy });
  return f;
}

function run(f: Fixture, preflight: boolean, idleClose?: string): { status: number | null; out: string } {
  const result = spawnSync("sh", [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", DUEL_BUNDLE_SRC: f.src, DUEL_DATA_DIR: f.dst,
      ...(preflight ? { DUEL_PREFLIGHT: "1" } : {}), ...(idleClose === undefined ? {} : { DUEL_IDLE_CLOSE: idleClose }) },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function snapshot(dir: string): Record<string, string> {
  const names = ["manifest.json", "ocgcore.standard.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"];
  return Object.fromEntries(names.filter((name) => existsSync(join(dir, name))).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeDomainMulti(dir: string, bytes: string): void {
  writeFileSync(join(dir, "ocgcore.multi-domain.wasm"), bytes);
  writeFileSync(join(dir, "ocgcore.multi-domain.sha256"), `${sha(bytes)}  ocgcore.multi-domain.wasm\n`);
  writeFileSync(join(dir, "ocgcore.multi-domain.SOURCE"), "tag=deploy-test\n");
}

describe("install-engine-bundle.sh Domain multi core", () => {
  it("adds Domain to an existing base bundle and leaves an identical core alone during a multiplayer duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, []);
    writeDomainMulti(f.src, "d1");
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    db.prepare("insert into duels (status, format) values (?, ?)").run("active", "ffa3");
    db.close();
    for (const preflight of [true, false]) expect(run(f, preflight).status).toBe(0);
  });
  it("updates Domain alone under an identical manifest while a 1v1 duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    expect(run(f, true).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.wasm"), "utf8")).toBe("d1");
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.SOURCE"), "utf8")).toBe("tag=deploy-test\n");
  });

  it.each(["ffa3", "ffa4", "tag"])("refuses a changed Domain core during an active %s duel before writing anything", (format) => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format, status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      expect(run(f, preflight).status).toBe(1);
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it.each(["missing", "bad", "empty"])("refuses a %s Domain checksum/artifact before replacing the base bundle", (kind) => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
    writeDomainMulti(f.src, kind === "empty" ? "" : "d2");
    if (kind === "missing") rmSync(join(f.src, "ocgcore.multi-domain.sha256"));
    if (kind === "bad") writeFileSync(join(f.src, "ocgcore.multi-domain.sha256"), `${"0".repeat(64)}  ocgcore.multi-domain.wasm\n`);
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toContain("bad multi core");
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it("refuses a Domain-only change during an active multiplayer duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "ffa4", status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    for (const preflight of [true, false]) expect(run(f, preflight).status).toBe(1);
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.wasm"), "utf8")).toBe("d1");
  });
});

describe("install-engine-bundle.sh preflight (DUEL_PREFLIGHT=1)", () => {
  it("refuses a changed bundle while a 1v1 duel is active, and changes nothing", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    const before = snapshot(f.dst);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("1 active duel(s)");
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("passes a changed bundle when no duel is active, and still installs nothing", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, [{ format: "1v1", status: "finished" }]);
    const before = snapshot(f.dst);
    const result = run(f, true);
    expect(result.status).toBe(0);
    expect(result.out).toContain("preflight ok");
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("passes a new multi core under an identical manifest while only a 1v1 duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "1v1", status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });

  it("refuses a new multi core under an identical manifest while a free-for-all duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "ffa3", status: "active" }]);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("active Tag or free-for-all duel(s)");
  });

  it("passes an identical bundle while any duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "ffa4", status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });

  it("refuses a bundle with a bad multi core sidecar", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    writeFileSync(join(f.src, "ocgcore.multi.sha256"), `${"0".repeat(64)}  ocgcore.multi.wasm\n`);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("bad multi core");
  });

  it("treats a database from before the format column as having no Tag or free-for-all duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: null, status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });
});

describe("install-engine-bundle.sh install", () => {
  it("still refuses a changed bundle while a duel is active", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    const before = snapshot(f.dst);
    expect(run(f, false).status).toBe(1);
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("installs a changed bundle when no duel is active", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
  });

  it("installs only the multi core when the manifest is identical, and a 1v1 duel does not block it", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "1v1", status: "active" }]);
    const standardBefore = readFileSync(join(f.dst, "ocgcore.standard.wasm"), "utf8");
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.multi.wasm"), "utf8")).toBe("m2");
    expect(readFileSync(join(f.dst, "ocgcore.standard.wasm"), "utf8")).toBe(standardBefore);
  });
});

describe("install-engine-bundle.sh idle duels with the application schema", () => {
  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("closes stale %s duels after stop but still refuses a live duel", format => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("drop table duels"); migrate(db);
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const service = createDuelService(db);
      const create = (name: string) => service.create({ guildId: "g", organizerPlayerId: owner, name, mode: "normal", format });
      const stale = create("Stale"), live = create("Live");
      db.prepare("update duels set status = 'active', seed_json = '[\"1\"]', bundle_version = 'saved', last_activity_at = datetime('now', '-2 hours') where id = ?").run(stale.id);
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-1 minute') where id = ?").run(live.id);
      db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) values (?, 1, 0, '{}')").run(stale.id);
      const before = snapshot(f.dst);
      // Before stopping the services the check is read-only, even if another live game refuses deployment.
      const preflight = run(f, true, "1");
      expect(preflight.status, preflight.out).toBe(1);
      expect(preflight.out).toContain("1 active");
      expect(service.get(stale.slug, "g").status).toBe("active");
      const startup = run(f, false);
      expect(startup.status, startup.out).toBe(1);
      expect(service.get(stale.slug, "g").status).toBe("active");
      const refused = run(f, false, "1");
      expect(refused.status, refused.out).toBe(1);
      expect(refused.out).toContain("1 active");
      expect(snapshot(f.dst)).toEqual(before);
      expect(service.get(stale.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, winnerPlayerId: null,
        resultReason: "No player activity for 10 minutes." });
      expect(service.get(live.slug, "g").status).toBe("active");
      expect(db.prepare("select ended_at is not null as ended, archived_at is not null as archived, clock_json from duels where id = ?").get(stale.id))
        .toEqual({ ended: 1, archived: 1, clock_json: null });
      expect(service.privateState(stale.slug, "g").commands).toHaveLength(1);
      db.prepare("update duels set last_activity_at = datetime('now', '-2 hours') where id = ?").run(live.id);
      expect(run(f, true, "1").status).toBe(0);
      expect(service.get(live.slug, "g").status).toBe("active");
      const installed = run(f, false, "1");
      expect(installed.status, installed.out).toBe(0);
      expect(service.get(live.slug, "g").status).toBe("interrupted");
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it.each(["ranked", "tournament", "closed tournament"])("preserves an idle %s for host settlement while replacing the bundle", kind => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("drop table duels"); migrate(db);
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const guest = seedIdentity(db, { guildId: "g", name: "Guest" }).playerId;
      const series = createDuelSeriesService(db);
      const { duel, series: match } = series.createChallenge({ guildId: "g", challengerPlayerId: owner, opponentPlayerId: guest,
        bestOf: 3, ranked: true, mode: "normal" });
      db.prepare("update duel_series set status = 'active' where id = ?").run(match.id);
      if (kind !== "ranked") {
        db.prepare("update duels set ranked = 0 where id = ?").run(duel.id);
        db.prepare("update duel_series set ranked = 0 where id = ?").run(match.id);
        const tournament = db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) select 'g', 'Cup', 'single_elim', ?, user_id from players where id = ?")
          .run(kind === "closed tournament" ? "completed" : "active", owner);
        const slot = db.prepare("insert into tournament_matches (tournament_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, 1, 'open')")
          .run(tournament.lastInsertRowid, owner, guest);
        db.prepare("update duel_series set tournament_match_id = ? where id = ?").run(slot.lastInsertRowid, match.id);
      }
      const clock = { turn: 1, activeSeat: null, startedAt: null, remainingMs: [180_000, 180_000] };
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-11 minutes'), clock_json = ? where id = ?")
        .run(JSON.stringify(clock), duel.id);
      const before = db.prepare("select * from duels where id = ?").get(duel.id);
      expect(run(f, true, "1").status).toBe(0);
      expect(createDuelService(db).get(duel.slug, "g").status).toBe("active");
      expect(series.get(match.id, "g").status).toBe("active");
      const result = run(f, false, "1");
      expect(result.status, result.out).toBe(0);
      expect(db.prepare("select * from duels where id = ?").get(duel.id)).toEqual(before);
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(series.get(match.id, "g")).toMatchObject({ status: "active", wins: [0, 0], nextGameAt: null });
      expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it.each([undefined, "0", "true"])("leaves stale duel rows for the host to close during container startup (DUEL_IDLE_CLOSE=%s)", idleClose => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("drop table duels"); migrate(db);
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const service = createDuelService(db);
      const duel = service.create({ guildId: "g", organizerPlayerId: owner, name: "Stale", mode: "normal" });
      const clock = { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * 60_000, remainingMs: [30 * 60_000, 30 * 60_000] };
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-11 minutes'), clock_json = ? where id = ?")
        .run(JSON.stringify(clock), duel.id);
      const before = db.prepare("select * from duels where id = ?").get(duel.id);
      const result = run(f, false, idleClose);
      expect(result.status, result.out).toBe(0);
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(db.prepare("select * from duels where id = ?").get(duel.id)).toEqual(before);
    } finally { db.close(); }
  });
});

describe("install-engine-bundle.sh patched card scripts", () => {
  it.each(["stock", "missing script", "missing receipt", "empty receipt", "invalid receipt", "unsafe path"])("refuses %s in the incoming bundle before writing", kind => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const script = join(f.src, "card-scripts/official/c3743515.lua");
    const receipt = join(f.src, "card-scripts/.host-card-script-patches.json");
    if (kind === "stock") writeFileSync(script, "-- stock\n");
    if (kind === "missing script") rmSync(script);
    if (kind === "missing receipt") rmSync(receipt);
    if (kind === "empty receipt") writeFileSync(receipt, "[]");
    if (kind === "invalid receipt") writeFileSync(receipt, "{}");
    if (kind === "unsafe path") writeFileSync(receipt, JSON.stringify([{ stockPath: "../manifest.json" }]));
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toContain("cardScriptPatches");
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it("repairs an installed stock script even when the manifest is identical", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, []);
    const path = "card-scripts/official/c3743515.lua";
    writeFileSync(join(f.dst, path), "-- stock\n");
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, path), "utf8")).toBe(readFileSync(join(f.src, path), "utf8"));
  });

  it("refuses repair of an installed stock script while a duel is active", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, [{ format: "1v1", status: "active" }]);
    const path = join(f.dst, "card-scripts/official/c3743515.lua");
    writeFileSync(path, "-- stock\n");
    for (const preflight of [true, false]) {
      expect(run(f, preflight).status).toBe(1);
      expect(readFileSync(path, "utf8")).toBe("-- stock\n");
    }
  });
});

describe("install-engine-bundle.sh and the legacy 1v1 engine files", () => {
  it.each([
    ["has no legacy files", false],
    ["has a legacy wasm that does not match integrity.domainLegacyWasm", "bad-hash"],
  ] as const)("refuses a bundle that %s", (_name, legacy) => {
    const f = incompleteFixture(legacy);
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toMatch(/bundle source is incomplete/);
    }
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("installs the legacy files with the bundle", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.domain.legacy.wasm"), "utf8")).toBe("legacy domain");
    expect(readFileSync(join(f.dst, "card-scripts", "domain.legacy.lua"), "utf8")).toBe("-- legacy domain");
  });
});

it.each([true,false])("refuses a missing/corrupt prerelease remap artifact before installation (preflight=%s)",preflight=>{
 const f=fixture({tag:"old"},{tag:"new"},[]),before=snapshot(f.dst);
 const path=join(f.src,"manifest.json"),manifest=JSON.parse(readFileSync(path,"utf8"));
 manifest.sources={databaseFormat:"official-releases-prerelease-v1"};manifest.integrity.cardRemaps=sha("valid-remaps");
 writeFileSync(path,JSON.stringify(manifest));
 expect(run(f,preflight).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
 writeFileSync(join(f.src,"card-remaps.json"),"corrupt-remaps");
 expect(run(f,preflight).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
 writeFileSync(join(f.src,"card-remaps.json"),"valid-remaps");
 expect(run(f,preflight).status).toBe(0);
});


it.each(["official-releases-prerelease-v1","official-releases-prerelease-v2"])("refuses the %s recipe without a remap hash", format=>{
 const f=fixture({tag:"old"},{tag:"new"},[]),before=snapshot(f.dst);
 const path=join(f.src,"manifest.json"),manifest=JSON.parse(readFileSync(path,"utf8"));
 manifest.sources={databaseFormat:format};delete manifest.integrity.cardRemaps;
 writeFileSync(path,JSON.stringify(manifest));
 expect(run(f,true).status).not.toBe(0);
 expect(snapshot(f.dst)).toEqual(before);
});
