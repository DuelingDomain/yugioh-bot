"use client";

import { useEffect, useRef, useState } from "react";
import {pendingSetDecisions,acknowledgeSetDecisions} from "@/lib/remote/set-card-diagnostics";
import { remoteApi } from "./api";

const TIMESLICE_MS = 10_000;
const MAX_QUEUE = 6;
const BITS_PER_SECOND = 2_000_000;
const MIMES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
/** A refusal that means "stop for good": the feature is off for this user, the user is not seated, the type is refused, or the disk is full. */
const FATAL = new Set([403, 404, 415, 507]);
/** Wait before the next start after a failed start or a file that took no chunk. After the last step the hook gives up until reload. */
const BACKOFF_MS = [5_000, 30_000, 120_000, 120_000, 120_000];

/** Wait before a changed calibration is sent: a drag of the mat corners makes many changes, only the one that stays is worth keeping. */
const CALIBRATION_SETTLE_MS = 2_000;
/** A clock sample must not hold up a chunk for long. */
const CLOCK_PING_MS = 3_000;

type Session = { stop: (reason: string) => Promise<void>; trackId: string; calibrate: () => void };
/** What the watcher reads the mat with now: sent at the start and again after each change, so the offline tool can use the same mat. */
export type RecordingCalibration = { calibration: unknown; format: string; placed: boolean; needed: boolean };

/**
 * Test recording (REMOTE_RECORD_USERS only): saves this player's own table camera video, with no audio, on the server for offline
 * recognition tests. It records the very track the field watcher reads, restarts when that track changes, and drops chunks quietly when
 * the network cannot keep up. It never changes the camera and never throws into the table. Returns true while a file is open.
 */
