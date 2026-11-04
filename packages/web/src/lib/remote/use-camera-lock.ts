'use client';

import { useEffect, useRef, useState } from 'react';
import { CAMERA_LOCK_INITIAL, CameraLock } from './camera-lock';

/** The caller supplies only its own webcam track; phone and opponent tracks are excluded. */
export function useCameraLock(track: MediaStreamTrack | undefined, userKey: string) {
  const controller = useRef<CameraLock | null>(null);
  const [snapshot, setSnapshot] = useState(CAMERA_LOCK_INITIAL);
  useEffect(() => {
    setSnapshot(CAMERA_LOCK_INITIAL);
    if (!track) return;
    const lock = new CameraLock(track, userKey, setSnapshot);
    controller.current = lock; lock.start();
    return () => { lock.dispose(); if (controller.current === lock) controller.current = null; };
  }, [track, userKey]);
  return { ...snapshot, available: !!track,
    setEnabled: (enabled: boolean) => controller.current?.setEnabled(enabled),
    relock: () => controller.current?.relock() };
}
