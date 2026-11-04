'use client';

import { useEffect, useRef, useState } from 'react';
import { CAMERA_LOCK_INITIAL, CameraLock, measureCameraLight, type CameraPoint } from './camera-lock';

type LightSource = { corners?: () => readonly CameraPoint[] | undefined; video?: () => HTMLVideoElement | null };

/** The caller supplies only its own webcam track; phone and opponent tracks are excluded. */
export function useCameraLock(track: MediaStreamTrack | undefined, userKey: string, source?: LightSource) {
  const controller = useRef<CameraLock | null>(null);
  const latest = useRef(source); latest.current = source;
  const [snapshot, setSnapshot] = useState(CAMERA_LOCK_INITIAL);
  useEffect(() => {
    setSnapshot(CAMERA_LOCK_INITIAL);
    if (!track) return;
    // The lobby reuses its preview. At the table, sample only this owner's native track.
    const ownVideo = latest.current?.video ? null : document.createElement('video');
    if (ownVideo) {
      ownVideo.muted = true; ownVideo.playsInline = true; ownVideo.srcObject = new MediaStream([track]);
      void ownVideo.play().catch(() => { /* A blocked preview simply has no pixels to measure. */ });
    }
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
    const lock = new CameraLock(track, userKey, setSnapshot, () => {
      const video = latest.current?.video?.() ?? ownVideo;
      if (document.hidden || !context || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      canvas.width = 320; canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
      context.imageSmoothingEnabled = false;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return measureCameraLight(context.getImageData(0, 0, canvas.width, canvas.height), latest.current?.corners?.());
    });
    controller.current = lock; lock.start();
    return () => {
      lock.dispose(); if (controller.current === lock) controller.current = null;
      if (ownVideo) { ownVideo.pause(); ownVideo.srcObject = null; }
    };
  }, [track, userKey]);
  return { ...snapshot, available: !!track,
    setEnabled: (enabled: boolean) => controller.current?.setEnabled(enabled),
    relock: () => controller.current?.relock() };
}
