/** Local realset import + raw-decision replay. No API calls, model runs or training. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import {replayTier} from '../../packages/vision/src/decision';
import {realsetMetrics,tuneThresholds,type RealsetSample,type RealsetExport} from '../../packages/vision/src/calibration';
import type {ThresholdConfig} from '../../packages/vision/src/threshold-config';
const {values}=parseArgs({options:{input:{type:'string',multiple:true},out:{type:'string'},'import-dir':{type:'string'},gap:{type:'string',default:'.01'}}});
if(!values.input?.length)throw new Error('Use --input vision-realset.json [--import-dir data/vision/realset] [--out data/vision/yugioh-thresholds.json] [--gap .01]');
const inputBytes=await Promise.all(values.input.map(file=>readFile(resolve(file))));
if(inputBytes.reduce((sum,b)=>sum+b.length,0)>256*1024*1024)throw new Error('Realset exports exceed 256 MiB; import smaller batches');
const exports=inputBytes.map(bytes=>JSON.parse(bytes.toString()) as RealsetExport);
if(exports.some(parsed=>parsed.version!==1 || !Array.isArray(parsed.samples)))throw new Error('Invalid realset export');
let previous:RealsetSample[]=[];
if(values['import-dir']) {
  try {const manifest=JSON.parse(await readFile(join(resolve(values['import-dir']),'manifest.json'),'utf8'));if(manifest.version!==1 || !Array.isArray(manifest.samples))throw new Error('Invalid existing manifest');previous=manifest.samples;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
const previousIds=new Set(previous.map(s=>s.id));
const incoming=exports.flatMap(parsed=>parsed.samples);
if(previous.length+incoming.length>1000)throw new Error('Realset exceeds 1000 samples');
const parsed={samples:[...previous,...incoming] as (RealsetSample & {jpegBase64?:string})[]};
const samples:RealsetSample[]=[],ids=new Set<string>();
for(const s of parsed.samples) {
  if(!s || !/^[a-zA-Z0-9-]{1,80}$/.test(s.id) || ids.has(s.id) || (s.label!==null && (typeof s.label!=='string' || !/^\d+$/.test(s.label))) || typeof s.condition!=='string' || !s.raw || !Array.isArray(s.raw.visual) || !Array.isArray(s.raw.frames) || !Array.isArray(s.raw.blocked))throw new Error('Invalid or duplicate sample/label/evidence');
  ids.add(s.id);
  const lists=[s.raw.visual,...s.raw.frames.flatMap(f=>[f.clean,f.ranked,f.deck,...(f.hypotheses??[])])];
  if(lists.some(list=>!Array.isArray(list)||list.length>100||list.some(c=>typeof c.cardId!=='string'||!Number.isFinite(c.score)||c.score< -1||c.score>1)))throw new Error('Invalid raw candidates');
  if(replayTier(s.raw,s.raw.thresholds)!==s.tier)throw new Error(`Recorded tier cannot be replayed: ${s.id}`);
  const {jpegBase64,...sample}=s;
  if(values['import-dir'] && !previousIds.has(s.id))sample.file=`${s.id}.jpg`;
  samples.push(sample);
}
const identity=(s:RealsetSample)=>JSON.stringify([s.raw.modelId,s.raw.modelSha256,s.raw.indexVersion,s.raw.layoutKey]);
if(new Set(samples.map(identity)).size!==1)throw new Error('Do not mix models/indexes/layouts in one calibration');
const tuned=tuneThresholds(samples,Number(values.gap)),first=samples[0].raw;
const config:ThresholdConfig={version:1,modelId:first.modelId,modelSha256:first.modelSha256,indexVersion:first.indexVersion,layoutKey:first.layoutKey,thresholds:tuned.thresholds,sampleCount:samples.length,negativeCount:tuned.metrics.negatives,sureButWrong:0,safetyGap:tuned.safetyGap};
const groups=(key:(s:RealsetSample)=>string)=>[...new Set(samples.map(key))].map(group=>({group,...realsetMetrics(samples.filter(s=>key(s)===group),config.thresholds)}));
const report={generatedAt:new Date().toISOString(),corpusSha256:createHash('sha256').update(JSON.stringify(samples)).digest('hex'),config,before:realsetMetrics(samples,first.thresholds),after:tuned.metrics,
  byCondition:groups(s=>s.condition),byWidth:groups(s=>s.cardWidthPx===null?'unknown':s.cardWidthPx<100?'<100':s.cardWidthPx<150?'100–149':'150+'),byDeck:groups(s=>!s.raw.priors?.decklist?.length?'no deck':s.label===null?'negative':s.raw.priors.decklist.includes(s.label)?'in deck':'off deck'),
  caveat:'Zero wrong sure on this finite labelled replay set, including a safety gap on wrong crop/frame decisions; not a population guarantee. Re-evaluate fresh captures after applying thresholds. No training.'};
if(values['import-dir'])for(const s of incoming) {const {jpegBase64}=s;
  if(!previousIds.has(s.id)) {
    if(typeof jpegBase64!=='string' || jpegBase64.length>8*1024*1024)throw new Error('Missing/oversized frame JPEG');
    const jpeg=Buffer.from(jpegBase64,'base64');
    const image=sharp(jpeg,{limitInputPixels:16_000_000});const info=await image.metadata();
    if(info.format!=='jpeg' || info.width!==s.width || info.height!==s.height)throw new Error('Frame dimensions do not match evidence');
    await image.raw().toBuffer();
    await mkdir(resolve(values['import-dir']),{recursive:true});
    const file=`${s.id}.jpg`;
    await writeFile(join(resolve(values['import-dir']),file),jpeg,{flag:'wx'});
  }
}
if(values['import-dir'])await writeFile(join(resolve(values['import-dir']),'manifest.json'),JSON.stringify({version:1,samples},null,2));
if(values.out) {const out=resolve(values.out);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(config,null,2)+'\n');await writeFile(out.replace(/\.json$/,'')+'.report.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
