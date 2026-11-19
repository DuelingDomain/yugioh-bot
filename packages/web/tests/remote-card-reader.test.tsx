// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react';
import {remoteActionSchema} from '@yugidraft/shared/remote';
import type {ReaderDiagnostics} from '@yugidraft/vision';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetModules();localStorage.clear();history.replaceState(null,'','/');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
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
