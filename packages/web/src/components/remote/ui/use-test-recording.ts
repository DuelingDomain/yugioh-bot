"use client";

import { useEffect, useRef, useState } from "react";
import { remoteApi } from "./api";

const TIMESLICE_MS = 10_000;
const MAX_QUEUE = 6;
const BITS_PER_SECOND = 2_000_000;
const MIMES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
/** A failure that means "stop for good": the server turned recording off, or the disk is full. */
const FATAL = new Set([403, 404, 415, 507]);

type Session = { stop: (reason: string) => Promise<void>; trackId: string };

/**
 * Test recording (REMOTE_RECORD_USERS only): saves this player's own table camera video, with no audio, on the server for offline
 * recognition tests. It records the very track the field watcher reads, restarts when that track changes, and drops chunks quietly when
 * the network cannot keep up. It never changes the camera and never throws into the table. Returns true while a file is open.
 */
export function useTestRecording({ enabled, slug, video, backend }: { enabled: boolean; slug: string; video: HTMLVideoElement | null; backend?: string }) {
  const [recording, setRecording] = useState(false);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  useEffect(() => {
    if (!enabled || !video || typeof MediaRecorder === "undefined") return;
    let session: Session | null = null, starting = false, dead = false, stopped = false;
    const trackOf = () => {
      const stream = video.srcObject;
      return stream instanceof MediaStream ? stream.getVideoTracks().find(t => t.readyState === "live") ?? null : null;
    };
    const open = async (track: MediaStreamTrack): Promise<Session | null> => {
      const mimeType = MIMES.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { dead = true; return null; }
      const settings = track.getSettings();
      const width = settings.width ?? video.videoWidth, height = settings.height ?? video.videoHeight;
      if (!width || !height) return null;
      const recorder = new MediaRecorder(new MediaStream([track]), { mimeType, videoBitsPerSecond: BITS_PER_SECOND });
      const t0 = Date.now();
      let started: { id: string; serverTime: number };
      try {
        started = await remoteApi<{ id: string; serverTime: number }>(`/${encodeURIComponent(slug)}/recording?action=start`, {
          mime: recorder.mimeType || mimeType, width, height, fps: settings.frameRate ?? null, bitsPerSecond: BITS_PER_SECOND, scaled: false,
          clock: { recorderStartDateNow: t0, recorderStartPerfNow: performance.now(), timeOrigin: performance.timeOrigin },
          appVersion: (process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "").slice(0, 12) || null, backend: backendRef.current ?? null,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        });
      } catch (error) {
        if (FATAL.has((error as { status?: number }).status ?? 0)) dead = true;
        return null;
      }
      const t1 = Date.now();
      // Server clock minus client clock, taken at the middle of the start request.
      const offset = Math.round(started.serverTime - (t0 + t1) / 2), rtt = t1 - t0;
      const queue: { n: number; blob: Blob }[] = [];
      let n = 0, pumping: Promise<void> | null = null, closed = false;
      const send = async (item: { n: number; blob: Blob }) => {
        const query = `id=${started.id}&n=${item.n}${item.n === 0 ? `&offset=${offset}&rtt=${rtt}` : ""}`;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(`/api/remote/${encodeURIComponent(slug)}/recording?${query}`, { method: "POST", cache: "no-store",
              headers: { "content-type": "application/octet-stream" }, body: item.blob, signal: AbortSignal.timeout(30_000) });
            if (response.ok) return;
            if (FATAL.has(response.status)) { dead = true; closed = true; return; }
            if (response.status === 413) { closed = true; return; } // File is full: the poll below opens a new one.
            if (response.status === 409 || response.status === 400) return; // This chunk cannot be accepted: drop it.
          } catch { /* network: retry */ }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      };
      const pump = () => pumping ??= (async () => {
        while (queue.length && !closed) await send(queue.shift()!);
      })().finally(() => { pumping = null; if (queue.length && !closed) void pump(); });
      recorder.ondataavailable = event => {
        if (!event.data.size || closed) return;
        // Chunk 0 holds the video header, so it is kept; the oldest later chunk is dropped when the queue is full.
        if (queue.length >= MAX_QUEUE) queue.splice(queue[0].n === 0 ? 1 : 0, 1);
        queue.push({ n: n++, blob: event.data });
        void pump();
      };
      recorder.onerror = () => { closed = true; };
      recorder.start(TIMESLICE_MS);
      const stop = async (reason: string) => {
        const flushed = new Promise<void>(resolve => { recorder.addEventListener("stop", () => setTimeout(resolve, 0), { once: true }); });
        if (recorder.state !== "inactive") recorder.stop(); else closed = true;
        await Promise.race([flushed, new Promise(resolve => setTimeout(resolve, 3000))]);
        await Promise.race([pumping ?? Promise.resolve(), new Promise(resolve => setTimeout(resolve, 15_000))]);
        closed = true;
        await remoteApi(`/${encodeURIComponent(slug)}/recording?action=end&id=${started.id}`, { reason, backend: backendRef.current ?? null }).catch(() => undefined);
      };
      const watchClosed = setInterval(() => { if (closed && session) { clearInterval(watchClosed); void end("rotated"); } }, 1000);
      return { stop: async reason => { clearInterval(watchClosed); await stop(reason); }, trackId: track.id };
    };
    const end = async (reason: string) => {
      const current = session; session = null; setRecording(false);
      if (current) await current.stop(reason).catch(() => undefined);
    };
    const poll = async () => {
      if (stopped || dead || starting) return;
      const track = trackOf();
      if (session && (!track || track.id !== session.trackId)) await end(track ? "track-changed" : "track-ended");
      if (!session && track && !stopped && !dead) {
        starting = true;
        try { const next = await open(track); if (stopped) await next?.stop("unmount"); else if (next) { session = next; setRecording(true); } } finally { starting = false; }
      }
    };
    const timer = setInterval(() => void poll(), 1000);
    void poll();
    return () => { stopped = true; clearInterval(timer); void end("unmount"); };
  }, [enabled, slug, video]);
  return recording;
}
