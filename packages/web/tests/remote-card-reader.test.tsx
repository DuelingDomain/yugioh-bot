// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react';
import {remoteActionSchema} from '@yugidraft/shared/remote';
import type {ReaderDiagnostics} from '@yugidraft/vision';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetModules();localStorage.clear();history.replaceState(null,'','/');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
vi.mock('../src/lib/remote/zone-grid',()=>({useCardDetection:()=>null}));
vi.mock('../src/components/remote/ui/video-hub',()=>({useVideoHub:()=>({})}));
vi.mock('../src/components/ui/themed-select',()=>({ThemedSelect:({label,value,choices,onChange,testId}:{label:string;value:string;choices:{value:string;label:string}[];onChange:(value:string)=>void;testId:string})=><label>{label}<select data-testid={testId} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>}));

it('defaults to current, persists an explicit choice and restarts once without changing processor mode',async()=>{
  const s=await import('../src/components/remote/ui/recognition-backend');
  s.setHybridReaderEnabled(true);
  expect(s.cardReader()).toBe('current');expect(s.engineBackend()).toBe('auto');
  const reset=vi.fn(),stop=s.onRecognitionReset(reset);
  s.setCardReader('hybrid');s.setCardReader('hybrid');
  expect(reset).toHaveBeenCalledOnce();expect(localStorage.getItem('dd-remote-card-reader')).toBe('hybrid');
  expect(s.recognitionBackendNow()).toMatchObject({reader:'hybrid',mode:'auto',generation:1,read:null});
  stop();vi.resetModules();
  const reloaded=await import('../src/components/remote/ui/recognition-backend');
  reloaded.setHybridReaderEnabled(true);
  expect(reloaded.cardReader()).toBe('hybrid');
});
it.each(['hybrid','current'] as const)('query parameter forces %s independently of the stored choice',async reader=>{
  localStorage.setItem('dd-remote-card-reader',reader==='hybrid'?'current':'hybrid');history.replaceState(null,'',`/duels/remote/test?visionReader=${reader}`);
  const s=await import('../src/components/remote/ui/recognition-backend');
  s.setHybridReaderEnabled(true);
  expect(s.cardReader()).toBe(reader);
});
it('ignores a saved or forced Hybrid choice until allowed and removes the option when access is lost',async()=>{
  localStorage.setItem('dd-remote-card-reader','hybrid');
  history.replaceState(null,'','/duels/remote/test?visionReader=hybrid');
  const s=await import('../src/components/remote/ui/recognition-backend');
  const {RecognitionSetting}=await import('../src/components/remote/ui/recognition-setting');
  const options=()=>Array.from(host.querySelectorAll('[data-testid="card-reader"] option'),option=>option.textContent);
  await act(async()=>root.render(<><RecognitionSetting/><RecognitionSetting variant="menu"/></>));
  s.setCardReader('hybrid');
  expect(s.cardReader()).toBe('current');
  expect(options()).toEqual(['Current','Current']);
  await act(async()=>s.setHybridReaderEnabled(true));
  expect(s.cardReader()).toBe('hybrid');
  expect(options()).toEqual(['Current','Hybrid','Current','Hybrid']);
  await act(async()=>s.setHybridReaderEnabled(false));
  expect(s.cardReader()).toBe('current');
  expect(options()).toEqual(['Current','Current']);
  expect(localStorage.getItem('dd-remote-card-reader')).toBe('hybrid');
});
it('reader and five Set controls work together in both setting variants and a load failure is visible',async()=>{
  const {RecognitionSetting,RecognitionBadge,SetCardSettings}=await import('../src/components/remote/ui/recognition-setting');
  const s=await import('../src/components/remote/ui/recognition-backend');
  s.setHybridReaderEnabled(true);
  const {readSetGuards}=await import('../src/lib/remote/set-card-settings');
  const labels=['Require back evidence','Ask about uncertain Sets','Remember Not a card','Ignore setup objects','Wait for hand release'];
  for(const variant of ['sheet','menu'] as const){
    await act(async()=>root.render(<><RecognitionSetting variant={variant}/><SetCardSettings/><RecognitionBadge/></>));
    const select=host.querySelector<HTMLSelectElement>('[data-testid="card-reader"]')!;expect(select).toBeTruthy();
    await act(async()=>{select.value=variant==='sheet'?'hybrid':'current';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(s.cardReader()).toBe(variant==='sheet'?'hybrid':'current');
    const switches=Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(switches.map(input=>input.parentElement?.textContent)).toEqual(labels);
    expect(switches.map(input=>input.checked)).toEqual(Array(5).fill(variant==='sheet'));
    for(const input of switches)await act(async()=>input.click());
    expect(readSetGuards()).toEqual({positiveBack:variant==='menu',prompt:variant==='menu',ignore:variant==='menu',startup:variant==='menu',handRelease:variant==='menu'});
    expect(JSON.parse(localStorage.getItem('dd-field-set-guards:v1')!)).toEqual(readSetGuards());
    expect(s.cardReader()).toBe(variant==='sheet'?'hybrid':'current');expect(s.engineBackend()).toBe('auto');
  }
  await act(async()=>s.reportReaderNote('Hybrid reader could not load. Using the current reader.'));
  expect(host.querySelector('[data-testid="reader-note"]')?.textContent).toContain('Using the current reader');
});
it.each([false,true])('starts Current when Hybrid is denied or its catalog is unavailable (allowed: %s)',async allowed=>{
  const actual=await vi.importActual<typeof import('@yugidraft/vision')>('@yugidraft/vision');
  const prepare=vi.fn(async()=>({backend:'wasm' as const}));
  const create=vi.fn((config:import('@yugidraft/vision').RecognizerConfig)=>{
    config.onBackendChange?.({backend:'wasm',models:[{model:'embedder',backend:'wasm'}]});
    return {prepare,dispose:vi.fn()};
  });
  const loadHybridCatalog=vi.fn(async()=>{throw new Error('catalog unavailable');});
  vi.doMock('@yugidraft/vision',()=>({...actual,loadHybridCatalog,createRecognizer:create}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({entries:[]}))));
  history.replaceState(null,'','/duels/remote/test?visionReader=hybrid');
  const state=await import('../src/components/remote/ui/recognition-backend');
  state.setHybridReaderEnabled(allowed);
  const {prepareOwnReader,disposeRecognizer}=await import('../src/components/remote/ui/recognizer');
  try {
    await prepareOwnReader();
    expect(create).toHaveBeenCalledOnce();expect(create.mock.calls[0][0].reader).toBe('current');
    expect(prepare).toHaveBeenCalledOnce();
    expect(loadHybridCatalog).toHaveBeenCalledTimes(allowed?1:0);
    expect(state.recognitionBackendNow().readerNote).toBe(allowed?'Hybrid reader could not load. Using the current reader. Switch readers to retry.':'');
  }finally{disposeRecognizer();vi.doUnmock('@yugidraft/vision');}
});
it('read diagnostics survive the camera stamp, action validation and idempotent retry bytes',async()=>{
  const {fieldCameraStamp,stampedProposal}=await import('../src/lib/remote/field-timing');
  const reader:ReaderDiagnostics={selected:'hybrid',stage:'second',model:'dinov2-small-duel-v3b-light',first:{score:.67,runnerUp:.64,margin:.03,ms:4},second:{score:.9,runnerUp:.7,margin:.2,ms:111},ms:115};
  const stamp=fieldCameraStamp({id:'read',originAt:1000,stagesMs:{firstOutline:0,searchDone:120},durationsMs:{},reader});
  const set={detector:.95,pixel:'down' as const,pixelConfidence:1,sd:0,backDistance:null,positive:true,basis:'pixels' as const,decision:'committed' as const};
  const proposal={type:'twin.place' as const,actorSeat:0,seat:0,zone:'monster',card:{ref:'read-1',cardId:1,faceUp:true,position:'attack' as const},source:'auto' as const,cam:{...stamp,set}};
  const action=stampedProposal(proposal,'hybrid-stamp-test');
  expect(remoteActionSchema.parse({...action,idempotencyKey:'hybrid-stamp-test'}).cam?.reader).toEqual(reader);
  expect(remoteActionSchema.parse({...action,idempotencyKey:'hybrid-stamp-test'}).cam?.set).toEqual(set);
  expect(JSON.stringify(stampedProposal({...proposal,cam:{...proposal.cam,sentAt:stamp.sentAt+100}},'hybrid-stamp-test'))).toBe(JSON.stringify(action));
});

it('retries worker-reported CPU fallback with backoff and starts a fresh GPU attempt on reload', async () => {
  vi.useFakeTimers();
  const state = await import('../src/components/remote/ui/recognition-backend');
  const reset = vi.fn();
  state.onRecognitionReset(reset);
  state.reportBackend('wasm', 'WebGPU initialization timed out');
  expect(state.recognitionBackendNow()).toMatchObject({backend:'wasm', note:'WebGPU initialization timed out'});
  await vi.advanceTimersByTimeAsync(29_999);
  expect(reset).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(state.engineBackend()).toBe('auto');
  state.reportBackend('wasm', 'The WebGPU adapter is software', false);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(reset).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reset).toHaveBeenCalledTimes(2);
  vi.resetModules();
  const reloaded = await import('../src/components/remote/ui/recognition-backend');
  expect(reloaded.engineBackend()).toBe('auto');
  expect(reloaded.recognitionBackendNow()).toMatchObject({backend:null, note:''});
  expect(localStorage.length).toBe(0);
});

