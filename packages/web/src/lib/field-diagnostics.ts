import {mkdir,readdir,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import sharp from 'sharp';

const MAX_SAMPLES=24,MAX_JPEG=32*1024;
let writes:Promise<unknown>=Promise.resolve();
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max;
/** Loopback URL and same-origin POST are both required, even for an owner. */
export function localFieldDiagnosticRequest(request:Request):boolean {
  const url=new URL(request.url);
  return ['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&request.headers.get('origin')===url.origin;
}
export async function saveFieldDiagnostic(input:unknown):Promise<void> {
  if(!object(input)||!text(input.jpegBase64,Math.ceil(MAX_JPEG/3)*4)||!['sure','not sure','low match'].includes(String(input.tier))||!text(input.reason,64)||!text(input.zone,20)||!Array.isArray(input.top5)||input.top5.length>5||!input.top5.every(c=>object(c)&&text(c.cardId,100)&&text(c.name,200)&&typeof c.score==='number'&&Number.isFinite(c.score)&&Math.abs(c.score)<=2))throw new Error('invalid_diagnostic');
  const encoded=input.jpegBase64 as string;
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('invalid_diagnostic');
  const jpeg=Buffer.from(encoded,'base64');
  if(jpeg.length>MAX_JPEG||jpeg[0]!==255||jpeg[1]!==216||jpeg.at(-2)!==255||jpeg.at(-1)!==217)throw new Error('invalid_diagnostic');
  try{
    const decoder=sharp(jpeg,{limitInputPixels:224*384,failOn:'warning'}),meta=await decoder.metadata();
    if(meta.format!=='jpeg'||!meta.width||!meta.height||meta.width>224||meta.height>384||meta.width<16||meta.height<16)throw new Error('invalid');
    await decoder.raw().toBuffer();
  }catch{throw new Error('invalid_diagnostic');}
  const scalars=(v:unknown)=>object(v)?Object.fromEntries(Object.entries(v).filter(([key,value])=>key.length<=40&&(['boolean','number'].includes(typeof value)||typeof value==='string'&&value.length<=80)).slice(0,24)):{};
  const metadata={at:new Date().toISOString(),tier:input.tier,reason:input.reason,zone:input.zone,top5:input.top5.map(c=>({cardId:c.cardId,name:c.name,score:c.score})),quality:scalars(input.quality),timingsMs:scalars(input.timingsMs)};
  const directory=resolve(process.env.VISION_DATA_DIR??join(process.cwd(),'../../data/vision'),'diagnostics/field');
  const task=writes.then(async()=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    const id=`${Date.now()}-${randomUUID()}`,crop=`${id}.jpg`;
    await writeFile(join(directory,crop),jpeg,{mode:0o600});
    try{await writeFile(join(directory,`${id}.json`),JSON.stringify({...metadata,crop},null,2)+'\n',{mode:0o600});}catch(error){await unlink(join(directory,crop)).catch(()=>{});throw error;}
    const records=[...new Set((await readdir(directory)).filter(file=>/^\d+-[a-f0-9-]+\.(?:json|jpg)$/.test(file)).map(file=>file.replace(/\.(?:json|jpg)$/,'')))].sort();
    for(const id of records.slice(0,-MAX_SAMPLES)){
      // Fixed names in this directory; never follow a stored/user-supplied path.
      await unlink(join(directory,`${id}.json`)).catch(()=>{});await unlink(join(directory,`${id}.jpg`)).catch(()=>{});
    }
  });
  writes=task.catch(()=>{});await task;
}
