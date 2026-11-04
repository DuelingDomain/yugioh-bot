'use client';

import { useId, useRef } from 'react';
import type { useCameraLock } from '@/lib/remote/use-camera-lock';
import { RecognitionSetting } from './recognition-setting';
import s from './camera-lock-control.module.css';

export function CameraLockControl({ lock }: { lock: ReturnType<typeof useCameraLock> }) {
  const hint = useId();
  return <div className={s.control} data-testid="camera-lock">
    <div className={s.row}>
      <button type="button" className={s.button} aria-pressed={lock.locked} aria-describedby={hint}
        disabled={!lock.available || !lock.supported || lock.busy} onClick={() => void lock.setEnabled(!(lock.locked || lock.enabled))}>
        Camera lock: {lock.locked ? 'on' : 'off'}
      </button>
      {lock.supported ? <button type="button" className={s.button} disabled={!lock.available || lock.busy} onClick={() => void lock.relock()}>Re-lock</button> : null}
    </div>
    <p id={hint} className={s.note} role="status">{!lock.available ? 'Start your webcam to check camera lock.' : lock.busy ? lock.note : !lock.supported ? 'Not supported by this camera' : lock.note || (lock.enabled ? '' : 'Camera lock is off.')}</p>
  </div>;
}

/** The browser popover stays above clipped feed containers and closes with Escape. */
export function CameraSettingsMore({ lock }: { lock?: ReturnType<typeof useCameraLock> }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const place = () => {
    const box = trigger.current?.getBoundingClientRect(), node = panel.current;
    if (!box || !node) return;
    node.style.left = `${Math.max(8, Math.min(window.innerWidth - node.offsetWidth - 8, box.right - node.offsetWidth))}px`;
    node.style.top = `${Math.max(8, Math.min(window.innerHeight - node.offsetHeight - 8, box.bottom + 6))}px`;
  };
  return <>
    <button type="button" ref={trigger} className={s.more} popoverTarget={id} aria-label="More camera settings" data-testid="camera-more">More</button>
    <div id={id} ref={panel} popover="auto" className={s.menu} onToggle={event => { if (event.newState === 'open') place(); }}>
      <RecognitionSetting />
      {lock ? <CameraLockControl lock={lock} /> : null}
    </div>
  </>;
}
