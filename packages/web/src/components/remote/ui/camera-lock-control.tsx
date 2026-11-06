'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { useCameraLock } from '@/lib/remote/use-camera-lock';
import { useZoneGrid } from '@/lib/remote/zone-grid';
import { FieldOrientationSettings } from '../field-orientation';
import { CardDetectionSetting, RecognitionSetting } from './recognition-setting';
import { useVideoHub } from './video-hub';
import s from './camera-lock-control.module.css';

export function CameraLockControl({ lock }: { lock: ReturnType<typeof useCameraLock> }) {
  const hint = useId();
  return <div className={s.control} data-testid="camera-lock">
    <p className={s.note}>Keeps brightness, colour and focus fixed so card reading stays steady.</p>
    <div className={s.row}>
      <button type="button" className={s.button} aria-label="Camera lock" aria-pressed={lock.enabled} aria-describedby={hint}
        disabled={!lock.available || lock.busy} onClick={() => void lock.setEnabled(!lock.enabled)}>
        Camera lock: {lock.enabled ? 'On' : 'Off'}{!lock.supported && lock.available ? ' (not supported)' : lock.available && lock.enabled && !lock.locked && !lock.busy ? ' (on auto)' : ''}
      </button>
      {lock.supported ? <button type="button" className={s.button} disabled={!lock.available || !lock.enabled || lock.busy} onClick={() => void lock.relock()}>Re-lock</button> : null}
    </div>
    <p id={hint} className={s.note} role="status">{!lock.available ? 'Camera lock works only with a webcam on this computer.' : lock.note || (!lock.supported ? 'Not supported by this browser or camera' : lock.enabled ? '' : 'Camera lock is off.')}</p>
  </div>;
}

/** The "Settings" menu under my own camera. The browser popover stays above clipped feed containers and closes with Escape. */
export function CameraSettingsMore({ lock }: { lock?: ReturnType<typeof useCameraLock> }) {
  const id = useId();
  const grid = useZoneGrid(), hub = useVideoHub();
  // With no camera there is no image to judge: a click here would save a confirmed side and "Is this right?" would never show.
  const hasCamera = grid.ownSeat !== null && !!hub.sourceFor(grid.ownSeat);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect(), node = panel.current;
    if (!box || !node) return;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - node.offsetWidth - 8, box.right - node.offsetWidth))}px`;
    node.style.top = `${Math.max(8, Math.min(window.innerHeight - node.offsetHeight - 8, box.bottom + 6))}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);
  return <>
    <button type="button" ref={trigger} className={s.more} popoverTarget={id} aria-label="Camera settings" data-testid="camera-settings">Settings</button>
    <div id={id} ref={panel} popover="auto" className={s.menu} onToggle={event => { setOpen(event.newState === 'open'); if (event.newState === 'open') place(); }}>
      <CardDetectionSetting />
      <RecognitionSetting />
      {lock ? <CameraLockControl lock={lock} /> : null}
      {grid.setCalibration && hasCamera ? <FieldOrientationSettings calibration={grid.calibration} defaultSide={grid.defaultSide} onChange={grid.setCalibration} /> : null}
    </div>
  </>;
}
