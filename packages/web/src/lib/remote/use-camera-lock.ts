'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAMERA_LOCK_INITIAL, CameraLock, measureCameraLight, type CameraPoint } from './camera-lock';

type LightSource = { corners?: () => readonly CameraPoint[] | undefined; video?: () => HTMLVideoElement | null };

/** The caller supplies only its own webcam after capture size is ready. */
export function useCameraLock(track: MediaStreamTrack | undefined, userKey: string, source?: LightSource) {
  const controller = useRef<CameraLock | null>(null);
  const latest = useRef(source); latest.current = source;
  const [snapshot, setSnapshot] = useState(CAMERA_LOCK_INITIAL);
  useEffect(() => {
    setSnapshot(CAMERA_LOCK_INITIAL);
    if (!track) return;
    let ownVideo: HTMLVideoElement | undefined;
    const stopMeasurement = () => { if (ownVideo) { ownVideo.pause(); ownVideo.srcObject = null; } };
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
    const lock = new CameraLock(track, userKey, setSnapshot, () => {
      if (document.hidden || !context) return null;
      let video = latest.current?.video?.();
      if (!latest.current?.video) {
        ownVideo ??= document.createElement('video');
        if (!ownVideo.srcObject) {
          ownVideo.muted = true; ownVideo.playsInline = true; ownVideo.srcObject = new MediaStream([track]);
          void ownVideo.play().catch(() => undefined);
        }
        video = ownVideo;
      }
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      canvas.width = 320; canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
      context.imageSmoothingEnabled = false;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return measureCameraLight(context.getImageData(0, 0, canvas.width, canvas.height), latest.current?.corners?.());
    }, stopMeasurement);
    controller.current = lock; lock.start();
    return () => { lock.dispose(); if (controller.current === lock) controller.current = null; stopMeasurement(); };
  }, [track, userKey]);
  const setEnabled = useCallback((enabled: boolean) => controller.current?.setEnabled(enabled), []);
  const relock = useCallback(() => controller.current?.relock(), []);
  return useMemo(() => ({ ...snapshot, available: !!track, setEnabled, relock }), [snapshot, track, setEnabled, relock]);
}
