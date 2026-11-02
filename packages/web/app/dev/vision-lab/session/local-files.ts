import type {LabelledSession} from '../../../../../vision/bench/session';
export interface LocalFile {getFile():Promise<File>;createWritable():Promise<{write(data:Blob|string):Promise<void>;close():Promise<void>;abort?():Promise<void>}>}
export interface LocalDirectory {name:string;getDirectoryHandle(name:string,options?:{create:boolean}):Promise<LocalDirectory>;getFileHandle(name:string,options?:{create:boolean}):Promise<LocalFile>}
export async function chooseSessionDirectory():Promise<LocalDirectory> {
  const picker=(window as Window&{showDirectoryPicker?:(options:{mode:string})=>Promise<LocalDirectory>}).showDirectoryPicker;
  if(!picker)throw Error('Use Chrome or Edge on localhost to save directly to your DATA folder.');
  const selected=await picker({mode:'readwrite'});
  return selected.name==='vision-sessions'?selected:selected.getDirectoryHandle('vision-sessions',{create:true});
}
export async function writeLabels(folder:LocalDirectory|undefined,session:LabelledSession) {
  const json=JSON.stringify(session,null,2)+'\n',name=`${session.id}.session.json`;
  if(folder){const stream=await(await folder.getFileHandle(name,{create:true})).createWritable();try{await stream.write(json);await stream.close();}catch(e){await stream.abort?.();throw e;}}
  else {const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
/** Streaming browser-only recorder. No fetch, endpoint, microphone or Blob accumulation. */
export async function recordLocalSession(folder:LocalDirectory,stream:MediaStream,options:{onTick:(ms:number)=>void;onDone:(session:LabelledSession,file:File)=>void;onError:(error:Error)=>void;maxMs?:number}) {
  const id=`vision-${new Date().toISOString().replace(/[:.]/g,'-')}`,name=`${id}.webm`;
  const handle=await folder.getFileHandle(name,{create:true}),output=await handle.createWritable();
  const mimeType=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  if(!mimeType){await output.abort?.();throw Error('This browser cannot record WebM. Use Chrome or Edge.');}
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:3_000_000});
  const started=performance.now(),settings=stream.getVideoTracks()[0].getSettings(),log:LabelledSession['log']=[{atMs:0,type:'recording-started'}];
  let bytes=0,queue=Promise.resolve(),failure:Error|undefined,stopping=false;
  const finished=new Promise<void>(resolve=>{
    recorder.ondataavailable=e=>{if(!e.data.size)return;bytes+=e.data.size;queue=queue.then(()=>output.write(e.data)).catch(cause=>{failure=cause instanceof Error?cause:Error(String(cause));stop('write-error');});if(bytes>=150*1024*1024)stop('size-limit');};
    recorder.onerror=()=>{failure=Error('Camera recording failed');stop('recorder-error');};
    recorder.onstop=()=>{const stoppedAt=performance.now();void(async()=>{
      clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
      try {
        await queue;if(failure)throw failure;await output.close();
        const durationMs=Math.min(300000,stoppedAt-started),session:LabelledSession={version:1,id,source:'real',video:name,durationMs,width:settings.width??1280,height:settings.height??720,decklist:[],format:'normal',reviewed:false,events:[],negatives:[],log,capture:{frameRate:settings.frameRate,mimeType,bytes,createdAt:new Date().toISOString()}};
        await writeLabels(folder,session);options.onDone(session,await handle.getFile());
      }catch(cause){await output.abort?.().catch(()=>{});options.onError(cause instanceof Error?cause:Error(String(cause)));}finally{resolve();}
    })();};
  });
  function stop(reason='stopped-by-owner') {if(stopping)return;stopping=true;log.push({atMs:performance.now()-started,type:reason});if(recorder.state!=='inactive')recorder.stop();}
  const timer=setInterval(()=>{const elapsed=performance.now()-started;options.onTick(elapsed);if(elapsed>=Math.min(300000,options.maxMs??300000))stop('time-limit');},200);
  try{recorder.start(1000);}catch(cause){clearInterval(timer);await output.abort?.();throw cause;}
  return {stop,finished,mark(detail:string){if(log.length<1000)log.push({atMs:performance.now()-started,type:'marker',detail});}};
}
