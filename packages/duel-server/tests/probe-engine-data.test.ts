import Database from "better-sqlite3";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeEngineData } from "../scripts/probe-engine-data.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(scripts: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "probe-engine-data-"));
  temporary.push(root);
  const database = new Database(join(root, "cards.cdb"));
  database.exec(`CREATE TABLE datas (id INTEGER, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER,
    atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER);
    CREATE TABLE texts (id INTEGER, name TEXT, desc TEXT);`);
  for (const name of Object.keys(scripts)) {
    const code = /^official\/c(\d+)\.lua$/.exec(name)?.[1];
    if (code) database.prepare("INSERT INTO datas VALUES (?, 3, 0, 0, 33, 1000, 1000, 4, 1, 1)").run(Number(code));
  }
  database.close();
  await writeFile(join(root, "strings.conf"), "");
  const files = {
    "constant.lua": "KNOWN_CONSTANT=1\n",
    "utility.lua": "function GetID() return self_table,self_code end",
    ...scripts,
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, "card-scripts", name)), { recursive: true });
    await writeFile(join(root, "card-scripts", name), content);
  }
  return root;
}

describe("candidate engine data probe", () => {
  it("checks every missing API and constant through the installed core, including Group", async () => {
    const root = await fixture({
      "official/c1001.lua": `local s,id=GetID()
        function s.initial_effect(c) end
        function s.later()
          Duel.ProbeMissingOne()
          Card.ProbeMissingTwo()
          Effect.ProbeMissingThree()
          Group.ProbeMissingFour()
          if PROBE_EQUALITY_CONSTANT==1 then return end
          return PROBE_MISSING_CONSTANT + PROBE_OTHER_CONSTANT + KNOWN_CONSTANT
        end`,
    });
    const result = await probeEngineData(root, ["official/c1001.lua"]);
    for (const symbol of ["Duel.ProbeMissingOne", "Card.ProbeMissingTwo", "Effect.ProbeMissingThree", "Group.ProbeMissingFour", "PROBE_MISSING_CONSTANT", "PROBE_OTHER_CONSTANT", "PROBE_EQUALITY_CONSTANT"]) {
      expect(result.errors.some((error) => error.includes(symbol))).toBe(true);
    }
    expect(result.errors.join("\n")).not.toContain("Missing global KNOWN_CONSTANT");
    expect(result).toMatchObject({ cardsChecked: 1, scriptsChecked: 3, apiSymbolsChecked: 4, globalsChecked: 4 });
  });

  it("invokes initial_effect for each changed official card and keeps later failures", async () => {
    const root = await fixture({
      "official/c1002.lua": 'local s,id=GetID()\nfunction s.initial_effect(c) error("first initialization failure") end',
      "official/c1003.lua": 'local s,id=GetID()\nfunction s.initial_effect(c) error("second initialization failure") end',
    });
    const result = await probeEngineData(root, ["official/c1002.lua", "official/c1003.lua"]);
    expect(result.cardsChecked).toBe(2);
    expect(result.errors.join("\n")).toContain("first initialization failure");
    expect(result.errors.join("\n")).toContain("second initialization failure");
  });

  it("accepts supported symbols and script-defined helpers without scanning comments, strings, or local constants", async () => {
    const root = await fixture({
      "official/c1004.lua": `local s,id=GetID()
        local LOCAL_CONSTANT=1
        function Group.ProbeHelper() end
        function s.initial_effect(c) local e=Effect.CreateEffect(c) end
        function s.later() return Group.ProbeHelper, Card.GetCode, Duel.Draw, KNOWN_CONSTANT, LOCAL_CONSTANT end
        -- Duel.CommentOnly() COMMENT_CONSTANT
        --[=[ Group.LongComment() LONG_COMMENT_CONSTANT ]=]
        s.note="Effect.StringOnly STRING_CONSTANT"
        s.note=[=[Group.LongString LONG_STRING_CONSTANT]=]`,
    });
    expect((await probeEngineData(root, ["official/c1004.lua"])).errors).toEqual([]);
  });

  it("initializes the changed official script when another directory has the same card filename", async () => {
    const root = await fixture({
      "official/c1005.lua": 'local s,id=GetID()\nfunction s.initial_effect(c) error("official initialization") end',
      "pre-errata/c1005.lua": 'local s,id=GetID()\nfunction s.initial_effect(c) error("other initialization") end',
    });
    const result = await probeEngineData(root, ["official/c1005.lua"]);
    expect(result.errors.join("\n")).toContain("official initialization");
    expect(result.errors.join("\n")).not.toContain("other initialization");
  });

  it("initializes official cards before changed duplicate scripts and still probes every namespace", async () => {
    const root = await fixture({
      "official/c1006.lua": `local s,id=GetID()
        function s.initial_effect(c) error("official initialization") end
        function s.later() Duel.OfficialMissing() Card.OfficialMissing() end`,
      "pre-errata/c1006.lua": `local s,id=GetID()
        function s.initial_effect(c) error("other initialization") end
        function s.later() Effect.OtherMissing() Group.OtherMissing() end`,
    });
    const result = await probeEngineData(root, ["pre-errata/c1006.lua", "official/c1006.lua"]);
    const errors = result.errors.join("\n");
    expect(errors).toContain("official initialization");
    expect(errors).not.toContain("unreachable");
    expect(errors).not.toContain("other initialization");
    for (const symbol of ["Duel.OfficialMissing", "Card.OfficialMissing", "Effect.OtherMissing", "Group.OtherMissing"]) {
      expect(errors).toContain(symbol);
    }
    expect(result).toMatchObject({ cardsChecked: 1, scriptsChecked: 4, apiSymbolsChecked: 4 });
  });

  it("bounds a hanging Lua script and returns an advisory finding", async () => {
    const root = await fixture({ "hanging-helper.lua": "while true do end", "official/c1002.lua": "local s,id=GetID()" });
    const db = new Database(join(root, "cards.cdb"));
    db.exec("insert into datas select 1102,ot,1002,setcode,type,atk,def,level,race,attribute from datas where id = 1002; insert into datas select 1007,ot,1002,setcode,type,atk,def,level,race,attribute from datas where id = 1002; insert into texts values (1002,'Dragon',''),(1102,'Dragon',''),(1007,'Dragon','')");
    db.close();
    const result = await probeEngineData(root, ["hanging-helper.lua"], { timeoutMs: 2_000 });
    expect(result.artworkScriptFallbacks).toEqual([{ passcode: 1102, main: 1002, requested: 1102 }]); // 1007 is within 10 of 1002: the core loads c1002.lua itself
    expect(result.errors.join("\n")).toContain("timed out");
  }, 10_000);

  it("reports missing candidate data instead of rejecting", async () => {
    const root = await mkdtemp(join(tmpdir(), "probe-missing-data-"));
    temporary.push(root);
    const result = await probeEngineData(root, []);
    expect(result.errors.join("\n")).toContain("Card database missing");
  });
});
