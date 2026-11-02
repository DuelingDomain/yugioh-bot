import {rank,calibrate,score,distribution,markdown} from './bakeoff-metrics.mjs';

const $=id=>document.getElementById(id);
const pixels=224*224*3, mean=[.485,.456,.406],std=[.229,.224,.225];
const log=line=>{$('status').textContent+=line+'\n';};
async function get(url,type='json') {
  const res=await fetch(url);
  if(!res.ok)throw Error(`${url}: HTTP ${res.status}`);
  return type==='json'?res.json():res.arrayBuffer();
}
function input(u8) {
  const x=new Float32Array(pixels);
  for(let i=0;i<224*224;i++)for(let c=0;c<3;c++)x[c*224*224+i]=(u8[i*3+c]/255-mean[c])/std[c];
  return x;
}
function normalize(z) {
  let square=0;
  for(const v of z) {if(!Number.isFinite(v))throw Error('Non-finite embedding');square+=v*v;}
  const length=Math.sqrt(square);
  if(!length)throw Error('Zero embedding');
  return Float32Array.from(z,v=>v/length);
}
async function embedding(session,ort,u8,gpu) {
  const x=input(u8);
  if(gpu) {
    // Capture requires the SAME external input/output buffers on every run.
    gpu.device.queue.writeBuffer(gpu.inputBuffer,0,x);
    await session.run({pixel_values:gpu.inputTensor},{embedding:gpu.outputTensor});
    const encoder=gpu.device.createCommandEncoder();
    encoder.copyBufferToBuffer(gpu.outputBuffer,0,gpu.readBuffer,0,gpu.bytes);
    gpu.device.queue.submit([encoder.finish()]);
    await gpu.readBuffer.mapAsync(GPUMapMode.READ);
    try{return normalize(new Float32Array(gpu.readBuffer.getMappedRange().slice(0,gpu.bytes)));}
    finally{gpu.readBuffer.unmap();}
  }
  const tensor=new ort.Tensor('float32',x,[1,3,224,224]);
  const outputs=await session.run({pixel_values:tensor});
  const output=outputs.embedding;
  try{return normalize(await output.getData());}
  finally{tensor.dispose();output.dispose();}
}

