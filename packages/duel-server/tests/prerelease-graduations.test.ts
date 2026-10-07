import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { matchGraduations, parseRemapOverrides } from "../scripts/prerelease-graduations.js";
import type { CardIdentity } from "../scripts/prerelease-history.js";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/prerelease-graduations.json", import.meta.url), "utf8")) as {
 databaseCommit:string; examples:Array<{before:CardIdentity;after:CardIdentity;scriptBeforeSha256:string;scriptAfterSha256:string}>;
};
const transition = () => ({ commit:fixture.databaseCommit, removed:fixture.examples.map(x=>x.before), added:fixture.examples.map(x=>x.after) });
it("matches real BETB renamed graduations with equal stats and self-name-normalized text",()=>{
 const result=matchGraduations([transition()]);
 expect(result.remaps).toEqual({101402001:77482666,101402002:4881365,101402021:25158975});
 expect(result.unmatched).toEqual([]);
 for(const example of fixture.examples) expect(example.scriptBeforeSha256).toBe(example.scriptAfterSha256);
});
it("permits changed numeric card type when independent signals agree",()=>{
 const pair=fixture.examples[0]!;
 const result=matchGraduations([{commit:"type-correction",removed:[pair.before],added:[{...pair.after,type:pair.after.type|0x100000}]}]);
 expect(result.remaps).toEqual({[pair.before.code]:pair.after.code});
});
it("does not guess on equal stats alone or blank/short effect text",()=>{
 const pair=fixture.examples[0]!;
 for(const description of ["", "different effect", "Draw 1 card."]){
  const old=description==="Draw 1 card."?{...pair.before,description}:pair.before;
  const result=matchGraduations([{commit:"uncertain",removed:[old],added:[{...pair.after,description}]}]);
  expect(result.remaps).toEqual({});expect(result.unmatched[0]?.code).toBe(old.code);
 }
});
it("requires exact race without loss of 64-bit precision and all stats",()=>{
 const pair=fixture.examples[0]!;
 for(const edit of [{race:"9223372036854775807"},{atk:999},{attribute:0},{level:5},{def:0},{race:undefined}]){
  expect(matchGraduations([{commit:"unrelated",removed:[pair.before],added:[{...pair.after,...edit}]}]).remaps).toEqual({});
 }
});
it("rejects one-to-many and many-to-one evidence, including contradictions across bumps",()=>{
 const pair=fixture.examples[0]!;
 const duplicate={...pair.after,code:123};
 expect(matchGraduations([{commit:"ambiguous",removed:[pair.before],added:[pair.after,duplicate]}]).remaps).toEqual({});
 expect(matchGraduations([{commit:"ambiguous",removed:[pair.before,{...pair.before,code:100000099}],added:[pair.after]}]).remaps).toEqual({});
 const result=matchGraduations([{commit:"first",removed:[pair.before],added:[pair.after]},{commit:"second",removed:[pair.before],added:[duplicate]}]);
 expect(result.remaps).toEqual({});expect(result.unmatched).toHaveLength(1);
});
it("only matches rows from the same bump, never main-to-artwork or token",()=>{
 const pair=fixture.examples[0]!;
 expect(matchGraduations([{commit:"withdrawal",removed:[pair.before],added:[]},{commit:"later",removed:[],added:[pair.after]}]).remaps).toEqual({});
 for(const after of [{...pair.after,alias:456},{...pair.after,type:pair.after.type|0x4000}]) expect(matchGraduations([{commit:"art",removed:[pair.before],added:[after]}]).remaps).toEqual({});
});
it("parses a small old-code-to-new-code override file and rejects malformed/self maps",()=>{
 expect(parseRemapOverrides('{"101402001":77482666}\n')).toEqual({101402001:77482666});
 for(const bytes of ['[]','null','{"old":12}','{"101402001":"77482666"}','{"12":12}','{"0":12}','{"12":4294967296}']) expect(()=>parseRemapOverrides(bytes)).toThrow(/override/i);
});
it("never substitutes a self-name substring inside another referenced card's name",()=>{
 const pair=fixture.examples[0]!;
 const before={...pair.before,name:"Warrior",description:'You can add 1 "Ancient Warrior" from your Deck to your hand. You can only use this effect once per turn.'};
 const after={...pair.after,name:"Knight",description:'You can add 1 "Ancient Knight" from your Deck to your hand. You can only use this effect once per turn.'};
 expect(matchGraduations([{commit:"unrelated",removed:[before],added:[after]}]).remaps).toEqual({});
});
