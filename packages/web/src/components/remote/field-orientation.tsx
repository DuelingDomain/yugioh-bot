"use client";

import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, mirrorFieldCalibration, rotateFieldCalibration, type FieldCalibration, type PlayerSide } from '@yugidraft/vision';
import s from './field-orientation.module.css';

/** Every camera surface edits the same persisted transform; no CSS-only rotation. */
export function FieldOrientationControls({ calibration, onChange, disabled=false }: { calibration:FieldCalibration; onChange(value:FieldCalibration):void; disabled?:boolean }) {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  // "Flipped" = the player sits at the top of the image (the camera faces them across the table). Pressing again rotates back.
  const flipped=!!calibration.orientation&&orientation.playerSide==='top';
  return <div className={s.controls} data-testid="field-orientation" data-flipped={flipped} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <button type="button" className={s.flip} data-testid="flip-field" disabled={disabled} aria-pressed={flipped}
      title="Camera faces you from across the table? Flip the field 180 degrees. Press again to return." onClick={()=>onChange(rotateFieldCalibration(calibration,180))}>Flip field</button>
    <div role="group" aria-label="Your side of the image"><span>Side</span>
      {(['top','bottom','left','right'] as PlayerSide[]).map(side=><button key={side} type="button" disabled={disabled} aria-pressed={!!calibration.orientation&&orientation.playerSide===side}
        onClick={()=>onChange(createFieldCalibration(calibration.corners,{...orientation,playerSide:side}))}>{side[0].toUpperCase()+side.slice(1)}</button>)}
    </div>
    <button type="button" disabled={disabled} aria-pressed={orientation.mirrored} title="Swap the player's left and right for mirrored video" onClick={()=>onChange(mirrorFieldCalibration(calibration))}>Mirror</button>
    {!calibration.orientation?<small role="status">Pick your side to start auto-placement</small>:null}
  </div>;
}
