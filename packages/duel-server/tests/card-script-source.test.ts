import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readOnlyCardScriptSource } from "../src/card-script-source.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardDatabase } from "../src/cards.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

it("server and production export hashes agree for near aliases, artwork fallback and missing scripts in every engine kind", () => {
  const dir = createHostDataFixture([
    { code: 10, name: "Card" }, { code: 11, name: "Card", alias: 10 },
    { code: 100, name: "Card", alias: 10 },
    { code: 200, name: "Missing", alias: 300 }, { code: 300, name: "Missing" },
  ]);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const code of [100, 200, 300]) rmSync(join(dir, "card-scripts", `c${code}.lua`));
    const server = loadCardDatabase(dir), exported = readOnlyCardScriptSource(dir);
    const overlay = { apply: (name: string, text: string | null) => `${name}:${text ?? "missing"}`, utility: "fixture utility" };
    try {
      for (const code of [10, 11, 100, 200]) {
        for (const kind of ["pinned-normal", "legacy-normal", "multi-normal", "multi-domain"] as const) {
          expect(cardScriptHash(exported, code, kind, overlay), `${code}/${kind}`).toBe(cardScriptHash(server, code, kind, overlay));
        }
      }
      expect(server.readScript("c100.lua", overlay)).toBe("c10.lua:-- fixture card script\n");
      expect(server.readScript("c200.lua", overlay)).toBe("c200.lua:missing");
      expect(cardScriptHash(server, 200, "pinned-normal")).toBeNull();
    } finally { exported.close(); }
  } finally { warn.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
});

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
