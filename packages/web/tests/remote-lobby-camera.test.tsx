// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RemoteRoom } from '@yugidraft/shared/remote';
import type { RoomController } from '../src/components/remote/ui/use-remote-room';

const state=vi.hoisted(()=>({hub:{} as any}));
vi.mock('swr',()=>({default:()=>({data:{decks:[]}})}));
vi.mock('../src/components/remote/ui/video-hub',()=>({useVideoHub:()=>state.hub}));
vi.mock('../src/components/remote/ui/lobby-camera-preview',()=>({default:({mode}:{mode:string})=><div data-testid="preview-mode">{mode}</div>}));
import { RemoteLobbyRoom } from '../src/components/remote/ui/lobby';
import { useCameraLock } from '../src/lib/remote/use-camera-lock';
import { FieldDebugOverlay } from '../src/components/remote/ui/zone-grid';
import { publishFieldDebug, setFieldDebugEnabled, setFieldDeveloper } from '../src/lib/remote/zone-grid';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

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

it('samples the preview with the latest calibrated mat without restarting the camera lock', async () => {
 vi.useFakeTimers();
 const settings = { exposureMode: 'continuous', exposureTime: 120 };
 const apply = vi.fn(async (constraints: MediaTrackConstraints) => { for (const value of constraints.advanced ?? []) Object.assign(settings, value); });
 const track = { readyState: 'live', getSettings: () => ({ ...settings }), getCapabilities: () => ({ exposureMode: ['continuous', 'manual'], exposureTime: { min: 10, max: 1000 } }), getConstraints: () => ({}), applyConstraints: apply } as unknown as MediaStreamTrack;
 const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const value = x < 10 && y === 0 ? 255 : 100;
  data.set([value, value, value, 255], (y * width + x) * 4);
 }
 const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data, width, height })) };
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
 vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
 const video = { readyState: 2, videoWidth: width, videoHeight: height } as HTMLVideoElement;
 const initialProps: { corners?: { x: number; y: number }[] } = {};
 const view = renderHook(({ corners }: typeof initialProps) => useCameraLock(track, 'hook-camera', { video: () => video, corners: () => corners }), { initialProps });
 await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
 expect(settings.exposureTime).toBe(120); expect(context.drawImage).toHaveBeenCalledTimes(1);
 view.rerender({ corners: [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: .1, y: .1 }, { x: 0, y: .1 }] });
 await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
 expect(settings.exposureTime).toBe(92); expect(context.drawImage).toHaveBeenCalledTimes(2);
 expect(apply).toHaveBeenCalledTimes(2); // Initial lock plus one exposure reduction.
 view.unmount(); apply.mockClear();
 await vi.advanceTimersByTimeAsync(10000); expect(apply).not.toHaveBeenCalled();
});

it('shows the camera result in Debug while the field watcher has no diagnostics', () => {
 const debug = 'camera: exposure 156→120, glare 6%→1%';
 state.hub = { cameraLock: { debug } };
 setFieldDeveloper(true); setFieldDebugEnabled(true); publishFieldDebug(null);
 const view = render(<FieldDebugOverlay box={{ left: 0, top: 0, width: 640, height: 360 }} />);
 try { expect(screen.getByTestId('field-debug-status')).toHaveTextContent(debug); }
 finally { view.unmount(); setFieldDebugEnabled(false); setFieldDeveloper(false); }
});