async function runModel(model,backend,ort,data,queries,adapter) {
  const precision=backend==='wasm'?'q8':'fp16',exp=model.exports[precision];
  const record={candidate:model.id,backend,precision,bytes:exp.bytes,sha256:exp.sha256};
  if(backend==='webgpu'&&(!adapter||!adapter.features.has('shader-f16')))return {...record,skipped:'No hardware shader-f16 WebGPU adapter'};
  let session,gpu;
  try {
    const start=performance.now();
    // Capture refuses mixed CPU/GPU execution; it requires every kernel on
    // WebGPU. A partial fallback/error can never become a WebGPU timing row.
    session=await ort.InferenceSession.create('/'+exp.file,backend==='webgpu'
      ?{executionProviders:['webgpu'],enableGraphCapture:true}
      :{executionProviders:['wasm']});
    record.loadMs=performance.now()-start;
    if(backend==='webgpu') {
      const device=ort.env.webgpu.device,bytes=model.dim*4;
      const inputBuffer=device.createBuffer({size:pixels*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const outputBuffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
      const readBuffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      gpu={device,bytes,inputBuffer,outputBuffer,readBuffer,
        inputTensor:ort.Tensor.fromGpuBuffer(inputBuffer,{dataType:'float32',dims:[1,3,224,224]}),
        outputTensor:ort.Tensor.fromGpuBuffer(outputBuffer,{dataType:'float32',dims:[1,model.dim]})};
    }
    const probe=new Uint8Array(await get(`/${model.id}/probe.u8`,'binary'));
    const expected=new Float32Array(await get(`/${model.id}/probe.f32`,'binary'));
    let minCosine=1;
    for(let i=0;i<probe.length/pixels;i++) {
      const z=await embedding(session,ort,probe.subarray(i*pixels,(i+1)*pixels),gpu);
      let dot=0;for(let d=0;d<model.dim;d++)dot+=z[d]*expected[i*model.dim+d];
      minCosine=Math.min(minCosine,dot);
    }
    if(minCosine<(precision==='fp16'?.995:.98))throw Error(`Native/browser parity failed: ${minCosine}`);
    record.minNativeCosine=minCosine;
    // Each precision/backend builds its OWN full catalog index. Never borrow
    // the native index or an embedding from a different candidate/precision.
    const gallery=new Float32Array(data.gallery.length*model.dim);
    for(let start=0;start<data.gallery.length;start+=32) {
      const count=Math.min(32,data.gallery.length-start);
      const batch=new Uint8Array(await get(`/gallery?start=${start}&count=${count}`,'binary'));
      for(let j=0;j<count;j++)gallery.set(await embedding(session,ort,batch.subarray(j*pixels,(j+1)*pixels),gpu),(start+j)*model.dim);
      if(start%256===0)log(`${model.id} ${backend}: gallery ${start}/${data.gallery.length}`);
    }
    const cards=data.gallery.map(e=>e.cardId),rows={with:[],without:[]},times=[],searchTimes=[];
    const warm=queries.subarray(0,pixels);
    for(let i=0;i<10;i++)await embedding(session,ort,warm,gpu);
    for(let i=0;i<data.queries.length;i++) {
      const q=data.queries[i],begin=performance.now();
      const zs=[await embedding(session,ort,queries.subarray(2*i*pixels,(2*i+1)*pixels),gpu),
        await embedding(session,ort,queries.subarray((2*i+1)*pixels,(2*i+2)*pixels),gpu)];
      const cropMs=performance.now()-begin;
      const scores=new Float32Array(cards.length),searchBegin=performance.now();
      for(let g=0;g<cards.length;g++) {
        let best=-Infinity;
        for(const z of zs) {let dot=0;for(let d=0;d<model.dim;d++)dot+=z[d]*gallery[g*model.dim+d];best=Math.max(best,dot);}
        scores[g]=best;
      }
      for(const mode of ['with','without'])rows[mode].push({truth:q.cardId,split:q.split,sessionId:q.sessionId,
        atMs:q.atMs,instanceId:q.instanceId,ranking:rank(scores,cards,mode==='with'?q.decklist:null)});
      if(q.split==='test'){times.push(cropMs);searchTimes.push(performance.now()-searchBegin);}
    }
    record.latency=distribution(times);record.searchLatency=distribution(searchTimes);
    record.metrics={};record.sessions={};record.rows=rows;
    for(const mode of ['with','without']) {
      const threshold=calibrate(rows[mode].filter(r=>r.split==='calibration'));
      const test=rows[mode].filter(r=>r.split==='test');
      record.metrics[mode]=score(test,threshold);
      record.sessions[mode]={};
      for(const id of new Set(test.map(r=>r.sessionId)))record.sessions[mode][id]=score(test.filter(r=>r.sessionId===id),threshold);
    }
    record.runtime={requested:backend,actual:backend,graphCapture:backend==='webgpu',
      threads:backend==='wasm'?ort.env.wasm.numThreads:null,crossOriginIsolated,
      timing:'batch 1; both 0/180 orientations; normalize+preprocess+readback included; gallery/search/load excluded'};
    return record;
  } catch(error) {return {...record,error:String(error)};}
  finally{
    if(session)await session.release();
    if(gpu){gpu.inputTensor.dispose();gpu.outputTensor.dispose();gpu.inputBuffer.destroy();gpu.outputBuffer.destroy();gpu.readBuffer.destroy();}
  }
}

$('run').onclick=async()=>{
  $('run').disabled=true;$('status').textContent='';
  try {
    const [models,data,frozen,ort]=await Promise.all([get('/models.json'),get('/data.json'),get('/frozen-info.json'),import('/ort/ort.all.min.mjs')]);
    ort.env.wasm.wasmPaths='/ort/';
    ort.env.wasm.numThreads=Math.min(4,navigator.hardwareConcurrency||1);
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    const info=adapter?.info;
    const fallback=adapter?.isFallbackAdapter||info?.isFallbackAdapter||/swiftshader|llvmpipe|software/i.test(`${info?.device} ${info?.description}`);
    const hardware=adapter&&!fallback?adapter:null;
    if(hardware?.features.has('shader-f16'))ort.env.webgpu.device=await hardware.requestDevice({requiredFeatures:['shader-f16']});
    const queries=new Uint8Array(await get('/queries.u8','binary'));
    if(queries.length!==data.queries.length*2*pixels)throw Error('Query payload size mismatch');
    const report={version:1,createdAt:new Date().toISOString(),browser:navigator.userAgent,
      cpu:$('cpu').value.trim(),gpu:JSON.stringify({vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description,fp16:!!hardware?.features.has('shader-f16'),fallback:!!fallback}),
      frozenSha256:frozen.sha256,inputs:frozen.inputs,models,logicalCores:navigator.hardwareConcurrency,runs:[]};
    if(!report.cpu)throw Error('Enter the owner CPU model for reproducible latency');
    for(const model of models)for(const backend of ['wasm','webgpu']) {
      log(`${model.id}: ${backend} starting`);
      const record=await runModel(model,backend,ort,data,queries,hardware);
      report.runs.push(record);
      log(`${model.id}: ${backend} ${record.error??record.skipped??'complete'}`);
    }
    report.complete=report.runs.every(r=>!r.error&&!r.skipped);
    report.zeroWrong=report.runs.every(r=>!r.metrics||Object.values(r.metrics).every(m=>m.zeroWrong));
    const text=markdown(report);$('results').textContent=text;
    // Only benchmark metrics, never source video/crops; loopback server only.
    const saved=await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
    if(!saved.ok)throw Error('Could not save report');
    log('Saved browser-results.json and browser-summary.md. Server has stopped.');
  }catch(error){log(String(error));$('run').disabled=false;}
};
