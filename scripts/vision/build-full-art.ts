/** Whole-card reference index. Explicit print provenance, no inferred rarity labels. */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { fullArtProfile } from '../../packages/vision/src/full-art';
import { layoutKey } from '../../packages/vision/src/profile';
import { embedImages, type SessionLike, type TensorCtor } from '../../packages/vision/src/embed';
import { buildIndexArtefacts } from '../../packages/vision/src/index-builder';
import type { IndexEntry, IndexMeta } from '../../packages/vision/src/types';
const {values}=parseArgs({options:{manifest:{type:'string',default:'scripts/vision/full-art-prints.json'},output:{type:'string',default:process.env.VISION_DATA_DIR ?? 'data/vision'}}});
const output=resolve(values.output!), manifestPath=resolve(values.manifest!);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
if(manifest.version!==1 || !Array.isArray(manifest.prints)) throw new Error('Invalid full-art print manifest');
const standard=JSON.parse(await readFile(join(output,'yugioh-index.meta.json'),'utf8')) as IndexMeta;
const entries:IndexEntry[]=[],vectors:Float32Array[]=[],sources:unknown[]=[],seen=new Set<string>();
await mkdir(output,{recursive:true});
let session:ort.InferenceSession|undefined;
try {
  if(manifest.prints.length) {
    const model=await readFile(join(output,'models/dinov2-small-duel.q8.onnx'));
    if(createHash('sha256').update(model).digest('hex')!==yugioh.embedding.sha256) throw new Error('Model checksum mismatch');
    session=await ort.InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:4,interOpNumThreads:1});
  }
  for(const print of manifest.prints) {
    if(typeof print.cardId!=='string' || typeof print.printId!=='string' || !print.printId || typeof print.imagePath!=='string' || typeof print.source!=='string' || !/^https:\/\//.test(print.source) || seen.has(print.printId)) throw new Error('Invalid or duplicate verified print');
    seen.add(print.printId);
    const entry=standard.entries.find(e=>e.cardId===print.cardId);
    if(!entry || entry.cardId===yugioh.cardBack.cardId) throw new Error('Print absent from card index');
    const bytes=await readFile(resolve(dirname(manifestPath),print.imagePath));
    const {data,info}=await sharp(bytes,{limitInputPixels:16_000_000}).rotate().resize(295,430,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const [vector]=await embedImages(session! as unknown as SessionLike,ort.Tensor as unknown as TensorCtor,yugioh.embedding,[{data,width:info.width,height:info.height}]);
    entries.push({...entry}); vectors.push(vector);
    sources.push({cardId:entry.cardId,printId:print.printId,source:print.source,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  if(vectors.length) {
    const artefacts=buildIndexArtefacts(entries,vectors,{version:1,gameId:yugioh.id,layoutKey:layoutKey(fullArtProfile(yugioh)),modelId:yugioh.embedding.id,modelSha256:yugioh.embedding.sha256,generatedAt:new Date().toISOString()});
    await writeFile(join(output,'yugioh-full-art.bin'),artefacts.bin);
    await writeFile(join(output,'yugioh-full-art.meta.json'),artefacts.metaJson);
  } else {
    await rm(join(output,'yugioh-full-art.meta.json'),{force:true});
    await rm(join(output,'yugioh-full-art.bin'),{force:true});
  }
  const report={generatedAt:new Date().toISOString(),verifiedPrintsWithImages:entries.length,uniqueCards:new Set(entries.map(e=>e.cardId)).size,manifest:values.manifest,sources,notes:manifest.notes,fallback:entries.length?'standard + whole-card hypotheses':'No verified full-art images: use manual name correction or optional owner-enabled Haiku name OCR; no real-print accuracy claim.'};
  await writeFile(join(output,'yugioh-full-art.build.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await session?.release();}