it('cancels pending GPU recovery when the player selects CPU', async () => {
  vi.useFakeTimers();
  const state = await import('../src/components/remote/ui/recognition-backend');
  const reset = vi.fn();
  state.onRecognitionReset(reset);
  state.reportBackend('wasm', 'WebGPU initialization timed out');
  state.setRecognitionMode('cpu');
  state.reportBackend('wasm');
  await vi.advanceTimersByTimeAsync(600_000);
  expect(reset).toHaveBeenCalledOnce();
  expect(state.engineBackend()).toBe('wasm');
  expect(state.recognitionBackendNow()).toMatchObject({backend:'wasm',note:'selected in settings'});
});

it.each(['sheet','menu'] as const)('shows the CPU reason and retries from the %s settings', async variant => {
  const {RecognitionSetting} = await import('../src/components/remote/ui/recognition-setting');
  const state = await import('../src/components/remote/ui/recognition-backend');
  localStorage.setItem('dd-remote-recognition-mode','cpu');
  await act(async()=>root.render(<RecognitionSetting variant={variant}/>));
  expect(host.textContent).toContain('CPU (selected in settings)');
  const retry = [...host.querySelectorAll('button')].find(button=>button.textContent==='Try GPU again');
  expect(retry).toBeDefined();
  await act(async()=>retry!.click());
  expect(state.engineBackend()).toBe('auto');
  expect(localStorage.getItem('dd-remote-recognition-mode')).toBe('auto');
  await act(async()=>state.reportBackend('wasm', 'No hardware adapter', false));
  expect(host.textContent).toContain('Detection engine: CPU (No hardware adapter)');
  await act(async()=>state.reportBackend('webgpu'));
  expect(host.textContent).toContain('Detection engine: GPU');
  expect(host.textContent).not.toContain('Try GPU again');
});

