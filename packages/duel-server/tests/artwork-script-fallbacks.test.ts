import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadCardDatabase } from "../src/cards.js";

it("names the script the core requests when a near alias points at an art without its own script", () => {
  const dir = mkdtempSync(join(tmpdir(), "artwork-fallbacks-"));
  try {
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
    writeFileSync(join(dir, "strings.conf"), ""); mkdirSync(join(dir, "card-scripts"));
    writeFileSync(join(dir, "card-scripts/c10.lua"), "-- main script");
    const cdb = new Database(join(dir, "cards.cdb"));
    // 50 aliases 30 (far), 55 aliases 50 (near): the core asks for c50.lua for 55, and neither exists.
    cdb.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);
      create table texts (id integer primary key, name text, desc text);
      insert into datas values (10,3,0,0,17,1000,1000,4,1,1),(30,3,10,0,17,1000,1000,4,1,1),(50,3,30,0,17,1000,1000,4,1,1),(55,3,50,0,17,1000,1000,4,1,1);
      insert into texts values (10,'Dragon',''),(30,'Dragon',''),(50,'Dragon',''),(55,'Dragon','');`); cdb.close();
    expect(loadCardDatabase(dir).artworkScriptFallbacks()).toEqual([
      { passcode: 30, main: 10, requested: 30 }, { passcode: 50, main: 10, requested: 50 }, { passcode: 55, main: 10, requested: 50 },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
