// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RemoteRoom } from '@yugidraft/shared/remote';
import type { RoomController } from '../src/components/remote/ui/use-remote-room';

const state=vi.hoisted(()=>({hub:{} as any}));
vi.mock('swr',()=>({default:()=>({data:{decks:[]}})}));
vi.mock('../src/components/remote/ui/video-hub',()=>({useVideoHub:()=>state.hub}));
vi.mock('../src/components/remote/ui/lobby-camera-preview',()=>({default:({mode}:{mode:string})=><div data-testid="preview-mode">{mode}</div>}));
import { RemoteLobbyRoom } from '../src/components/remote/ui/lobby';

afterEach(cleanup);

it.each(['manual','phone'])('waits for the saved %s camera choice before mounting the preview',mode=>{
 const room={slug:'saved-choice',mySeat:0,createdBy:16,solo:true,seatCount:2,state:{match:{bestOf:1}},seats:[{seat:0,userId:16,displayName:'Smoke',ready:false}]} as RemoteRoom;
 const ctl={operation:vi.fn(),busy:false,realtime:'Connected'} as unknown as RoomController;
 state.hub={rosterReady:false,manual:()=>false,phones:[]};
 const view=render(<RemoteLobbyRoom room={room} ctl={ctl}/>);
 expect(screen.queryByTestId('preview-mode')).toBeNull();
 state.hub={rosterReady:true,manual:()=>mode==='manual',phones:mode==='phone'?[{seat:0,paired:true}]:[]};
 view.rerender(<RemoteLobbyRoom room={room} ctl={ctl}/>);
 expect(screen.getByTestId('preview-mode')).toHaveTextContent(mode);
});

it('with voice recognition off the table opens no STT socket and no mic, hides say hints, and keeps the confirm chip', async () => {
  const {useVoice}=await import('../src/components/remote/ui/use-voice');
  const {MicSection,VoxSection,UndoSection}=await import('../src/components/remote/ui/dock');
  const {renderHook}=await import('@testing-library/react');
  const socket=vi.fn(); vi.stubGlobal('WebSocket',socket);
  const getUserMedia=vi.fn(()=>new Promise<MediaStream>(()=>{}));
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
  const voice={ptt:false,held:false,hotwords:[],onFinal:()=>{},onCorrection:()=>{}};
  const off=renderHook(()=>useVoice({...voice,url:null,enabled:true,state:'listen'}));
  expect(getUserMedia).not.toHaveBeenCalled(); expect(socket).not.toHaveBeenCalled(); off.unmount();
  // Control: the same hook with recognition on does ask for the mic, so the check above can fail.
  const on=renderHook(()=>useVoice({...voice,url:'ws://stt.test/ws',enabled:true,state:'listen'}));
  expect(getUserMedia).toHaveBeenCalledTimes(1); on.unmount();
  const noop=()=>{};
  const {container}=render(<>
    <MicSection recognition={false} state='off' level={0} speaking={false} muted={false} ptt={false} held={false} service='unused' error='' onMute={noop} onPtt={noop} offTurn={false}/>
    <VoxSection recognition={false} transcript={{text:'',live:false,result:'',ignored:false}} samples={[]} proposal={{id:-1,title:'Dark Magician attacks',sub:'',confirmLabel:'Declare'}} onConfirm={noop} onCancel={noop} onSample={noop}/>
    <UndoSection recognition={false} label='' enabled={false} flash={0} histOpen={false} onUndo={noop} onHist={noop}/>
  </>);
  expect(container.textContent).not.toMatch(/\bsay\b|listening/i);
  expect(screen.getByTestId('proposal-confirm').textContent).toContain('Declare');
  expect(screen.getByTestId('mic-label').textContent).toBe('Voice chat');
  expect(screen.getByRole('button',{name:'Mute'})).toBeTruthy();
});