export function useTestRecording({ enabled, slug, video, backend, calibrationRef }: { enabled: boolean; slug: string; video: HTMLVideoElement | null; backend?: string; calibrationRef?: { current: RecordingCalibration | undefined } }) {
  const [recording, setRecording] = useState(false);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  useEffect(() => {
    if (!enabled || !video || typeof MediaRecorder === "undefined") return;
    let session: Session | null = null, starting = false, dead = false, stopped = false, failures = 0, retryAt = 0;
    const noteFailure = () => {
      retryAt = Date.now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      if (++failures > BACKOFF_MS.length) dead = true;
    };
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
      const t0 = Date.now();
      const calibrationKey = () => JSON.stringify(calibrationRef?.current ?? null);
      let sentKey = calibrationKey();
      let started: { id: string; serverTime: number };
      try {
        started = await remoteApi<{ id: string; serverTime: number }>(`/${encodeURIComponent(slug)}/recording?action=start`, {
          mime: mimeType, width, height, fps: settings.frameRate ?? null, bitsPerSecond: BITS_PER_SECOND, scaled: false,
          clock: { recorderStartDateNow: t0, recorderStartPerfNow: performance.now(), timeOrigin: performance.timeOrigin },
          appVersion: (process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "").slice(0, 12) || null, backend: backendRef.current ?? null,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          calibration: calibrationRef?.current ? { at: t0, ...calibrationRef.current } : null,
        });
      } catch (error) {
        if (FATAL.has((error as { status?: number }).status ?? 0)) dead = true; else noteFailure();
        return null;
      }
      const t1 = Date.now();
      // Server clock minus client clock, taken at the middle of the start request.
      const offset = Math.round(started.serverTime - (t0 + t1) / 2), rtt = t1 - t0;
      const queue: { n: number; blob: Blob }[] = [];
      let n = 0, sent = 0, pumping: Promise<void> | null = null, closed = false, recorder: MediaRecorder | null = null;
      // The clocks when the recorder really started: video time 0. Sent with chunk 0, so the start request's round trip is not in it.
      let startDateNow = 0, startPerfNow = 0;
      // Chunk 0 carries the start request's sample; every later chunk times a tiny round trip of its own first (the upload is too slow to time).
      const clockSample = async () => {
        const c0 = Date.now(),decisions=pendingSetDecisions(slug);
        try {
          const reply = await Promise.race([remoteApi<{ serverTime: number }>(`/${encodeURIComponent(slug)}/recording?action=clock&id=${started.id}`, {setCandidates:decisions.map(({n,decision})=>({n,decision}))}), new Promise<null>(resolve => setTimeout(resolve, CLOCK_PING_MS, null))]);
          const c1 = Date.now();if(reply)acknowledgeSetDecisions(decisions.map(d=>d.n));
          return reply ? { offset: Math.round(reply.serverTime - (c0 + c1) / 2), rtt: c1 - c0 } : null;
        } catch { return null; }
      };
      const send = async (item: { n: number; blob: Blob }) => {
        const clock = item.n === 0 ? { offset, rtt } : await clockSample();
        const query = `id=${started.id}&n=${item.n}${clock ? `&offset=${clock.offset}&rtt=${clock.rtt}` : ""}${item.n === 0 ? `&startDateNow=${startDateNow}&startPerfNow=${startPerfNow.toFixed(1)}` : ""}`;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(`/api/remote/${encodeURIComponent(slug)}/recording?${query}`, { method: "POST", cache: "no-store",
              headers: { "content-type": "application/octet-stream" }, body: item.blob, signal: AbortSignal.timeout(30_000) });
            if (response.ok) { sent++; return; }
            const code = ((await response.json().catch(() => ({}))) as { code?: string }).code;
            // The server forgot this recording (restart or deploy), lost the header, or the file is full: close it, the poll opens a new file.
            if (code === "UNKNOWN_RECORDING" || code === "NO_HEADER" || code === "RECORDING_UNAVAILABLE" || code === "RECORDING_TOO_LARGE") { closed = true; return; }
            if (code === "CHUNK_TOO_LARGE") return; // this one chunk is too big: drop it, keep the file
            if (FATAL.has(response.status)) { dead = true; closed = true; return; }
            if (response.status === 409 || response.status === 400) return; // This chunk cannot be accepted: drop it.
          } catch { /* network: retry */ }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      };
      const pump = () => pumping ??= (async () => {
        while (queue.length && !closed) await send(queue.shift()!);
      })().finally(() => { pumping = null; if (queue.length && !closed) void pump(); });
      try {
        recorder = new MediaRecorder(new MediaStream([track]), { mimeType, videoBitsPerSecond: BITS_PER_SECOND });
        recorder.onstart = () => { startDateNow = Date.now(); startPerfNow = performance.now(); };
        recorder.ondataavailable = event => {
          if (!event.data.size || closed) return;
          // Chunk 0 holds the video header, so it is kept; the oldest later chunk is dropped when the queue is full.
          if (queue.length >= MAX_QUEUE) queue.splice(queue[0].n === 0 ? 1 : 0, 1);
          queue.push({ n: n++, blob: event.data });
          void pump();
        };
        recorder.onerror = () => { closed = true; };
        recorder.start(TIMESLICE_MS);
      } catch {
        // The recorder could not start: close the file that was opened and wait before the next try.
        noteFailure();
        void remoteApi(`/${encodeURIComponent(slug)}/recording?action=end&id=${started.id}`, { reason: "recorder-failed", backend: backendRef.current ?? null }).catch(() => undefined);
        return null;
      }
      const stop = async (reason: string) => {
        const active = recorder!;
        const flushed = new Promise<void>(resolve => { active.addEventListener("stop", () => setTimeout(resolve, 0), { once: true }); });
        if (active.state !== "inactive") active.stop(); else closed = true;
        await Promise.race([flushed, new Promise(resolve => setTimeout(resolve, 3000))]);
        await Promise.race([pumping ?? Promise.resolve(), new Promise(resolve => setTimeout(resolve, 15_000))]);
        closed = true;
        const decisions=pendingSetDecisions(slug);
        await remoteApi(`/${encodeURIComponent(slug)}/recording?action=end&id=${started.id}`, { reason, backend: backendRef.current ?? null,setCandidates:decisions.map(({n,decision})=>({n,decision})) }).then(()=>acknowledgeSetDecisions(decisions.map(d=>d.n))).catch(() => undefined);
      };
      const watchClosed = setInterval(() => {
        if (!closed || !session) return;
        clearInterval(watchClosed);
        if (sent < 3) noteFailure(); else failures = 0; // a file with fewer than 3 chunks (a second tab replacing this one) must not be reopened every second
        void end("rotated");
      }, 1000);
      // Called every second by the poll. A changed calibration that stays the same for CALIBRATION_SETTLE_MS is sent; a failed send is not repeated.
      let pendingKey = sentKey, pendingSince = 0;
      const calibrate = () => {
        const key = calibrationKey();
        if (closed || key === sentKey || !calibrationRef?.current) return;
        if (key !== pendingKey) { pendingKey = key; pendingSince = Date.now(); return; }
        if (Date.now() - pendingSince < CALIBRATION_SETTLE_MS) return;
        sentKey = key;
        void remoteApi(`/${encodeURIComponent(slug)}/recording?action=calibration&id=${started.id}`, { at: Date.now(), ...calibrationRef.current }).catch(() => undefined);
      };
      return { stop: async reason => { clearInterval(watchClosed); await stop(reason); }, trackId: track.id, calibrate };
    };
    const end = async (reason: string) => {
      const current = session; session = null; setRecording(false);
      if (current) await current.stop(reason).catch(() => undefined);
    };
    const poll = async () => {
      if (stopped || dead || starting) return;
      const track = trackOf();
      session?.calibrate();
      if (session && (!track || track.id !== session.trackId)) await end(track ? "track-changed" : "track-ended");
      if (!session && track && !stopped && !dead && Date.now() >= retryAt) {
        starting = true;
        try { const next = await open(track); if (stopped) await next?.stop("unmount"); else if (next) { session = next; setRecording(true); } }
        catch { noteFailure(); } finally { starting = false; }
      }
    };
    const timer = setInterval(() => void poll().catch(() => undefined), 1000);
    void poll().catch(() => undefined);
    return () => { stopped = true; clearInterval(timer); void end("unmount"); };
  }, [enabled, slug, video]);
  return recording;
}
