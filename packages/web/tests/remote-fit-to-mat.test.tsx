// @vitest-environment jsdom
import React,{StrictMode,useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,renderHook,act,screen,waitFor} from '@testing-library/react';
import {createFieldCalibration,type FieldCalibration,type MatFitResult} from '@yugidraft/vision';
const worker=vi.hoisted(()=>vi.fn());
vi.mock('@yugidraft/vision',async importOriginal=>({...await importOriginal<typeof import('@yugidraft/vision')>(),fitToMat:worker}));
import {useFieldTransform} from '../src/components/remote/field-transform';
vi.mock('../src/components/duel/fonts',()=>({duelFontClasses:''}));
import {FieldCalibrationControl} from '../src/components/remote/field-calibration';
import {FitToMatControl} from '../src/components/remote/fit-to-mat';
const corners=[{x:.1,y:.35},{x:.9,y:.4},{x:.9,y:1.1},{x:.1,y:1.05}] as MatFitResult['corners'];
const good:MatFitResult={corners,orientation:{playerSide:'top',mirrored:false},mirror:false,confidence:'high',reason:'',flags:{colWindowAmbiguous:false,sideByPrior:true,zonesFound:9,reason:''},metrics:{inliers:9,rows:2,columns:5,columnSpan:7,meanErrorPitch:.01,maxErrorPitch:.02},flipped:{corners:corners!.map(p=>({...p,y:p.y-.25})) as NonNullable<MatFitResult['corners']>,orientation:{playerSide:'bottom',mirrored:false}}};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();worker.mockReset();});
function camera(){
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:640,height:360,close:vi.fn()})));
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,preview');
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(()=>{});
 const video=document.createElement('video');Object.defineProperties(video,{videoWidth:{value:640},videoHeight:{value:360},readyState:{value:2}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn(),getImageData:()=>({width:640,height:360,data:new Uint8ClampedArray(640*360*4)})} as any);
 return video;
}
function setup(){
 const video=camera();
 const saved=vi.fn();
 function Harness(){
  const [busy,setBusy]=useState(false),[grid,setGrid]=useState<FieldCalibration>();
  return <><FitToMatControl video={video} auto calibration={grid} disabled={busy} onBusy={setBusy} onCapture={()=>{}} onApply={value=>{setGrid(value);saved(value);}}/>
   <button onClick={()=>setGrid(createFieldCalibration(corners!,{playerSide:'top',mirrored:true}))}>Manual mirror</button></>;
 }
 const view=render(<StrictMode><Harness/></StrictMode>);return {...view,saved};
}
it('fits once in StrictMode, previews high confidence, flips both ways, and releases busy',async()=>{
 worker.mockResolvedValue(good);const {saved}=setup();
 await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));expect(worker).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Fit to my mat'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Flip'}));expect(saved.mock.lastCall![0].orientation.playerSide).toBe('bottom');
 expect(saved.mock.lastCall![0].corners).toEqual(good.flipped!.corners);
 fireEvent.click(screen.getByRole('button',{name:'Flip'}));expect(saved.mock.lastCall![0].corners).toEqual(good.corners);
 fireEvent.click(screen.getByRole('button',{name:'Manual mirror'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Flip'})).toBeNull());
 expect(saved).toHaveBeenCalledTimes(3);
});
it('ambiguous columns leave calibration untouched and explain how to place the grid',async()=>{
 worker.mockResolvedValue({...good,flags:{...good.flags,colWindowAmbiguous:true}});const {saved}=setup();
 await screen.findByText(/Show the whole mat width/);expect(saved).not.toHaveBeenCalled();
 expect(screen.getByText(/Turn on the zone grid and place it on your mat/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Fit to my mat'})).toBeEnabled();
});
it('cancelled requests cannot save a late high-confidence result',async()=>{
 let complete!:(value:MatFitResult)=>void;worker.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 const {saved,unmount}=setup();await waitFor(()=>expect(worker).toHaveBeenCalledOnce());
 const signal=worker.mock.calls[0][1].signal as AbortSignal;unmount();expect(signal.aborted).toBe(true);
 complete(good);await Promise.resolve();expect(saved).not.toHaveBeenCalled();
});

it('retains fitted bounds across editor nudges and shrinking then regrowing',()=>{
 const {result}=renderHook(()=>useFieldTransform(corners!,undefined,16/9));
 act(()=>result.current.move(0,-.01));act(()=>result.current.move(0,.01));
 act(()=>result.current.scaleBy(.9));act(()=>result.current.scaleBy(1/.9));
 result.current.corners.forEach((p,i)=>expect(Math.hypot(p.x-corners![i].x,p.y-corners![i].y)).toBeLessThan(1e-8));
});

it('keeps a fitted grid local until Save, and Cancel leaves saved calibration intact',async()=>{
 worker.mockResolvedValue(good);const video=camera(),saved=vi.fn(),cancel=vi.fn();
 render(<FieldCalibrationControl video={video} onSave={saved} onCancel={cancel}/>);
 await screen.findByRole('button',{name:'Flip'});
 expect(saved).not.toHaveBeenCalled();
 expect(screen.getByText(/preview/i)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Cancel calibration'}));expect(cancel).toHaveBeenCalledOnce();expect(saved).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save calibration'}));expect(saved).toHaveBeenCalledOnce();
});
it('does not auto-fit a placed manual calibration, but still allows an explicit preview',async()=>{
 worker.mockResolvedValue(good);const video=camera(),saved=vi.fn();
 render(<FieldCalibrationControl video={video} initialCalibration={createFieldCalibration(corners!,{playerSide:'top',mirrored:false})} onSave={saved} onCancel={()=>{}}/>);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});expect(worker).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Fit to my mat'}));await screen.findByRole('button',{name:'Flip'});expect(saved).not.toHaveBeenCalled();
});

it.each(['bottom','top','left','right'] as const)('passes the actual %s side to the fit worker',async side=>{
 worker.mockResolvedValue(good);const video=camera();
 render(<FitToMatControl video={video} auto calibration={createFieldCalibration(corners!,{playerSide:side,mirrored:true})} onBusy={()=>{}} onCapture={()=>{}} onApply={()=>{}}/>);
 await waitFor(()=>expect(worker).toHaveBeenCalledOnce());expect(worker.mock.calls[0][1]).toMatchObject({playerSide:side,mirrored:true});
});
it('uses the phone default bottom side when no side was saved',async()=>{
 worker.mockResolvedValue(good);setup();await waitFor(()=>expect(worker).toHaveBeenCalledOnce());expect(worker.mock.calls[0][1].playerSide).toBe('bottom');
});
