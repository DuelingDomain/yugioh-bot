import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { readPrereleaseHistory } from "../scripts/prerelease-history.js";
const dirs:string[]=[];
afterEach(()=>{dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));vi.unstubAllEnvs();});
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
 expect(history).toEqual(expect.arrayContaining([{code:100000001,name:"First preview",type:33,alias:0},{code:100000001,name:"Updated preview name",type:33,alias:0},{code:100000002,name:"Later preview",type:33,alias:0}]));
 expect(history).toHaveLength(3);
 expect(await readPrereleaseHistory(root,start,current,join(root,"second-output"))).toEqual(history);
});


it("retains alternate artwork aliases in history while excluding tokens", async () => {
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
 expect(await readPrereleaseHistory(root,pin,pin,join(root,"output"))).toEqual([
  {code:57160136,name:"Cynet Mining",type:2,alias:0},
  {code:57160137,name:"Cynet Mining",type:2,alias:57160136},
 ]);
});


it("downloads historical database blobs in a single partial-clone fetch", async () => {
 const root=mkdtempSync(join(tmpdir(),"preview-history-batch-"));dirs.push(root);
 const upstream=join(root,"upstream"),repo=join(root,"partial"),trace=join(root,"packets.log");
 execFileSync("git",["init","-q",upstream]);
 const git=(args:string[])=>execFileSync("git",["-C",upstream,...args],{encoding:"utf8"}).trim();
 git(["config","uploadpack.allowFilter","true"]);git(["config","uploadpack.allowAnySHA1InWant","true"]);
 const pins:string[]=[];
 for(let i=0;i<5;i++) {
  const db=new Database(join(upstream,"prerelease-a.cdb"));
  db.exec("CREATE TABLE IF NOT EXISTS datas(id INTEGER PRIMARY KEY,type INTEGER,ot INTEGER,alias INTEGER); CREATE TABLE IF NOT EXISTS texts(id INTEGER PRIMARY KEY,name TEXT); DELETE FROM datas; DELETE FROM texts");
  db.prepare("INSERT INTO datas VALUES(?,33,257,0)").run(100000001+i);
  db.prepare("INSERT INTO texts VALUES(?,?)").run(100000001+i,`Preview ${i}`);db.close();
  git(["add","."]);git(["-c","user.name=test","-c","user.email=test@example.test","commit","-qm","snapshot"]);
  pins.push(git(["rev-parse","HEAD"]));
 }
 execFileSync("git",["clone","--filter=blob:none","--no-checkout",`file://${upstream}`,repo],{stdio:"pipe"});
 vi.stubEnv("GIT_TRACE_PACKET",trace);
 const history=await readPrereleaseHistory(repo,pins[0]!,pins[4]!,join(root,"output"));
 expect(history).toHaveLength(5);
 expect(readFileSync(trace,"utf8").match(/fetch> command=fetch/g)).toHaveLength(1);
});

it("includes previews on a merged branch even when the merge restores the original file", async () => {
 const root=mkdtempSync(join(tmpdir(),"preview-history-merge-"));dirs.push(root);
 const git=(args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();
 git(["init","-q","-b","main"]);git(["config","user.name","test"]);git(["config","user.email","test@example.test"]);
 const path=join(root,"prerelease-a.cdb");
 const db=new Database(path);
 db.exec("CREATE TABLE datas(id INTEGER PRIMARY KEY,type INTEGER,ot INTEGER,alias INTEGER); CREATE TABLE texts(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO datas VALUES(100000001,33,257,0); INSERT INTO texts VALUES(100000001,'First')");db.close();
 git(["add","."]);git(["commit","-qm","first"]);const start=git(["rev-parse","HEAD"]);
 git(["checkout","-qb","side"]);
 const side=new Database(path);side.exec("UPDATE texts SET name='Side preview'");side.close();
 git(["add","."]);git(["commit","-qm","side preview"]);
 git(["checkout","-q","main"]);git(["merge","--no-ff","-s","ours","side","-qm","restore first preview"]);
 const current=git(["rev-parse","HEAD"]);
 expect(await readPrereleaseHistory(root,start,current,join(root,"output"))).toEqual([
  {code:100000001,name:"First",type:33,alias:0},{code:100000001,name:"Side preview",type:33,alias:0},
 ]);
});
