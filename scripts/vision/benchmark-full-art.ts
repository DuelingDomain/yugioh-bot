/** Synthetic full-art plumbing check, not an accuracy claim for Konami prints. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {yugioh} from '../../packages/vision/src/games/yugioh';
import {fullArtProfile,detectFullArtLayout} from '../../packages/vision/src/full-art';
import {layoutKey} from '../../packages/vision/src/profile';
import {buildIndexArtefacts} from '../../packages/vision/src/index-builder';
import {decodeIndex} from '../../packages/vision/src/index-format';
import {embedImages,type TensorCtor,type SessionLike} from '../../packages/vision/src/embed';
import {RecognitionPipeline} from '../../packages/vision/src/pipeline';
import type {ModelSession} from '../../packages/vision/src/runtime';
import type {IndexMeta} from '../../packages/vision/src/types';
const out=resolve(process.env.VISION_DATA_DIR??'data/vision'),directory=join(out,'benchmark/full-art');
await mkdir(directory,{recursive:true});
const meta=JSON.parse(await readFile(join(out,'yugioh-index.meta.json'),'utf8')) as IndexMeta;
const bin=await readFile(join(out,'yugioh-index.bin'));
const standard=decodeIndex(bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength),meta);
const detector=await ort.InferenceSession.create(join(out,'models/card-detector.onnx'),{intraOpNumThreads:4,interOpNumThreads:1});
const embedder=await ort.InferenceSession.create(join(out,'models/dinov2-small-duel.q8.onnx'),{intraOpNumThreads:4,interOpNumThreads:1});
const Tensor=ort.Tensor as unknown as TensorCtor;
const adapt=(session:ort.InferenceSession)=>({backend:'wasm',run:session.run.bind(session),release:async()=>{}}) as unknown as ModelSession;
const rgba=async(bytes:Buffer)=>{const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,width:info.width,height:info.height};};
try {
  const entries=['89631139','14558127','23434538'].map(id=>meta.entries.find(e=>e.cardId===id)!);
  const references:Buffer[]=[],vectors:Float32Array[]=[];
  for(const entry of entries) {
    const file=entry.thumbnailUrl!.replace('/dev/vision-assets/','');
    const reference=await sharp(await readFile(join(out,file))).resize(295,430,{fit:'fill'}).jpeg({quality:95}).toBuffer();
    references.push(reference);
    vectors.push((await embedImages(embedder as unknown as SessionLike,Tensor,yugioh.embedding,[await rgba(reference)]))[0]);
  }
  const built=buildIndexArtefacts(entries,vectors,{version:1,gameId:yugioh.id,layoutKey:layoutKey(fullArtProfile(yugioh)),modelId:yugioh.embedding.id,modelSha256:yugioh.embedding.sha256});
  const full=decodeIndex(built.bin.buffer as ArrayBuffer,JSON.parse(built.metaJson));
  const withFull=new RecognitionPipeline(yugioh,standard,adapt(detector),adapt(embedder),Tensor,full);
  const withoutFull=new RecognitionPipeline(yugioh,standard,adapt(detector),adapt(embedder),Tensor);
  const results=[];
  for(let i=0;i<entries.length;i++) for(const condition of ['clean','blur','upside-down']) {
    let reference=sharp(references[i]);
    if(condition==='blur') reference=reference.blur(.8);
    if(condition==='upside-down') reference=reference.rotate(180);
    const card=await reference.resize(268,390).jpeg({quality:85}).toBuffer();
    const scene=await sharp({create:{width:500,height:600,channels:3,background:'#272c35'}}).composite([{input:card,left:116,top:105}]).jpeg({quality:88}).toBuffer();
    const pixels=await rgba(scene);
    const actual=await withFull.recognize([pixels],{clickPoint:{x:.5,y:.5},includeCrop:true});
    const baseline=await withoutFull.recognize([pixels],{clickPoint:{x:.5,y:.5}});
    results.push({expected:entries[i].cardId,name:entries[i].name,condition,top1:actual.candidates[0]?.cardId,correct:actual.candidates[0]?.cardId===entries[i].cardId,baselineCorrect:baseline.candidates[0]?.cardId===entries[i].cardId,tier:actual.tier,quality:actual.quality,layoutOnReference:detectFullArtLayout(await rgba(references[i]),yugioh),cropBytes:actual.warpedCard?.data.length});
  }
  const report={synthetic:true,verifiedRealFullArtImages:0,referenceCards:entries.length,tests:results.length,top1:results.filter(r=>r.correct).length,baselineTop1:results.filter(r=>r.baselineCorrect).length,notes:'Synthetic fixtures stretch existing artwork across the full card; these are NOT official full-art prints. Runs actual detector, warp, both indexes and confidence pipeline against full standard catalog. No AI requests.',results};
  await writeFile(join(directory,'results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await detector.release();await embedder.release();}
