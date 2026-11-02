/** One command, real browser app pipeline, no remote footage or services. */
import {readFile,writeFile,mkdir,readdir,stat,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';import {tmpdir,cpus} from 'node:os';import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';import {chromium} from '@playwright/test';
import {validateSession,type ReplayResult,type Variant} from '../../packages/vision/bench/session';
import {scoreSession,markdownReport} from '../../packages/vision/bench/score';import {sessionServer} from './session/server';
import {compareRuns} from '../../packages/vision/bench/compare';
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2),option=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]??fallback;};
if(args.includes('--help')){console.log('tsx scripts/vision/benchmark-sessions.ts --sessions <folder|session.json> [--variants baseline,efficient] [--backends wasm,webgpu] [--deck both|with|without] [--headed] [--channel chromium|chrome] [--compare previous/results.json] [--out data/vision-session-benchmark] [--no-gate]');process.exit(0);}
const sessionsPath=resolve(option('--sessions',join(root,'data/vision-sessions'))),data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision')),out=resolve(option('--out',join(root,'data/vision-session-benchmark')));
const variants=option('--variants','baseline').split(',') as Variant[],backends=option('--backends','wasm,webgpu').split(',') as ('wasm'|'webgpu')[],deck=option('--deck','both');
if(variants.some(v=>!['baseline','efficient'].includes(v))||backends.some(b=>!['wasm','webgpu'].includes(b))||!['both','with','without'].includes(deck))throw Error('Invalid variant/backend/deck option');
const names=(await stat(sessionsPath)).isDirectory()?(await readdir(sessionsPath)).filter(n=>n.endsWith('.session.json')).sort().map(n=>join(sessionsPath,n)):[sessionsPath];
if(!names.length)throw Error('No labelled sessions. Record and export a .session.json in /dev/vision-lab → Record session.');
const sha=async(file:string)=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const sessions=await Promise.all(names.map(async file=>{const session=validateSession(JSON.parse(await readFile(file,'utf8'))),video=join(dirname(file),session.video);return {file,session,video,labelSha256:await sha(file),videoSha256:await sha(video)};}));
const temp=await mkdtemp(join(tmpdir(),'vision-session-'));
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,server:Awaited<ReturnType<typeof sessionServer>>|undefined;
try {
  await build({entryPoints:[join(root,'packages/vision/bench/browser-entry.ts')],outfile:join(temp,'bench.js'),bundle:true,platform:'browser',format:'esm',target:'es2022'});
  await build({entryPoints:[join(root,'packages/vision/src/worker.ts')],outfile:join(temp,'worker.js'),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true});
  const assets:Record<string,string>={'/bench.js':join(temp,'bench.js'),'/dev/vision-lab/assets/worker.js':join(temp,'worker.js')};sessions.forEach((s,i)=>assets[`/session-${i}.webm`]=s.video);
  server=await sessionServer(data,assets);const {origin}=server;
  browser=await chromium.launch({channel:option('--channel','chromium'),headless:!args.includes('--headed'),args:['--no-sandbox','--disable-background-networking',...(backends.includes('webgpu')?[]:['--disable-gpu'])]});
  const page=await browser.newPage(),pageErrors:string[]=[],blocked:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.addInitScript('window.__name=(v)=>v');
  await page.route('**/*',route=>{const url=route.request().url();if(new URL(url).origin===origin)return route.continue();blocked.push(url);return route.abort();});
  await page.goto(origin);
  const gpu=await page.evaluate(async()=>{const api=await import(/* webpackIgnore: true */String('/bench.js'));return api.hardwareGPU();});
  const cdp=await browser.newBrowserCDPSession();
  const cpu=async()=>{const info=await cdp.send('SystemInfo.getProcessInfo');return info.processInfo.reduce((sum,p)=>sum+p.cpuTime,0);};
  let beforeCpu=0;await page.exposeFunction('benchReady',async()=>{beforeCpu=await cpu();});
  const runs:{sessionId:string;deckMode:string;result:ReplayResult;metrics:ReturnType<typeof scoreSession>;cpuSecondsPerVideoSecond:number;labelSha256:string;videoSha256:string}[]=[],skipped:{backend:string;reason:string}[]=[];
  for(const backend of backends){
    if(backend==='webgpu'&&!gpu.available){skipped.push({backend,reason:gpu.reason??'No hardware adapter'});continue;}
    for(const [i,s] of sessions.entries())for(const variant of variants)for(const withDeck of deck==='both'?[true,false]:[deck==='with']){
      console.log(`Replay ${s.session.id}: ${variant}, ${backend}, ${withDeck?'with':'without'} deck (${(s.session.durationMs/1000).toFixed(1)} s)`);
      const firstError=pageErrors.length;beforeCpu=await cpu();
      let result:ReplayResult;
      try{result=await page.evaluate(async({session,index,variant,backend,withDeck})=>{
        const api=await import(/* webpackIgnore: true */String('/bench.js'));const video=document.querySelector('video')!;
        return api.replaySession(video,session,{variant,backend,deck:withDeck,videoUrl:`/session-${index}.webm`,onReady:()=>((window as any).benchReady())});
      },{session:s.session,index:i,variant,backend,withDeck}) as ReplayResult;
      }catch(e){result={variant,requestedBackend:backend,events:[],detections:[],wallMs:0,warmMs:0,inferenceMs:0,backends:[],runtime:[],stats:{},errors:[String(e)]};}
      const cpuSecondsPerVideoSecond=Math.max(0,await cpu()-beforeCpu)/(s.session.durationMs/1000);
      result.errors.push(...pageErrors.slice(firstError));if(backend==='webgpu'&&!result.backends.includes('webgpu'))result.errors.push('Requested WebGPU fell back to WASM or produced no GPU recognition');
      const metrics=scoreSession(s.session,result);runs.push({sessionId:s.session.id,deckMode:withDeck?'with':'without',result,metrics,cpuSecondsPerVideoSecond,labelSha256:s.labelSha256,videoSha256:s.videoSha256});
      console.log(`  recall ${(metrics.events.recall*100).toFixed(1)}%, top1 ${(metrics.identity.top1*100).toFixed(1)}%, CPU ${cpuSecondsPerVideoSecond.toFixed(3)} s/s; gate ${metrics.gate.passed?'PASS':'FAIL'}`);
    }
  }
  const hashes:Record<string,string>={};for(const relative of ['models/card-detector.onnx','models/dinov2-small-duel.q8.onnx','yugioh-index.bin','yugioh-index.meta.json','yugioh-full-art.bin','yugioh-full-art.meta.json','yugioh-thresholds.json'])try{hashes[relative]=await sha(join(data,relative));}catch{hashes[relative]='absent';}
  for(const file of (await readdir(join(data,'ort'))).filter(n=>/\.(wasm|mjs|js)$/.test(n)))hashes[`ort/${file}`]=await sha(join(data,'ort',file));
  hashes['worker.js']=await sha(join(temp,'worker.js'));hashes['bench.js']=await sha(join(temp,'bench.js'));
  const comparison=args.includes('--compare')?compareRuns(runs,JSON.parse(await readFile(resolve(option('--compare','')),'utf8')).runs):undefined;
  const report={comparison,version:1,createdAt:new Date().toISOString(),gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),gitDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),node:process.version,logicalCores:cpus().length,hashes,gpu,skipped,blockedRequests:blocked,runs,policy:'Unassisted real-time playback. No ground-truth feedback; empty learned-reference snapshot. CPU sums all Chromium process CPU, including decoder and worker threads; model warmup excluded. Experimental modes stay out of the app watcher.',gate:{passed:runs.length>0&&runs.filter(r=>r.deckMode==='with').length>0&&runs.filter(r=>r.deckMode==='with').every(r=>r.metrics.gate.passed)&&!blocked.length&&(!comparison||comparison.passed)}};
  await mkdir(out,{recursive:true});await writeFile(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(out,'summary.md'),markdownReport(report)+`\nGPU probe: ${JSON.stringify(gpu)}. Skipped backends: ${JSON.stringify(skipped)}. Overall gate: ${report.gate.passed?'PASS':'FAIL'}.\n`+(comparison?`\nRegression comparison: ${comparison.passed?'PASS':comparison.reasons.join('; ')}.\n`:''));
  console.log(`Reports: ${join(out,'results.json')} and summary.md. Overall gate: ${report.gate.passed?'PASS':'FAIL'}`);
  if(!args.includes('--no-gate')&&!report.gate.passed)process.exitCode=1;
}finally{await browser?.close();await server?.close();await rm(temp,{recursive:true,force:true});}
