// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
import {act} from 'react';
import {tapRoom} from './tap-room-fixture';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetModules();localStorage.clear();history.replaceState(null,'','/');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllEnvs();});
vi.mock('@/lib/db',()=>({getDb:()=>{throw new Error('no db');}}));
vi.mock('../src/lib/remote/zone-grid',()=>({useCardDetection:()=>null}));
vi.mock('../src/components/remote/ui/video-hub',()=>({useVideoHub:()=>({})}));
vi.mock('../src/components/ui/themed-select',()=>({ThemedSelect:({label,value,testId}:{label:string;value:string;testId:string})=><label>{label}<select data-testid={testId} value={value} onChange={()=>{}}><option value="current">Current</option><option value="hybrid">Hybrid</option></select></label>}));

it('only a listed seated user gets the Hybrid reader; for everyone else a saved choice and ?visionReader=hybrid are ignored',async()=>{
  const {remoteRoomForViewer}=await import('../src/lib/remote-duels');
  vi.stubEnv('REMOTE_DUELS','1');vi.stubEnv('REMOTE_DUELS_USERS','*');
  for(const value of ['','*','0101','101x','102']){vi.stubEnv('REMOTE_HYBRID_READER_USERS',value);expect(remoteRoomForViewer(tapRoom(),101).hybridReaderEnabled).toBe(false);}
  vi.stubEnv('REMOTE_HYBRID_READER_USERS',' 101 , * ');
  expect(remoteRoomForViewer(tapRoom(),101).hybridReaderEnabled).toBe(true);
  expect(remoteRoomForViewer(tapRoom(),102).hybridReaderEnabled).toBe(false);
  expect(remoteRoomForViewer({...tapRoom(),spectator:true},101).hybridReaderEnabled).toBe(false);

  localStorage.setItem('dd-remote-card-reader','hybrid');history.replaceState(null,'','/duels/remote/test?visionReader=hybrid');
  const s=await import('../src/components/remote/ui/recognition-backend');
  const {RecognitionSetting}=await import('../src/components/remote/ui/recognition-setting');
  await act(async()=>root.render(<RecognitionSetting/>));
  expect(s.cardReader()).toBe('current');expect(host.querySelector('[data-testid="card-reader"]')).toBeNull();
  s.setCardReader('hybrid');expect(s.cardReader()).toBe('current');
  const reset=vi.fn();s.onRecognitionReset(reset);
  await act(async()=>s.setHybridReaderAllowed(true));
  expect(s.cardReader()).toBe('hybrid');expect(reset).toHaveBeenCalledOnce();expect(host.querySelector('[data-testid="card-reader"]')).not.toBeNull();
  await act(async()=>s.setHybridReaderAllowed(false));
  expect(s.cardReader()).toBe('current');expect(host.querySelector('[data-testid="card-reader"]')).toBeNull();
});
