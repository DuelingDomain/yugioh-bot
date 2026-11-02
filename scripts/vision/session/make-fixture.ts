/** Small reproducible canvas/WebM fixture; explicitly synthetic, never real accuracy. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {sessionServer} from './server';
import type {LabelledSession,Box} from '../../../packages/vision/bench/session';
const root=resolve(import.meta.dirname,'../../..'),out=resolve(process.argv[2]??join(root,'data/vision-session-fixture'));
const data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision'));
const server=await sessionServer(data,{'/card.jpg':join(resolve(process.env.VISION_WEBCAM_CARDS??join(root,'data/card-images')),'89631139-small.jpg')});
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox','--disable-gpu']});
try{
  const page=await browser.newPage();await page.addInitScript('window.__name=(v)=>v');await page.goto(server.origin);
  const encoded=await page.evaluate(async()=>{
    const image=new Image();image.src='/card.jpg';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;document.body.append(canvas);
    const ctx=canvas.getContext('2d')!,stream=canvas.captureStream(24),parts:Blob[]=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2_000_000});
    const done=new Promise<Blob>(resolve=>{recorder.ondataavailable=e=>parts.push(e.data);recorder.onstop=()=>resolve(new Blob(parts,{type:'video/webm'}));});
    let start=performance.now();
    function draw(){const ms=performance.now()-start;ctx.fillStyle='#16191b';ctx.fillRect(0,0,640,480);
      if(ms>=500&&ms<10500){ctx.save();ctx.translate((ms<4500?.372:.628)*640,.4*480);if(ms>=7500)ctx.rotate(Math.PI/2);ctx.drawImage(image,-48,-70,96,140);ctx.restore();}
      if(ms>=12500){ctx.fillStyle='#b87e5d';ctx.beginPath();ctx.ellipse(130,300,60,110,.3,0,Math.PI*2);ctx.fill();}
    }
    draw();recorder.start(500);const timer=setInterval(draw,1000/24);await new Promise(done=>setTimeout(done,18000));recorder.stop();clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
    return await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve((reader.result as string).split(',')[1]);void done.then(blob=>reader.readAsDataURL(blob));});
  });
  const box=(cx:number,def=false):Box=>({x:cx-(def?70:48)/640,y:.4-(def?48:70)/480,w:(def?140:96)/640,h:(def?96:140)/480});
  const session:LabelledSession={version:1,id:'synthetic-lifecycle',source:'synthetic',video:'synthetic-lifecycle.webm',durationMs:18000,width:640,height:480,decklist:['89631139'],format:'normal',reviewed:true,
    events:[{id:'p',atMs:500,kind:'placed',zone:'M2',box:box(.372)},{id:'m',atMs:4500,kind:'moved',zone:'M4',box:box(.628)},{id:'d',atMs:7500,kind:'defense',zone:'M4',position:'defense',box:box(.628,true)},{id:'r',atMs:10500,kind:'removed',zone:'GY',box:box(.628,true)}].map(e=>({...e,instanceId:'copy-1',cardId:'89631139',reviewed:true})) as LabelledSession['events'],
    detectorFrames:[{atMs:2500,cards:[{instanceId:'copy-1',box:box(.372)}],reviewed:true},{atMs:6500,cards:[{instanceId:'copy-1',box:box(.628)}],reviewed:true},{atMs:9000,cards:[{instanceId:'copy-1',box:box(.628,true)}],reviewed:true},{atMs:16000,cards:[],reviewed:true}],negatives:[{startMs:12500,endMs:18000,kind:'hands'}],log:[{atMs:0,type:'synthetic-fixture',detail:'Clean reference composited on plain pad; approximate canvas hand; not physical camera footage.'}]};
  await mkdir(out,{recursive:true});await writeFile(join(out,session.video),Buffer.from(encoded,'base64'));await writeFile(join(out,`${session.id}.session.json`),JSON.stringify(session,null,2)+'\n');console.log(`Synthetic fixture: ${out}`);
}finally{await browser.close();await server.close();}
