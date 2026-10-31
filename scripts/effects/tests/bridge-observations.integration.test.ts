import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../../../",import.meta.url));
it("validates the real refresh publisher and preserves large derived samples when old raw fixtures are retained",()=>{
  const directory=mkdtempSync(join(tmpdir(),"bridge-observations-publish-"));
  try {
    const path=join(root,"packages/shared/data/staples");
    copyFileSync(join(path,"usage.json"),join(directory,"candidate.json"));
    copyFileSync(join(path,"decks.json"),join(directory,"decks.json"));
    const env={...process.env,STAPLES_OUTPUT:directory,STAPLES_BASE_SHA:"a".repeat(40)};
    const run=()=>execFileSync(process.execPath,["scripts/staples/publish.mjs","--validate-only"],{cwd:root,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    expect(run()).toContain("Staple candidate validated");
    const artifact=JSON.parse(readFileSync(join(directory,"bridge-observations.json"),"utf8"));
    const committed=JSON.parse(readFileSync(join(path,"bridge-observations.json"),"utf8"));
    expect(artifact.formats).toEqual(committed.formats);
    expect(artifact.formats.tcg.deckCount).toBeGreaterThan(900);
    const lists=JSON.parse(readFileSync(join(directory,"decks.json"),"utf8"));
    lists.tcg=Array(1001).fill(lists.tcg[0]);
    writeFileSync(join(directory,"decks.json"),JSON.stringify(lists));
    expect(run).toThrow(/Invalid evidence format/);
  } finally {rmSync(directory,{recursive:true,force:true});}
},30000);
