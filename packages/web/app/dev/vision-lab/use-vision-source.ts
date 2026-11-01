"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Source = "camera" | "photo" | null;
interface Frame { bitmap: ImageBitmap; capturedAt: number }
const BUFFER_MS = 1_000;
const MAX_FRAMES = 6;
const CAPTURE_INTERVAL_MS = 200;

function closeFrames(frames: Frame[]) {
  for (const { bitmap } of frames) bitmap.close();
}

/** Owns full-resolution originals. Only cloned snapshots leave this hook for the worker. */
export function useVisionSource(onReset: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ringRef = useRef<Frame[]>([]);
  const photoRef = useRef<ImageBitmap | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const sourceRef = useRef<Source>(null);
  const epochRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameWorkRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const [source, setSource] = useState<Source>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);

  // Capture, eviction, snapshot cloning and disposal share one queue: an original
  // cannot be closed while an asynchronous createImageBitmap is cloning it.
  const serial = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = frameWorkRef.current.then(task);
    frameWorkRef.current = next.then(() => {}, () => {});
    return next;
  }, []);

  const release = useCallback(() => {
    epochRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const oldFrames = ringRef.current;
    const oldPhoto = photoRef.current;
    ringRef.current = [];
    photoRef.current = null;
    sourceRef.current = null;
    void serial(async () => {
      closeFrames(oldFrames);
      oldPhoto?.close();
    });
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
  }, [serial]);

  const stop = useCallback(() => {
    onReset();
    release();
    setSource(null);
    setPhotoUrl(null);
    setPreparing(false);
    setFrameCount(0);
    setDimensions({ width: 0, height: 0 });
    setError(null);
  }, [onReset, release]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      release();
    };
  }, [release]);

  const startCamera = useCallback(async () => {
    stop();
    const epoch = epochRef.current;
    setPreparing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Use HTTPS or localhost to open the camera, or upload a photo.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (epoch !== epochRef.current || !mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable. Try again.");
      video.srcObject = stream;
      await video.play();
      if (epoch !== epochRef.current || !mountedRef.current) return;
      sourceRef.current = "camera";
      setSource("camera");
      setPreparing(false);
      setDimensions({ width: video.videoWidth, height: video.videoHeight });
      for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => {
        if (epoch !== epochRef.current || !mountedRef.current) return;
        stop();
        setError("Camera disconnected. Start it again or upload a photo.");
      }, { once: true });

      const capture = async () => {
        if (epoch !== epochRef.current || !mountedRef.current) return;
        try {
          await serial(async () => {
            if (epoch !== epochRef.current || video.readyState < 2) return;
            const bitmap = await createImageBitmap(video);
            if (epoch !== epochRef.current) { bitmap.close(); return; }
            const now = performance.now();
            ringRef.current.push({ bitmap, capturedAt: now });
            while (ringRef.current.length > MAX_FRAMES || now - ringRef.current[0].capturedAt > BUFFER_MS) {
              ringRef.current.shift()!.bitmap.close();
            }
            setFrameCount(ringRef.current.length);
          });
        } catch {
          if (epoch !== epochRef.current || !mountedRef.current) return;
          stop();
          setError("Could not capture a camera frame. Restart the camera or upload a photo.");
          return;
        }
        if (epoch === epochRef.current && mountedRef.current) timerRef.current = setTimeout(() => { void capture(); }, CAPTURE_INTERVAL_MS);
      };
      void capture();
    } catch (cause) {
      if (epoch !== epochRef.current || !mountedRef.current) return;
      stop();
      setError(cause instanceof Error && cause.name !== "NotAllowedError" ? cause.message : "Camera access was denied. Allow camera access or upload a photo.");
    }
  }, [serial, stop]);

  const loadPhoto = useCallback(async (file: File) => {
    stop(); // Release camera tracks before decoding the uploaded image.
    const epoch = epochRef.current;
    setPreparing(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
      const bitmap = await createImageBitmap(file);
      if (epoch !== epochRef.current || !mountedRef.current) { bitmap.close(); return; }
      photoRef.current = bitmap;
      photoUrlRef.current = URL.createObjectURL(file);
      sourceRef.current = "photo";
      setPhotoUrl(photoUrlRef.current);
      setSource("photo");
      setFrameCount(1);
      setDimensions({ width: bitmap.width, height: bitmap.height });
      setPreparing(false);
    } catch (cause) {
      if (epoch !== epochRef.current || !mountedRef.current) return;
      stop();
      setError(cause instanceof Error ? cause.message : "Could not read this photo. Choose another image.");
    }
  }, [stop]);

  const snapshot = useCallback((): Promise<ImageBitmap[]> => {
    const epoch = epochRef.current;
    return serial(async () => {
      if (epoch !== epochRef.current) throw new Error("The image source changed. Try again.");
      const now = performance.now();
      if (sourceRef.current === "camera") {
        while (ringRef.current.length && now - ringRef.current[0].capturedAt > BUFFER_MS) ringRef.current.shift()!.bitmap.close();
      }
      const originals = sourceRef.current === "photo" && photoRef.current ? [photoRef.current] : ringRef.current.map(frame => frame.bitmap);
      if (!originals.length) throw new Error("Waiting for a camera frame. Try again in a moment.");
      const clones: ImageBitmap[] = [];
      try {
        for (const original of originals) clones.push(await createImageBitmap(original));
        if (epoch !== epochRef.current) throw new Error("The image source changed. Try again.");
        return clones;
      } catch (cause) {
        for (const clone of clones) clone.close();
        throw cause;
      }
    });
  }, [serial]);

  return { videoRef, source, photoUrl, preparing, frameCount, dimensions, error, startCamera, loadPhoto, snapshot, stop };
}
