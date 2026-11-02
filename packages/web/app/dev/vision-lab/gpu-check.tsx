'use client';
import {useState} from 'react';
// Adapted from the vision-bench lab probe; this is capability, not inference timing.
export function GPUCheck() {
  const [result,setResult]=useState('Not checked'),[busy,setBusy]=useState(false);
  async function check() {
    setBusy(true);
    try {
      type Adapter={isFallbackAdapter?:boolean;info?:Record<string,unknown>;features:{has(name:string):boolean};requestDevice(options:object):Promise<{destroy():void}>};
      const gpu=(navigator as unknown as {gpu?:{requestAdapter():Promise<Adapter|null>}}).gpu;
      const adapter=await gpu?.requestAdapter();
      if(!adapter)setResult('WASM fallback · no WebGPU adapter');
      else if(adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter || /swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter.info??{})))setResult('WASM fallback · software adapter refused');
      else if(!adapter.features.has('shader-f16'))setResult('WASM fallback · adapter has no shader-f16');
      else {
        const device=await adapter.requestDevice({requiredFeatures:['shader-f16']});device.destroy();
        setResult(`Hardware WebGPU fp16 available · ${JSON.stringify(adapter.info??{})}`);
      }
    }catch(e){setResult(`WASM fallback · ${String(e)}`);}finally{setBusy(false);}
  }
  return <div><button type="button" disabled={busy} onClick={()=>void check()}>Check WebGPU</button> <span aria-live="polite" aria-label="WebGPU result">{result}</span><p>The result below shows the actual inference backend and timings after a card read.</p></div>;
}
