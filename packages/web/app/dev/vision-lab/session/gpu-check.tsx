'use client';
import {useState} from 'react';
import {hardwareGPU} from '../../../../../vision/bench/replay';
export function GPUCheck() {
  const [result,setResult]=useState('Not checked'),[busy,setBusy]=useState(false);
  async function check(){setBusy(true);try{const gpu=await hardwareGPU();setResult(`${gpu.available?'Hardware WebGPU available':'WASM fallback'} · ${gpu.reason??'device created successfully'} · ${JSON.stringify(gpu.info??{})} · crossOriginIsolated=${crossOriginIsolated}`);}catch(e){setResult(String(e));}finally{setBusy(false);}}
  return <div><button disabled={busy} onClick={()=>void check()}>Check WebGPU</button> <output aria-label="WebGPU result">{result}</output><p>Run this in the Chrome window you use for duels. The offline replay status below reports the actual recognition backend and WASM thread count; an available adapter alone does not prove ONNX used it.</p></div>;
}
