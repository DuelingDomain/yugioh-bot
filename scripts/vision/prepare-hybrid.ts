/** Pinned data only. No upstream code is executed. Called by prepare.ts --hybrid. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { buildHybridCatalog } from '../../packages/vision/src/hybrid-catalog';
import { hybridProfiles, HYBRID_ASSETS, duelSightModel, lightModel } from '../../packages/vision/src/hybrid-models';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { layoutKey } from '../../packages/vision/src/profile';
import type { IndexEntry, IndexMeta } from '../../packages/vision/src/types';

const lensRevision='f6968f3682d53a79c4a9fef591300615eda61c11';
const lightRevision='de87d44e2822a25a2dc481a27ed3c2881ce9ad03';
const raw=(revision:string,file:string)=>`https://raw.githubusercontent.com/mathulbrich/duel-lens/${revision}/${file}`;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const sources=[
  {name:'light.onnx',local:'duel-lens-light/dinov2-small-duel-v3b-light.q8.onnx',url:raw(lightRevision,'extension/models/dinov2-small-duel-v3b-light.q8.onnx'),hash:lightModel.sha256},
  {name:'light.bin',local:'duel-lens/extension/data/index-dinov2-small-duel-v3b.bin',url:raw(lensRevision,'extension/data/index-dinov2-small-duel-v3b.bin'),hash:HYBRID_ASSETS.index.sha256},
  {name:'v3b.meta.json',local:'duel-lens/extension/data/index-dinov2-small-duel-v3b.meta.json',url:raw(lensRevision,'extension/data/index-dinov2-small-duel-v3b.meta.json'),hash:'3db72869e5cd8e5fda7aeff969cb96595f152caa840d910e61e6610df51bff55'},
  {name:'cards.json',local:'duel-lens/extension/data/cards.json',url:raw(lensRevision,'extension/data/cards.json'),hash:'9b3dd40140aade141c2a0f7bc89d34e079b4142178dd5d9a4bdd864c7d8762ef'},
];
const sightFiles=[
  {name:'recognizer.onnx',hash:duelSightModel.sha256},
  {name:'bank.bin',hash:HYBRID_ASSETS.bank.sha256},
  {name:'catalog.json',hash:'42c96e83f81258c71f29cc80453cf3deab6cb55102be7ac10ee36d531bd88776'},
];
type SourceCard={id:number|string;name:string;frameType?:string;type?:string;kind?:string;facets?:{frame?:string}};
function entry(card:SourceCard):IndexEntry {
  const frame=card.frameType??card.facets?.frame??'';
  const frameClass=frame.includes('pendulum')?'Pendulum':({normal:'Normal',effect:'Effect',ritual:'Ritual',fusion:'Fusion',synchro:'Synchro',xyz:'Xyz',link:'Link',spell:'Spell',trap:'Trap'} as Record<string,string>)[frame];
  return {cardId:String(card.id),passcode:Number(card.id),name:card.name,frameClass};
}
export async function prepareHybrid(out:string,root:string,localSources?:string) {
  const dest=path.join(out,'hybrid'),cache=path.join(out,'hybrid-sources');
  await mkdir(dest,{recursive:true});await mkdir(cache,{recursive:true});
  async function input(file:string,hash:string,local:string,url?:string):Promise<Buffer> {
    const cached=path.join(cache,file);
    let bytes:Buffer|undefined;
    try {bytes=await readFile(cached);}catch{}
    if(!bytes||sha(bytes)!==hash) {
      if(localSources)bytes=await readFile(path.join(localSources,local));
      else {if(!url)throw new Error(`Missing pinned source ${file}`);const reply=await fetch(url);if(!reply.ok)throw new Error(`Hybrid download ${file}: HTTP ${reply.status}`);bytes=Buffer.from(await reply.arrayBuffer());}
      if(sha(bytes)!==hash)throw new Error(`Hybrid checksum mismatch: ${file}`);
      await writeFile(cached,bytes);
    }
    return bytes;
  }
  for(const s of sources)await input(s.name,s.hash,s.local,s.url);
  if(localSources) {
    for(const s of sightFiles)await input(`sight-${s.name}`,s.hash,`duelsight-built/duelsight-0.8.0/release/${s.name}`);
  } else {
    const zip=await input('duelsight-0.8.0.zip','dd90b32888b9a6a7441937c4281cc057cf736049185088d269c8f2caa296df1c','duelsight-0.8.0.zip','https://github.com/ryangswe/duelsight/releases/download/v0.8.0/duelsight-0.8.0.zip');
    // Python's standard library only. Read named members; never extract or execute the archive.
    for(const s of sightFiles) {
      const bytes=execFileSync(process.env.VISION_PYTHON??'python3',['-c','import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',path.join(cache,'duelsight-0.8.0.zip'),`duelsight-0.8.0/release/${s.name}`],{maxBuffer:32*1024*1024});
      if(sha(bytes)!==s.hash)throw new Error(`Hybrid checksum mismatch: ${s.name}`);
      await writeFile(path.join(cache,`sight-${s.name}`),bytes);
    }
    void zip;
  }
  const lens=JSON.parse(await readFile(path.join(cache,'cards.json'),'utf8')) as {cards:SourceCard[]};
  const sight=JSON.parse(await readFile(path.join(cache,'sight-catalog.json'),'utf8')) as {cards:SourceCard[]};
  const canonical=lens.cards.map(entry),catalog=buildHybridCatalog(canonical,sight.cards.map(entry));
  const v3b=JSON.parse(await readFile(path.join(cache,'v3b.meta.json'),'utf8')) as {dim:number;count:number;builtAt:string;entries:{cardId:number;imageId:number}[]};
  const byId=new Map(canonical.map(e=>[e.cardId,e]));
  const meta:IndexMeta={version:1,gameId:yugioh.id,modelId:lightModel.id,modelSha256:lightModel.sha256,dim:v3b.dim,count:v3b.count,dtype:'int8',builtAt:v3b.builtAt,layoutKey:layoutKey(hybridProfiles(yugioh).second),entries:v3b.entries.map(e=>{
    const found=e.cardId===-1?{cardId:yugioh.cardBack.cardId,passcode:0,name:'Card back'}:byId.get(String(e.cardId));if(!found)throw new Error(`Missing v3b catalog card ${e.cardId}`);return {...found,imageId:e.imageId};
  })};
  const generated=[{name:'catalog.json',data:JSON.stringify(catalog)+'\n',expected:HYBRID_ASSETS.catalog.sha256},{name:'light.meta.json',data:JSON.stringify(meta)+'\n',expected:HYBRID_ASSETS.meta.sha256}];
  for(const f of generated) {
    const bytes=Buffer.from(f.data),digest=sha(bytes);
    if(digest!==f.expected)throw new Error(`Prepared hybrid ${f.name}: SHA-256 ${digest}, expected ${f.expected}`);
    await writeFile(path.join(dest,f.name)+'.part',bytes);await rename(path.join(dest,f.name)+'.part',path.join(dest,f.name));
  }
  for(const [source,name] of [['light.onnx','light.onnx'],['light.bin','light.bin'],['sight-recognizer.onnx','recognizer.onnx'],['sight-bank.bin','bank.bin']])await copyFile(path.join(cache,source),path.join(dest,name));
  for(const file of ['duelsight.LICENSE','duelsight.NOTICE','duelsight.PROVENANCE.md','duel-lens.LICENSE','duel-lens-light.THIRD_PARTY_NOTICES.md'])await copyFile(path.join(root,'packages/vision/src/licenses',file),path.join(dest,file));
}