it('evicts a lost WebGPU device and requests a fresh high-performance adapter', async () => {
  const {webGpuRuntime} = await import('../../vision/src/web-runtime');
  type WebOrt = import('../../vision/src/web-runtime').WebOrt;
  let lose!: (info:{reason:string;message:string})=>void;
  const device = () => ({destroy:vi.fn(),lost:new Promise<{reason:string;message:string}>(resolve=>{lose=resolve;})});
  const requestDevice = vi.fn(async()=>device());
  const requestAdapter = vi.fn(async()=>({requestDevice}));
  const onGpuDeviceLost = vi.fn();
  const ort = {env:{wasm:{},webgpu:{}}} as WebOrt;
  const deps = {gpu:{requestAdapter},ortWebGpu:async()=>ort,getURL:(path:string)=>path,onGpuDeviceLost};
  const first = await webGpuRuntime(deps);
  expect(first.ort).toBe(ort);
  lose({reason:'unknown',message:'driver reset'});
  await Promise.resolve();
  expect(onGpuDeviceLost).toHaveBeenCalledWith(expect.stringContaining('driver reset'));
  const replacement = await webGpuRuntime(deps);
  expect(replacement.ort).toBe(ort);
  expect(replacement).not.toBe(first);
  expect(requestDevice).toHaveBeenCalledTimes(2);
  expect(requestAdapter.mock.calls).toEqual(Array(2).fill([{powerPreference:'high-performance'}]));
});

