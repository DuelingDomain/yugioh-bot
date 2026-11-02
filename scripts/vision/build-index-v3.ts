/** Same source crops/entries as the current index, with an independent v3 embedding space. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { yugiohDinoV3 } from '../../packages/vision/src/embedders';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { embedImages, type SessionLike, type TensorCtor } from '../../packages/vision/src/embed';
import { buildIndexArtefacts } from '../../packages/vision/src/index-builder';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { layoutKey, validateIndexProfile } from '../../packages/vision/src/profile';
import type { IndexMeta } from '../../packages/vision/src/types';

const {values}=parseArgs({options:{data:{type:'string',default:process.env.VISION_DATA_DIR??'data/vision'},threads:{type:'string',default:String(availableParallelism())}}});
const data=resolve(values.data!), threads=Number(values.threads), start=performance.now();
if(!Number.isInteger(threads)||threads<1||threads>availableParallelism())throw new Error('Invalid CPU thread count');
const profile=yugiohDinoV3(JSON.parse(await readFile(join(data,'models/dinov3-small.json'),'utf8')));
const sourceBytes=await readFile(join(data,'yugioh-index.meta.json'));
const source=JSON.parse(sourceBytes.toString()) as IndexMeta;
validateIndexProfile(source,yugioh);
if(source.count!==14817||source.entries.filter(e=>e.cardId!==yugioh.cardBack.cardId).length!==14816)throw new Error('Expected the full 14,816-artwork source index plus one back');
const model=await readFile(join(data,'models/dinov3-small.q8.onnx'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
if(sha(model)!==profile.embedding.sha256)throw new Error('Model checksum mismatch');
await readFile(join(data,'models/DINOv3-LICENSE.md')); // Never publish weights without the licence.
const session=await ort.InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:threads,interOpNumThreads:1,graphOptimizationLevel:'all'});
const vectors:Float32Array[]=[];
try {
  for(const [i,entry] of source.entries.entries()) {
    // These are the original builder's 224px JPEG crops, without a second crop/resize/re-encode.
    const file=entry.cardId===yugioh.cardBack.cardId?resolve('packages/web/public',yugioh.cardBack.imageUrl.replace(/^\//,'')):join(data,'thumbnails',`${entry.imageId}.jpg`);
    const {data:pixels,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const [v]=await embedImages(session as unknown as SessionLike,ort.Tensor as unknown as TensorCtor,profile.embedding,[{data:pixels,width:info.width,height:info.height}]);
    if(v.length!==384||!v.every(Number.isFinite)||Math.abs(Math.hypot(...v)-1)>.001)throw new Error(`Invalid embedding at ${i}`);
    vectors.push(v);
    if((i+1)%500===0||i+1===source.count)console.log(`${i+1}/${source.count} · ${((performance.now()-start)/1000).toFixed(0)}s · ${threads} CPU threads`);
  }
}finally{await session.release();}
const artifacts=buildIndexArtefacts(source.entries,vectors,{version:1,gameId:profile.id,layoutKey:layoutKey(profile),modelId:profile.embedding.id,modelSha256:profile.embedding.sha256,generatedAt:new Date().toISOString(),catalog:source.catalog});
const meta=JSON.parse(artifacts.metaJson) as IndexMeta;
validateIndexProfile(meta,profile);decodeIndex(Uint8Array.from(artifacts.bin).buffer,meta);
await mkdir(data,{recursive:true});
for(const [name,bytes] of [['yugioh-index-v3.bin',artifacts.bin],['yugioh-index-v3.meta.json',artifacts.metaJson]] as const){await writeFile(join(data,name+'.part'),bytes);await rename(join(data,name+'.part'),join(data,name));}
const report={artworks:14816,cardBacks:1,modelId:profile.embedding.id,modelSha256:profile.embedding.sha256,sourceMetaSha256:sha(sourceBytes),threads,seconds:(performance.now()-start)/1000,bytes:artifacts.bin.length,notes:['Same cached art crops, entry order and int8 index format as DINOv2.','No intermediate image/vector files retained. No fine-tuning.']};
await writeFile(join(data,'yugioh-index-v3.build.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
