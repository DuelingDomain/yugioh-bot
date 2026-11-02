/** Export actual pipeline tensors from the existing offline corpus for model parity/calibration. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {RecognitionPipeline} from '../../packages/vision/src/pipeline';
import {decodeIndex} from '../../packages/vision/src/index-format';
import {yugioh} from '../../packages/vision/src/games/yugioh';
import {detect} from '../../packages/vision/src/detector/run';
import {polygonIou} from '../../packages/vision/src/geometry';
import {toModelInput} from '../../packages/vision/src/detector/preprocess';
import type {ModelSession} from '../../packages/vision/src/runtime';
import type {TensorCtor} from '../../packages/vision/src/embed';
const data=resolve(process.env.VISION_DATA_DIR??'data/vision'),out=join(data,'model-inputs');await mkdir(out,{recursive:true});
const binary=await readFile(join(data,'yugioh-index.bin'));
const index=decodeIndex(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength) as ArrayBuffer,JSON.parse(await readFile(join(data,'yugioh-index.meta.json'),'utf8')));
const manifest:{embed:{file:string;shape:readonly number[]}[];detect:{file:string;shape:number[]}[]}={embed:[],detect:[]};
const sessions:ort.InferenceSession[]=[];
async function session(file:string,record=false):Promise<ModelSession> {
  const s=await ort.InferenceSession.create(join(data,'models',file),{intraOpNumThreads:2});sessions.push(s);
  return {backend:'wasm',release:()=>s.release(),async run(feeds:any){
    if(record) {const tensor=feeds.pixel_values as ort.Tensor,file=`embed-${manifest.embed.length}.bin`;await writeFile(join(out,file),Buffer.from((tensor.data as Float32Array).buffer));manifest.embed.push({file,shape:tensor.dims});}
    return s.run(feeds) as any;
  }};
}
try {
  const pipeline=new RecognitionPipeline(yugioh,index,await session('card-detector.onnx'),await session('dinov2-small-duel.q8.onnx',true),ort.Tensor as unknown as TensorCtor);
  const photos=JSON.parse(await readFile(join(data,'benchmark/photos.json'),'utf8'));
  for(const photo of photos) {
    const {data:pixels,info}=await sharp(join(data,'benchmark',photo.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const image={data:new Uint8ClampedArray(pixels),width:info.width,height:info.height};
    if(process.argv.includes('--compare-detector'))continue;
    const input=toModelInput(image,{longSide:448,align:32,fill:114}),file=`detect-${manifest.detect.length}.bin`;
    await writeFile(join(out,file),Buffer.from(input.data.buffer));manifest.detect.push({file,shape:[1,3,input.height,input.width]});
    await pipeline.recognize([image],{clickPoint:photo.clickPoint});
  }
  if(process.argv.includes('--compare-detector')) {
    const baseline=await session('card-detector.onnx'),variants=await Promise.all(['card-detector.fp16.onnx','card-detector.qdq.onnx'].map(async file=>({file,session:await session(file)})));
    const rows=[];
    for(const photo of photos) {
      const {data:pixels,info}=await sharp(join(data,'benchmark',photo.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const image={data:new Uint8ClampedArray(pixels),width:info.width,height:info.height};
      const before=await detect(baseline,ort.Tensor as unknown as TensorCtor,image,448);
      const results=[];
      for(const v of variants) {
        const after=await detect(v.session,ort.Tensor as unknown as TensorCtor,image,448);
        const ious=before.map(a=>Math.max(0,...after.filter(b=>a.kind===b.kind).map(b=>polygonIou(a.pts.map(([x,y])=>({x,y})),b.pts.map(([x,y])=>({x,y}))))));
        results.push({file:v.file,count:after.length,matched:ious.filter(i=>i>=.8).length,minIoU:Math.min(...ious)});
      }
      rows.push({photo:photo.file,calibration:Number(photo.file.match(/\d+/)?.[0])%2===0,before:before.length,results});
    }
    await writeFile(join(data,'benchmark/detector-variants.json'),JSON.stringify(rows,null,2)+'\n');console.log(rows);
    process.exitCode=0;
  } else await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');if(!process.argv.includes('--compare-detector'))console.log({embed:manifest.embed.length,detect:manifest.detect.length});
}finally {await Promise.all(sessions.map(s=>s.release()));}
