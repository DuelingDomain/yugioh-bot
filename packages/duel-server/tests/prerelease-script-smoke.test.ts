import Database from "better-sqlite3";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { smokePrereleaseScripts } from "../scripts/prerelease-script-smoke.js";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"prerelease-smoke-"));roots.push(root);
 const db=new Database(join(root,"cards.cdb"));
 db.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,ot INTEGER,alias INTEGER,setcode INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER);
 CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT,desc TEXT);`);
 for(const code of [100000001,100000002,100000003,100000004,100000005,100000006,12]){
  db.prepare("INSERT INTO datas VALUES(?,?,0,0,33,1000,1000,4,1,1)").run(code,code===12?3:259);
  db.prepare("INSERT INTO texts VALUES(?,?,'')").run(code,`Card ${code}`);
 }
 db.exec("UPDATE datas SET alias=100000003 WHERE id=100000004");db.close();
 const scripts={"constant.lua":"", "utility.lua":"function GetID() return self_table,self_code end",
  "pre-release/c100000001.lua":"local s,id=GetID(); function s.initial_effect(c) end",
  "pre-release/c100000002.lua":"local s,id=GetID(); function s.initial_effect(c) error('preview initial_effect failed') end",
  "pre-release/c100000003.lua":"this is not valid lua",
  "pre-release/c100000005.lua":"local s,id=GetID(); function s.initial_effect(c) end; function s.later() error('later effect is outside smoke scope') end",
  "official/c12.lua":"local s,id=GetID(); function s.initial_effect(c) error('released error remains playable') end"};
 for(const [path,source] of Object.entries(scripts)){await mkdir(dirname(join(root,"card-scripts",path)),{recursive:true});await writeFile(join(root,"card-scripts",path),source);}
 await writeFile(join(root,"strings.conf"),"");return root;
}
it("registers all prereleases and excludes load/initial_effect/missing-script errors, preserving healthy and released cards",async()=>{
 const root=await fixture(),result=await smokePrereleaseScripts(root,[100000001,100000002,100000003,100000004,100000005,100000006]);
 expect(result.checked).toBe(6);
 expect(result.excluded.map(card=>card.code)).toEqual([100000002,100000003,100000004,100000006]);
 expect(result.excluded[0]?.errors.join("\n")).toContain("preview initial_effect failed");
 expect(result.excluded.some(card=>card.code===12)).toBe(false);
});
it("rejects infrastructure failures instead of falsely excluding an entire pool",async()=>{
 const root=await fixture();await rm(join(root,"card-scripts/utility.lua"));
 await expect(smokePrereleaseScripts(root,[100000001])).rejects.toThrow(/utility.lua/);
});
it("isolates a hanging prerelease and continues checking the remaining cards",async()=>{
 const root=await fixture();await writeFile(join(root,"card-scripts/pre-release/c100000001.lua"),"local s,id=GetID(); function s.initial_effect(c) while true do end end");
 const result=await smokePrereleaseScripts(root,[100000001,100000005],{timeoutMs:1500});
 expect(result.checked).toBe(2);expect(result.excluded).toHaveLength(1);expect(result.excluded[0]?.code).toBe(100000001);expect(result.excluded[0]?.errors.join(" ")).toContain("timed out");
},10000);
it("refuses released codes even if a caller accidentally includes them",async()=>{
 const root=await fixture();await expect(smokePrereleaseScripts(root,[12])).rejects.toThrow(/not.*prerelease/i);
});
