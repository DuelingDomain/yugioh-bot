"use client";

import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, mirrorFieldCalibration, rotateFieldCalibration, type FieldCalibration, type PlayerSide } from '@yugidraft/vision';
import s from './field-orientation.module.css';

/** Every camera surface edits the same persisted transform; no CSS-only rotation. */
export function FieldOrientationControls({ calibration, onChange, disabled=false }: { calibration:FieldCalibration; onChange(value:FieldCalibration):void; disabled?:boolean }) {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  return <div className={s.controls} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    {!calibration.orientation?<strong role="status">Which side are you on? <small>Auto-placement paused</small></strong>:<span>Player: {orientation.playerSide} of image</span>}
    <div role="group" aria-label="Your side of the image">
      {(['top','bottom','left','right'] as PlayerSide[]).map(side=><button key={side} type="button" disabled={disabled} aria-pressed={!!calibration.orientation&&orientation.playerSide===side}
        onClick={()=>onChange(createFieldCalibration(calibration.corners,{...orientation,playerSide:side}))}>{side[0].toUpperCase()+side.slice(1)}</button>)}
    </div>
    <div role="group" aria-label="Adjust grid orientation">
      <button type="button" disabled={disabled} onClick={()=>onChange(rotateFieldCalibration(calibration,180))}>Rotate 180°</button>
      <button type="button" disabled={disabled} onClick={()=>onChange(rotateFieldCalibration(calibration,90))}>Rotate 90°</button>
      <button type="button" disabled={disabled} aria-pressed={orientation.mirrored} title="Swap the player's left and right for mirrored video" onClick={()=>onChange(mirrorFieldCalibration(calibration))}>Mirror</button>
    </div>
  </div>;
}