it('tries device initialization again after a transient failure in the same worker', async () => {
  const {webGpuRuntime} = await import('../../vision/src/web-runtime');
  type WebOrt = import('../../vision/src/web-runtime').WebOrt;
  const requestDevice = vi.fn(async()=>({destroy:vi.fn()})).mockRejectedValueOnce(new Error('temporary adapter failure'));
  const ort = {env:{wasm:{},webgpu:{}}} as WebOrt;
  const deps = {gpu:{requestAdapter:async()=>({requestDevice})},ortWebGpu:async()=>ort,getURL:(path:string)=>path};
  expect(await webGpuRuntime(deps)).toMatchObject({ort:null,why:expect.stringContaining('temporary adapter failure')});
  expect((await webGpuRuntime(deps)).ort).toBe(ort);
});

it('runs on WASM after device loss and reopens a fresh GPU session for an unsupervised reader', async () => {
  vi.useFakeTimers({toFake:['performance']});
  const {openModelSession} = await import('../../vision/src/web-runtime');
  type WebOrt = import('../../vision/src/web-runtime').WebOrt;
  let lose!: (info:{reason:string;message:string})=>void;
  class Tensor { constructor(public type:string, public data:Float32Array, public dims:number[]) {} }
  const requestDevice = vi.fn(async()=>({destroy:vi.fn(),lost:new Promise<{reason:string;message:string}>(resolve=>{lose=resolve;})}));
  const gpuRun = vi.fn(async()=>({})), wasmRun = vi.fn(async()=>({}));
  const ort = (run:typeof gpuRun) => ({env:{wasm:{},webgpu:{}},Tensor,InferenceSession:{create:async()=>({run,release:async()=>{}})}}) as unknown as WebOrt;
  const wasmOrt = ort(wasmRun), gpuOrt = ort(gpuRun);
  const {session} = await openModelSession('model.onnx','test-model',{
    gpu:{requestAdapter:async()=>({requestDevice})},ort:wasmOrt,ortWebGpu:async()=>gpuOrt,
    fetch:async()=>new Response(new Uint8Array([1])),getURL:path=>path,
  });
  const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    const feeds = {input:new Tensor('float32',new Float32Array([1]),[1])};
    lose({reason:'unknown',message:'driver reset'});
    await Promise.resolve();
    await session.run(feeds);
    expect(session.ep).toBe('wasm');
    expect(wasmRun).toHaveBeenCalledOnce();
    expect(gpuRun).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    await session.run(feeds);
    expect(session.ep).toBe('webgpu');
    expect(gpuRun).toHaveBeenCalledOnce();
    expect(requestDevice).toHaveBeenCalledTimes(2);
  } finally {
    await session.release();
    warn.mockRestore();
  }
});

