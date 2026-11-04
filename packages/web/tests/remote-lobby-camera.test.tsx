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
