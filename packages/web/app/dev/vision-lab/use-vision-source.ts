"use client";

import {createOwnFeedBuffer} from "@yugidraft/vision";
import { useCallback, useEffect, useRef, useState } from "react";

type Source = "camera" | "photo" | null;
/** Owns full-resolution originals. Only cloned snapshots leave this hook for the worker. */
export function useVisionSource(onReset: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef=useRef<ReturnType<typeof createOwnFeedBuffer>|null>(null);
  const photoRef = useRef<ImageBitmap | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const sourceRef = useRef<Source>(null);
  const epochRef = useRef(0);
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
    bufferRef.current?.stop();bufferRef.current=null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const oldPhoto = photoRef.current;
    photoRef.current = null;
    sourceRef.current = null;
    void serial(async () => {
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

      bufferRef.current=createOwnFeedBuffer(video,count=>{if(epoch===epochRef.current && mountedRef.current)setFrameCount(count);});
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
      if(sourceRef.current==='camera') {
        if(!bufferRef.current)throw new Error('Waiting for a camera frame.');
        const frames=await bufferRef.current.snapshot();
        if(epoch!==epochRef.current){frames.forEach(f=>f.close());throw new Error('The image source changed.');}
        return frames;
      }
      const originals=photoRef.current?[photoRef.current]:[];
      if(!originals.length)throw new Error('Waiting for an image.');
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
