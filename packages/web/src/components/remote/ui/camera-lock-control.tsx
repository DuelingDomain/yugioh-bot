'use client';

import { useId } from 'react';
import type { useCameraLock } from '@/lib/remote/use-camera-lock';
import s from './camera-lock-control.module.css';

export function CameraLockControl({ lock }: { lock: ReturnType<typeof useCameraLock> }) {
  const hint = useId();
  const unsupported = lock.available && !lock.supported, reason = 'Not supported by this browser or camera';
  return <div className={s.control} data-testid="camera-lock">
    <p className={s.note}>Keeps brightness, colour and focus fixed so card reading stays steady.</p>
    <div className={s.row}>
      <button type="button" className={`${s.button} ${s.switchBtn}`} aria-label="Camera lock" aria-pressed={lock.enabled} aria-describedby={hint} title={unsupported ? reason : undefined}
        disabled={!lock.available || lock.busy || (!lock.supported && lock.available)} onClick={() => void lock.setEnabled(!lock.enabled)}>
        <span>Camera lock</span><i className={s.sw} aria-hidden="true" />
        <span className={s.srOnly}>: {lock.enabled ? 'On' : 'Off'}{!lock.supported && lock.available ? ' (not supported)' : lock.available && lock.enabled && !lock.locked && !lock.busy ? ' (on auto)' : ''}</span>
      </button>
      {lock.supported ? <button type="button" className={s.button} disabled={!lock.available || !lock.enabled || lock.busy} onClick={() => void lock.relock()}>Re-lock</button> : null}
    </div>
    <p id={hint} className={s.note} role="status">{!lock.available ? 'Camera lock works only with a webcam on this computer.' : lock.note || (unsupported ? reason : lock.enabled ? '' : 'Camera lock is off.')}</p>
  </div>;
}
