import { afterAll, beforeAll, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { setCatalogDirectory } from "../../../src/presets/catalog.js";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { domainVariant } from "./domain-variants.js";
import { GLOBAL_FLAG_MEMORY_SCENARIOS } from "./global-flag-memory.js";

// Panther only tests the existence of its flag. Observe its real engine count after each release as well,
// so a second flag cannot hide behind an unchanged attack permission. This observer writes no game state.
const observer = `
local released=false
local release=Effect.GlobalEffect()
release:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
release:SetCode(EVENT_RELEASE)
release:SetOperation(function() released=true end)
Duel.RegisterEffect(release,1)
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_ADJUST)
e:SetOperation(function()
  if not released or Duel.GetLP(0)>0 then return end
  for seat=1,3 do
    local lp=Duel.GetLP(seat)
    if lp and lp>0 then
      local ct=Duel.GetFlagEffect(seat,77482666)
      assert(ct==1,"Panther flag count at seat "..seat..": expected 1, got "..ct)
    end
  end
end)
Duel.RegisterEffect(e,1)
`;

describeWithCores("global flag memory after an LP loss", liveNseat, () => {
  let fixture: string;
  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), "global-flag-memory-"));
    copyFileSync(join(engineDataDirectory, "cards.cdb"), join(fixture, "cards.cdb"));
    symlinkSync(join(engineDataDirectory, "card-scripts"), join(fixture, "card-scripts"));
    symlinkSync(join(engineDataDirectory, "strings.conf"), join(fixture, "strings.conf"));
    const db = new Database(join(fixture, "cards.cdb"));
    try {
      // The pinned CDB lacks 77482666. Its printed data match Panther Warrior: EARTH, level 4,
      // Beast-Warrior, 2000/1600. Use that row with the real passcode and the real stock script.
      // Source: https://www.db.yugioh-card.com/yugiohdb/member_deck.action?cgid=120f214d09e854a26d5583ad85f8cf13&dno=119&request_locale=en
      db.prepare("INSERT OR IGNORE INTO datas SELECT 77482666,ot,alias,setcode,type,atk,def,level,race,attribute,category FROM datas WHERE id=42035044").run();
      const columns = (db.prepare("PRAGMA table_info(texts)").all() as { name: string }[]).map((c) => c.name);
      const values = columns.map((c) => c === "id" ? "77482666" : c === "name" ? "'Swiftwind Panther Warrior'" : c);
      db.exec(`INSERT OR IGNORE INTO texts SELECT ${values.join(",")} FROM texts WHERE id=42035044`);
    } finally { db.close(); }
    setCatalogDirectory(fixture);
  });
  afterAll(() => {
    setCatalogDirectory(undefined);
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });
  for (const s of [...GLOBAL_FLAG_MEMORY_SCENARIOS, ...GLOBAL_FLAG_MEMORY_SCENARIOS.map(domainVariant)]) {
    it(s.id, async () => {
      const compiled = compileBoard(s.setup);
      const game = await createEngineGame({
        ...compiled.options, dataDirectory: fixture, seed: ["1", "2", "3", "4"],
        multiWasmBinary: s.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
        startupScripts: [...(compiled.options.startupScripts ?? []), ...(s.tags.includes("card:77482666") ? [{ name: "panther-flag-observer.lua", content: observer }] : [])],
      });
      try {
        const session = new Session(s, game);
        session.reachMainPhase();
        session.startRecording();
        s.steps.forEach((step, index) => session.run(step, index + 1));
        if (s.tags.includes("card:77482666")) {
          expect(game.view(1).seats[1].monsters.filter((c) => c != null).map((c) => c!.code).sort()).toEqual([15025844, 15025844, 77482666]);
        }
      } finally { game.close(); }
    });
  }
});
