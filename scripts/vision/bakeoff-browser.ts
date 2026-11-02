/** Foreground loopback harness: owner Windows Chrome supplies actual CPU/WebGPU. */
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AddressInfo} from 'node:net';

const args=process.argv.slice(2),value=(name:string,fallback='')=>args.includes(name)?args[args.indexOf(name)+1]??fallback:fallback;
if(args.includes('--help')){console.log('tsx scripts/vision/bakeoff-browser.ts --dir <bakeoff output> [--port 0]');process.exit(0);}
if(!args.includes('--dir'))throw Error('--dir required');
const out=resolve(value('--dir')),here=dirname(fileURLToPath(import.meta.url));
const data=JSON.parse(await readFile(join(out,'data.json'),'utf8')) as {artCache:string;artOffset:number;artBytes:number;gallery:unknown[]};
const frozenRaw=await readFile(join(out,'frozen.json'));
const frozen=JSON.parse(frozenRaw.toString()) as {inputs:Record<string,string>};
// Refuse changed inputs on a later browser rerun; fingerprint before inference.
async function sha(file:string) {const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
for(const [file,expected] of Object.entries(frozen.inputs))if(await sha(file)!==expected)throw Error(`Frozen input changed: ${file}`);
const models=JSON.parse(await readFile(join(out,'models.json'),'utf8')) as {id:string;exports:Record<string,{file:string;sha256:string}>}[];
const files:Record<string,string>={};
for(const name of ['models.json','queries.u8'])files['/'+name]=join(out,name);
for(const model of models){
  for(const exp of Object.values(model.exports)){
    const path=join(out,exp.file);
    if(await sha(path)!==exp.sha256)throw Error(`Changed model export: ${exp.file}`);
    files['/'+exp.file]=path;
  }
  for(const name of ['probe.f32','probe.u8'])files[`/${model.id}/${name}`]=join(out,model.id,name);
}
for(const name of ['bakeoff-page.mjs','bakeoff-metrics.mjs'])files['/'+name]=join(here,'session',name);
const ort=dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')));
const mime:Record<string,string>={'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'};
const page='<!doctype html><meta charset="utf-8"><title>Local embedder bake-off</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}input,button{font:inherit;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Local embedder bake-off</h1><p>Keep this tab visible. Each model builds its gallery before timed crops. GPU absence or unsupported operators are reported explicitly.</p><label>Owner CPU model <input id="cpu" required placeholder="e.g. Ryzen 9 7950X"></label> <button id="run">Run all candidates</button><pre id="status"></pre><pre id="results"></pre><script type="module" src="/bakeoff-page.mjs"></script>';
let closing=false;
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-store');
  try{
    const url=new URL(req.url??'/','http://localhost');
    if(req.method==='POST'&&url.pathname==='/results'){
      if(req.headers.origin!==`http://${req.headers.host}`||closing){res.writeHead(403).end();return;}
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>32*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
      const report=JSON.parse(Buffer.concat(chunks).toString());
      if(report.frozenSha256!==createHash('sha256').update(frozenRaw).digest('hex')||!Array.isArray(report.runs))throw Error('Report fingerprint mismatch');
      // Import plain JS shared with the browser; no model code or network.
      const metrics=await import('./session/bakeoff-metrics.mjs');
      await writeFile(join(out,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
      await writeFile(join(out,'browser-summary.md'),metrics.markdown(report));
      closing=true;res.end('saved');
      console.log(`Saved ${out}/browser-summary.md; complete=${report.complete}, zeroWrong=${report.zeroWrong}`);
      process.exitCode=report.complete&&report.zeroWrong?0:2;
      res.on('finish',()=>{server.close();server.closeIdleConnections();});return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
    if(url.pathname==='/data.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...data,artCache:undefined}));return;}
    if(url.pathname==='/frozen-info.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({sha256:createHash('sha256').update(frozenRaw).digest('hex'),inputs:frozen.inputs}));return;}
    let file=files[url.pathname],start=0,end:number|undefined;
    if(url.pathname==='/gallery'){
      const first=Number(url.searchParams.get('start')),count=Number(url.searchParams.get('count'));
      if(!Number.isInteger(first)||!Number.isInteger(count)||first<0||count<1||count>32||first+count>data.gallery.length)throw Error('Invalid gallery range');
      file=data.artCache;start=data.artOffset+first*224*224*3;end=start+count*224*224*3-1;
    }else if(/^\/ort\/[a-zA-Z0-9_.-]+$/.test(url.pathname))file=join(ort,url.pathname.slice(5));
    if(!file){res.writeHead(404).end();return;}
    const info=await stat(file);if(!info.isFile())throw Error('not file');
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');
    res.setHeader('Content-Length',(end??info.size-1)-start+1);
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){console.error(String(error));if(!res.headersSent)res.writeHead(400);res.end();}
});
await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(Number(value('--port','0')),'127.0.0.1',done);});
console.log(`PID ${process.pid}; owner Windows Chrome: http://localhost:${(server.address() as AddressInfo).port}/`);
console.log('Waiting in foreground. Ctrl-C stops only this owned server; otherwise it exits after saving results.');
process.on('SIGINT',()=>{server.close();server.closeAllConnections();});
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});
