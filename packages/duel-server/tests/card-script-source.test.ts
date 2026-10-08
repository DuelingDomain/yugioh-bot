import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readOnlyCardScriptSource } from "../src/card-script-source.js";
import { cardScriptHash } from "../src/card-script-hash.js";

it("reads only requested metadata while preserving core aliases, basename priority and overlays", () => {
  const dir = mkdtempSync(join(tmpdir(), "script-source-"));
  try {
    const db = new Database(join(dir, "cards.cdb"));
    db.exec(`CREATE TABLE datas(id INTEGER, alias INTEGER, type INTEGER); CREATE TABLE texts(id INTEGER, name TEXT);
      INSERT INTO datas VALUES (10,0,33), (11,10,33), (100,10,33), (200,10,33);
      INSERT INTO texts VALUES (10,'Card'), (11,'Card'), (100,'Card'), (200,'Different card');`);
    db.close();
    for (const folder of ["official", "pre-release"]) mkdirSync(join(dir, "card-scripts", folder), { recursive: true });
    writeFileSync(join(dir, "card-scripts", "official", "c10.lua"), "official");
    writeFileSync(join(dir, "card-scripts", "pre-release", "c10.lua"), "prerelease");
    writeFileSync(join(dir, "card-scripts", "proc_x.lua"), "helper");
    const source = readOnlyCardScriptSource(dir);
    try {
      expect(source.deckCard(10)?.name).toBe("Card");
      expect(source.deckCard(999)).toBeUndefined();
      expect(source.readScript("c10.lua")).toBe("official");
      expect(source.readScript("pre-release/c10.lua")).toBe("prerelease");
      expect(source.readScript("c100.lua")).toBe("official");
      expect(source.readScript("c200.lua")).toBeNull();
      expect(cardScriptHash(source, 11)).toBe(cardScriptHash(source, 10));
      expect(source.readScript("c100.lua", { apply: (name, text) => `${name}:${text}:suffix` })).toBe("c10.lua:official:suffix");
      expect([...source.scriptNames!()]).toContain("proc_x.lua");
    } finally { source.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
