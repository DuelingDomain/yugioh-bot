"use client";

import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, mirrorFieldCalibration, type FieldCalibration, type PlayerSide } from '@yugidraft/vision';
import { DEFAULT_GRID_CORNERS, displayCalibration } from '@/lib/remote/zone-grid';
import s from './field-orientation.module.css';

/**
 * Every camera surface edits the same persisted transform; no CSS-only rotation.
 * "Camera faces me" = the player sits at the top of the image (flipped); "Camera from my view" = at the bottom (normal).
 * Without a saved side the control shows a guess and asks "Is this right?"; auto-placement stays paused until the player answers.
 */
export function FieldOrientationControls({ calibration, defaultSide='bottom', confirmHint=true, onChange, disabled=false }: { calibration?:FieldCalibration; defaultSide?:PlayerSide; confirmHint?:boolean; onChange(value:FieldCalibration):void; disabled?:boolean }) {
  const shown=displayCalibration(calibration,defaultSide);
  const orientation=shown.orientation??DEFAULT_FIELD_ORIENTATION;
  const corners=calibration?.corners??DEFAULT_GRID_CORNERS;
  const unconfirmed=!calibration?.orientation;
  const set=(side:PlayerSide)=>onChange(createFieldCalibration(corners,{...orientation,playerSide:side},calibration?.zoneSpacing,calibration?.zones));
  const flipped=orientation.playerSide==='top';
  return <div className={s.controls} data-testid="field-orientation" data-flipped={flipped} data-confirmed={!unconfirmed} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <div role="group" aria-label="Where is the camera?" className={s.segment}>
      <button type="button" data-testid="camera-faces-me" disabled={disabled} aria-pressed={flipped} onClick={()=>set('top')}>Camera faces me</button>
      <button type="button" data-testid="camera-my-view" disabled={disabled} aria-pressed={orientation.playerSide==='bottom'} onClick={()=>set('bottom')}>Camera from my view</button>
    </div>
    <details className={s.more}>
      <summary>More</summary>
      <div role="group" aria-label="Your side of the image"><span>Side</span>
        {(['top','bottom','left','right'] as PlayerSide[]).map(side=><button key={side} type="button" disabled={disabled} aria-pressed={orientation.playerSide===side} onClick={()=>set(side)}>{side[0].toUpperCase()+side.slice(1)}</button>)}
      </div>
      <button type="button" disabled={disabled} aria-pressed={orientation.mirrored} title="Swap the player's left and right for mirrored video" onClick={()=>onChange(mirrorFieldCalibration(createFieldCalibration(corners,orientation,calibration?.zoneSpacing,calibration?.zones)))}>Mirror</button>
    </details>
    {unconfirmed&&confirmHint?<span className={s.hint} role="status" data-testid="orientation-hint">Is this right? <small>Auto-placement paused</small>
      <button type="button" disabled={disabled} data-testid="orientation-confirm" onClick={()=>set(orientation.playerSide)}>Yes</button></span>:null}
  </div>;
}
