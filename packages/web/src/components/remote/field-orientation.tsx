"use client";

import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, mirrorFieldCalibration, type FieldCalibration, type PlayerSide } from '@yugidraft/vision';
import { DEFAULT_GRID_CORNERS, displayCalibration } from '@/lib/remote/zone-grid';
import { ThemedSelect } from '@/components/ui/themed-select';
import s from './field-orientation.module.css';

type OrientationProps = { calibration?:FieldCalibration; defaultSide?:PlayerSide; onChange(value:FieldCalibration):void; disabled?:boolean };

/** Every camera surface edits the same persisted transform; no CSS-only rotation. */
function useOrientation({ calibration, defaultSide='bottom', onChange }: OrientationProps) {
  const shown=displayCalibration(calibration,defaultSide);
  const orientation=shown.orientation??DEFAULT_FIELD_ORIENTATION;
  const corners=calibration?.corners??DEFAULT_GRID_CORNERS;
  return {
    orientation,
    unconfirmed:!calibration?.orientation,
    flipped:orientation.playerSide==='top',
    set:(side:PlayerSide)=>onChange(createFieldCalibration(corners,{...orientation,playerSide:side})),
    mirror:()=>onChange(mirrorFieldCalibration(createFieldCalibration(corners,orientation))),
  };
}
type Orientation = ReturnType<typeof useOrientation>;
const SIDES: PlayerSide[] = ['top','bottom','left','right'];
const sideName = (side:PlayerSide) => side[0].toUpperCase()+side.slice(1);
const stop = (event:{stopPropagation():void}) => event.stopPropagation();

function SideButtons({ orientation:{orientation,set}, disabled }: { orientation:Orientation; disabled:boolean }) {
  return <>{SIDES.map(side=><button key={side} type="button" disabled={disabled} aria-pressed={orientation.playerSide===side} onClick={()=>set(side)}>{sideName(side)}</button>)}</>;
}
function MirrorButton({ orientation:{orientation,mirror}, disabled }: { orientation:Orientation; disabled:boolean }) {
  return <button type="button" disabled={disabled} aria-pressed={orientation.mirrored} title="Swap the player's left and right for mirrored video" onClick={mirror}>Mirror</button>;
}
function ConfirmHint({ orientation:{orientation,set}, disabled, className }: { orientation:Orientation; disabled:boolean; className:string }) {
  return <span className={className} role="status" data-testid="orientation-hint">Is this right? <small>Auto-placement paused</small>
    <button type="button" disabled={disabled} data-testid="orientation-confirm" onClick={()=>set(orientation.playerSide)}>Yes</button></span>;
}

/**
 * The lobby and calibration surfaces, which have no Settings menu.
 * "Camera faces me" = the player sits at the top of the image (flipped); "Camera from my view" = at the bottom (normal).
 * Without a saved side the control shows a guess and asks "Is this right?"; auto-placement stays paused until the player answers.
 */
export function FieldOrientationControls({ confirmHint=true, disabled=false, ...props }: OrientationProps&{ confirmHint?:boolean }) {
  const value=useOrientation(props);
  const {flipped,orientation,set,unconfirmed}=value;
  return <div className={s.controls} data-testid="field-orientation" data-flipped={flipped} data-confirmed={!unconfirmed} onPointerDown={stop} onClick={stop}>
    <div role="group" aria-label="Where is the camera?" className={s.segment}>
      <button type="button" data-testid="camera-faces-me" disabled={disabled} aria-pressed={flipped} onClick={()=>set('top')}>Camera faces me</button>
      <button type="button" data-testid="camera-my-view" disabled={disabled} aria-pressed={orientation.playerSide==='bottom'} onClick={()=>set('bottom')}>Camera from my view</button>
    </div>
    <details className={s.more}>
      <summary>More</summary>
      <div role="group" aria-label="Your side of the image"><span>Side</span><SideButtons orientation={value} disabled={disabled} /></div>
      <MirrorButton orientation={value} disabled={disabled} />
    </details>
    {unconfirmed&&confirmHint?<ConfirmHint orientation={value} disabled={disabled} className={s.hint} />:null}
  </div>;
}

/**
 * The compact dropdown on the camera at the table. Side and Mirror are in the Settings menu under the camera (`FieldOrientationSettings`).
 * A side set there to Left or Right has no choice here, so the button names it.
 * The wrapper also stops the list's events: React sends them from the portal through this tree to the feed.
 * `onPointerEnter` lets the feed drop what it started before the pointer got here, because it sees no moves from here on.
 */
export function FieldOrientationSelect({ disabled=false, onPointerEnter, ...props }: OrientationProps&{ onPointerEnter?():void }) {
  const value=useOrientation(props);
  const {flipped,orientation,set,unconfirmed}=value;
  return <div className={s.orientation} data-testid="field-orientation" data-flipped={flipped} data-confirmed={!unconfirmed} onPointerEnter={onPointerEnter} onPointerDown={stop} onPointerMove={stop} onClick={stop}>
    <ThemedSelect<PlayerSide> variant="menu" className={s.select} label="Where is the camera?" testId="camera-orientation" disabled={disabled} saveSame={unconfirmed} releaseFocusOnPick
      value={orientation.playerSide} placeholder={`My side: ${sideName(orientation.playerSide)}`} onChange={set}
      choices={[{value:'top',label:'Camera faces me'},{value:'bottom',label:'Camera from my view'}]} />
    {unconfirmed?<ConfirmHint orientation={value} disabled={disabled} className={`${s.controls} ${s.hint}`} />:null}
  </div>;
}

/** Side and Mirror, in the table's camera Settings menu. They edit the same saved calibration as the dropdown on the camera. */
export function FieldOrientationSettings({ disabled=false, ...props }: OrientationProps) {
  const value=useOrientation(props);
  return <div className={s.settings} data-testid="camera-side-settings">
    <div role="group" aria-label="Your side of the image"><span>Your side of the image</span><div className={s.settingsRow}><SideButtons orientation={value} disabled={disabled} /></div></div>
    <div className={s.settingsRow}><MirrorButton orientation={value} disabled={disabled} /></div>
  </div>;
}