it('reports a device loss from an idle worker and ignores events after disposal', async () => {
  const {createRecognizer} = await import('@yugidraft/vision');
  let worker!: FakeWorker;
  class FakeWorker {
    onmessage?: (event: {data: object}) => void;
    constructor() { worker = this; }
    postMessage(message: {id: number; type: string}) {
      queueMicrotask(() => this.onmessage?.({data:{id:message.id,result:{backend:'webgpu'}}}));
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const onWorkerFailure = vi.fn();
  const reader = createRecognizer({workers:'single',onWorkerFailure});
  await reader.warmup();
  const lost = {data:{type:'gpu-device-lost',reason:'WebGPU device lost: driver reset'}};
  worker.onmessage?.(lost);
  expect(onWorkerFailure).toHaveBeenCalledWith(new Error(lost.data.reason));
  reader.dispose();
  worker.onmessage?.(lost);
  expect(onWorkerFailure).toHaveBeenCalledOnce();
});

it('releases a hung foreground warmup and reports the worker timeout', async () => {
  vi.useFakeTimers();
  const {createRecognizer} = await import('@yugidraft/vision');
  const terminate = vi.fn(), onWorkerFailure = vi.fn();
  vi.stubGlobal('Worker', class {
    postMessage() {}
    terminate = terminate;
  });
  const reader = createRecognizer({workers:'single',onWorkerFailure});
  try {
    const warmup = expect(reader.warmup()).rejects.toThrow(/worker stopped responding/);
    await vi.advanceTimersByTimeAsync(240_000);
    await warmup;
    expect(terminate).toHaveBeenCalledOnce();
    expect(onWorkerFailure).toHaveBeenCalledOnce();
  } finally {
    reader.dispose();
  }
});

it('reports CPU fallback in the split read lane even while the scene detector uses GPU', async () => {
  const {createRecognizer} = await import('@yugidraft/vision');
  vi.stubGlobal('Worker', class {
    onmessage?: (event: {data: object}) => void;
    constructor(_url: string, private options: WorkerOptions) {}
    postMessage(message: {id: number; type: string}) {
      const scene = this.options.name === 'card-recognition-scene';
      const fallback = !scene && message.type === 'recognize';
      const models = scene
        ? [{model:'detector',backend:'webgpu'}]
        : [{model:'embedder',backend:'webgpu'}, ...(fallback ? [{model:'detector',backend:'wasm',fallbackReason:'WebGPU run timed out'}] : [])];
      queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{backend:fallback?'wasm':'webgpu'},backendStatus:{models}}}));
    }
    terminate() {}
  });
  const reader = createRecognizer({workers:'split'});
  try {
    await reader.warmup();
    await reader.recognize([{width:3,height:3,data:new Uint8ClampedArray(36),colorSpace:'srgb'}]);
    expect(reader.backendStatus).toMatchObject({
      backend:'wasm',
      fallbackReason:expect.stringContaining('WebGPU run timed out'),
    });
  } finally {
    reader.dispose();
  }
});

it('replaces the failed reader with CPU and then creates a fresh GPU reader', async () => {
  vi.useFakeTimers();
  const actual = await vi.importActual<typeof import('@yugidraft/vision')>('@yugidraft/vision');
  type Config = import('@yugidraft/vision').RecognizerConfig;
  const readers: ReturnType<typeof makeReader>[] = [];
  let finishCpuWarmup!: () => void;
  const cpuWarmup = new Promise<void>(resolve=>{finishCpuWarmup=resolve;});
  function makeReader(config: Config) {
    const backend = config.backend === 'wasm' ? 'wasm' : 'webgpu';
    const warmup = vi.fn(async()=>{
      if (backend === 'wasm') await cpuWarmup;
      config.onBackendChange?.({backend,models:[{model:'detector',backend}]});
    });
    return {config,warmup,dispose:vi.fn()};
  }
  vi.doMock('@yugidraft/vision',()=>({...actual,createRecognizer:(config:Config)=>{
    const reader = makeReader(config);
    readers.push(reader);
    return reader;
  }}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({entries:[]}))));
  const state = await import('../src/components/remote/ui/recognition-backend');
  const {disposeRecognizer,prewarmRecognizer} = await import('../src/components/remote/ui/recognizer');
  const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
  try {
    await prewarmRecognizer();
    readers[0].config.onWorkerFailure?.(new Error('WebGPU device lost: driver reset'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readers.map(reader=>reader.config.backend)).toEqual(['auto','wasm']);
    expect(readers[1].dispose).not.toHaveBeenCalled();
    finishCpuWarmup();
    await prewarmRecognizer();
    expect(readers[0].dispose).toHaveBeenCalledOnce();
    expect(state.recognitionBackendNow()).toMatchObject({backend:'wasm',note:'WebGPU device lost: driver reset'});
    await vi.advanceTimersByTimeAsync(1000);
    await prewarmRecognizer();
    expect(readers.map(reader=>reader.config.backend)).toEqual(['auto','wasm','auto']);
    expect(readers[1].dispose).toHaveBeenCalledOnce();
    expect(state.recognitionBackendNow()).toMatchObject({backend:'webgpu',note:''});
    expect(localStorage.length).toBe(0);
  } finally {
    finishCpuWarmup();
    warn.mockRestore();
    disposeRecognizer();
    vi.doUnmock('@yugidraft/vision');
  }
});
