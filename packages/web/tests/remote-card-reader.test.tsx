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
  expect(s.cardReader()).toBe('current');expect(s.engineBackend()).toBe('auto');
  const reset=vi.fn(),stop=s.onRecognitionReset(reset);
  s.setCardReader('hybrid');s.setCardReader('hybrid');
  expect(reset).toHaveBeenCalledOnce();expect(localStorage.getItem('dd-remote-card-reader')).toBe('hybrid');
  expect(s.recognitionBackendNow()).toMatchObject({reader:'hybrid',mode:'auto',generation:1,read:null});
  stop();vi.resetModules();expect((await import('../src/components/remote/ui/recognition-backend')).cardReader()).toBe('hybrid');
});
it.each(['hybrid','current'] as const)('query parameter forces %s independently of the stored choice',async reader=>{
  localStorage.setItem('dd-remote-card-reader',reader==='hybrid'?'current':'hybrid');history.replaceState(null,'',`/duels/remote/test?visionReader=${reader}`);
  const s=await import('../src/components/remote/ui/recognition-backend');expect(s.cardReader()).toBe(reader);
});
it('one reader control works in both setting variants and a load failure is visible',async()=>{
  const {RecognitionSetting,RecognitionBadge}=await import('../src/components/remote/ui/recognition-setting');
  const s=await import('../src/components/remote/ui/recognition-backend');
  for(const variant of ['sheet','menu'] as const){
    await act(async()=>root.render(<><RecognitionSetting variant={variant}/><RecognitionBadge/></>));
    const select=host.querySelector<HTMLSelectElement>('[data-testid="card-reader"]')!;expect(select).toBeTruthy();
    await act(async()=>{select.value=variant==='sheet'?'hybrid':'current';select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(s.cardReader()).toBe(variant==='sheet'?'hybrid':'current');
  }
  await act(async()=>s.reportReaderNote('Hybrid reader could not load. Using the current reader.'));
  expect(host.querySelector('[data-testid="reader-note"]')?.textContent).toContain('Using the current reader');
});
it('read diagnostics survive the camera stamp, action validation and idempotent retry bytes',async()=>{
  const {fieldCameraStamp,stampedProposal}=await import('../src/lib/remote/field-timing');
  const reader:ReaderDiagnostics={selected:'hybrid',stage:'second',model:'dinov2-small-duel-v3b-light',first:{score:.67,runnerUp:.64,margin:.03,ms:4},second:{score:.9,runnerUp:.7,margin:.2,ms:111},ms:115};
  const stamp=fieldCameraStamp({id:'read',originAt:1000,stagesMs:{firstOutline:0,searchDone:120},durationsMs:{},reader});
  const proposal={type:'twin.place' as const,actorSeat:0,seat:0,zone:'monster',card:{ref:'read-1',cardId:1,faceUp:true,position:'attack' as const},source:'auto' as const,cam:stamp};
  const action=stampedProposal(proposal,'hybrid-stamp-test');
  expect(remoteActionSchema.parse({...action,idempotencyKey:'hybrid-stamp-test'}).cam?.reader).toEqual(reader);
  expect(JSON.stringify(stampedProposal({...proposal,cam:{...stamp,sentAt:stamp.sentAt+100}},'hybrid-stamp-test'))).toBe(JSON.stringify(action));
});
