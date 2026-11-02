import type {FieldEvent} from '@yugidraft/vision';

/** Owner-machine debugging only. No frames, AI request or external upload. */
export async function saveLocalFieldDiagnostic(event:FieldEvent,entries:ReadonlyMap<string,{cardId:string;passcode:number;name:string}>):Promise<void> {
  if(typeof window==='undefined'||!['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)||!event.result?.cropJpeg||event.track.faceDown)return;
  const result=event.result;
  try{
    await fetch('/api/remote-vision/diagnostics',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(3000),body:JSON.stringify({
      jpegBase64:result.cropJpeg,tier:result.tier,reason:event.reason??event.type,zone:event.track.zone,
      top5:result.candidates.slice(0,5).map(c=>({...c,name:entries.get(c.cardId)?.name??c.cardId})),
      quad:event.track.card.quad,detectedQuad:result.detectedCard?.quad,priors:result.raw?.priors,
      backend:result.backend,runtime:result.runtime,quality:result.quality,timingsMs:result.timingsMs,
    })});
  }catch{/* Local diagnostics never interrupt recognition or a table action. */}
}
