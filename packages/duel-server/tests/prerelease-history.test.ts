import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { readPrereleaseHistory } from "../scripts/prerelease-history.js";
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
it("retains every supported pinned preview identity across edits and file deletion, skipping Rush",async()=>{
 const root=mkdtempSync(join(tmpdir(),"preview-history-"));dirs.push(root);
 const git=(args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();
 git(["init","-q"]);
 function cdb(file:string,id:number,name:string){const db=new Database(join(root,file));db.exec("CREATE TABLE IF NOT EXISTS datas(id INTEGER PRIMARY KEY,type INTEGER,ot INTEGER,alias INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS texts(id INTEGER PRIMARY KEY,name TEXT); DELETE FROM datas; DELETE FROM texts");db.prepare("INSERT INTO datas(id,type,ot) VALUES(?,33,257)").run(id);db.prepare("INSERT INTO texts VALUES(?,?)").run(id,name);db.close();}
 function commit(){git(["add","."]);git(["-c","user.name=test","-c","user.email=test@example.test","commit","-qm","snapshot"]);return git(["rev-parse","HEAD"]);}
 cdb("prerelease-a.cdb",100000001,"First preview");cdb("prerelease-cards-rush.cdb",100000099,"Rush");const start=commit();
 cdb("prerelease-a.cdb",100000001,"Updated preview name");cdb("prerelease-new.cdb",100000002,"Later preview");commit();
 rmSync(join(root,"prerelease-a.cdb"));rmSync(join(root,"prerelease-new.cdb"));const current=commit();
 const history=await readPrereleaseHistory(root,start,current,join(root,"history-output"));
 expect(history).toEqual(expect.arrayContaining([{code:100000001,name:"First preview",type:33},{code:100000001,name:"Updated preview name",type:33},{code:100000002,name:"Later preview",type:33}]));
 expect(history).toHaveLength(3);
 expect(await readPrereleaseHistory(root,start,current,join(root,"second-output"))).toEqual(history);
});


it("excludes alternate artworks and tokens from historical identity remaps", async () => {
 const root=mkdtempSync(join(tmpdir(),"preview-history-art-"));dirs.push(root);
 const git=(args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();
 git(["init","-q"]);
 const db=new Database(join(root,"prerelease-imph.cdb"));
 db.exec(`CREATE TABLE datas(id INTEGER PRIMARY KEY,type INTEGER,ot INTEGER,alias INTEGER);
 CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT);
 INSERT INTO datas VALUES(57160136,2,3,0),(57160137,2,3,57160136),(23116809,16401,3,0);
 INSERT INTO texts VALUES(57160136,'Cynet Mining'),(57160137,'Cynet Mining'),(23116809,'Fireball Token');`);db.close();
 git(["add","."]);git(["-c","user.name=test","-c","user.email=test@example.test","commit","-qm","snapshot"]);
 const pin=git(["rev-parse","HEAD"]);
 expect(await readPrereleaseHistory(root,pin,pin,join(root,"output"))).toEqual([{code:57160136,name:"Cynet Mining",type:2}]);
});
