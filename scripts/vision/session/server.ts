import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat,readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import type {AddressInfo} from 'node:net';
/** Loopback, ephemeral port; no app server and no upload handler. Range video
 * reads are necessary for scrubbing WebM/MP4 without loading the file into RAM. */
export async function sessionServer(data:string,assets:Record<string,string>) {
  const mime:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.onnx':'application/octet-stream','.bin':'application/octet-stream','.webm':'video/webm','.mp4':'video/mp4','.jpg':'image/jpeg'};
  const server=createServer(async(req,res)=>{
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url??'/','http://localhost'),path=decodeURIComponent(url.pathname);
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local session replay</title><video muted playsinline style="width:640px"></video>');return;}
    if(path==='/api/remote-vision/learning'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:'offline-empty',references:[],confusions:[]}));return;}
    let file=assets[path];
    if(!file&&/^\/dev\/(vision-assets|vision-lab\/assets)\//.test(path)){
      const relative=path.replace(/^\/dev\/(vision-assets|vision-lab\/assets)\//,'');const candidate=resolve(data,relative);
      if(candidate.startsWith(resolve(data)+sep)&&!relative.includes('..'))file=candidate;
    }
    if(!file){res.writeHead(404).end();return;}
    try {
      const info=await stat(file);if(!info.isFile())throw Error('not a file');
      res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('Accept-Ranges','bytes');
      let start=0,end=info.size-1;
      if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416).end();return;}start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}
      res.setHeader('Content-Length',end-start+1);if(req.method==='HEAD'){res.end();return;}
      const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);res.on('close',()=>stream.destroy());
    }catch{res.writeHead(404).end();}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  return {origin:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,close:()=>new Promise<void>(done=>{server.close(()=>done());server.closeAllConnections();})};
}
