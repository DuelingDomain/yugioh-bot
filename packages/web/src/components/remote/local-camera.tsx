"use client";

import { useEffect, useRef, useState } from "react";
import { remoteButton } from "./remote-seat-panel";
import type { RecognizedCard } from "./recognize-card";

export function LocalCamera({ disabled, onIdentify }: { disabled: boolean; onIdentify: (card: RecognizedCard) => void }) {
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(false); const request = useRef<AbortController | null>(null);
  const [enabled, setEnabled] = useState(false); const [starting, setStarting] = useState(false); const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState(""); const [candidates, setCandidates] = useState<RecognizedCard[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stream.current?.getTracks().forEach(track => track.stop()); request.current?.abort(); }; }, []);
  async function start() {
    setStarting(true); setMessage("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs HTTPS or localhost and browser permission.");
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; if (video.current) video.current.srcObject = media; setEnabled(true);
    } catch (e) { if (mounted.current) setMessage((e as Error).message); }
    finally { if (mounted.current) setStarting(false); }
  }
  function stop() {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    request.current?.abort(); setEnabled(false); setCandidates([]);
  }
  async function recognize() {
    const feed = video.current;
    if (!feed?.videoWidth || scanning) { setMessage("Wait for the camera preview, then hold one card in the guide."); return; }
    setScanning(true); setCandidates([]); setMessage("Reading the card locally…");
    const abort = new AbortController(); request.current = abort; const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      // Same 0.69 portrait ratio and centered 85%-height guide as the overlay.
      const height = Math.min(feed.videoHeight * 0.85, feed.videoWidth * 0.9 / 0.69); const width = height * 0.69;
      const canvas = document.createElement("canvas"); canvas.width = 828; canvas.height = 1200;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Camera capture is unavailable");
      context.drawImage(feed, (feed.videoWidth - width) / 2, (feed.videoHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
      const { recognizeLocalCard } = await import("./recognize-card");
      const cards = await recognizeLocalCard(canvas, abort.signal);
      if (mounted.current && !abort.signal.aborted) {
        setCandidates(cards); setMessage(cards.length ? "Choose the public card to identify." : "No card matched. Improve lighting, fill the guide, or enter the name in your board twin.");
      }
    } catch (e) { if (mounted.current) setMessage((e as Error).message); }
    finally { clearTimeout(timer); if (mounted.current) setScanning(false); }
  }
  useEffect(() => { if (disabled) request.current?.abort(); }, [disabled]);
  return <div className="space-y-2">
    <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black text-white">
      <video ref={video} aria-label="Your local camera" autoPlay playsInline muted className={`h-full w-full object-contain ${enabled ? "" : "hidden"}`} />
      {enabled ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-[85%] max-w-[90%] aspect-[0.69] border-2 border-white/70" /></div> : <p className="text-sm">Your webcam · local preview</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      <button className={remoteButton} disabled={starting} onClick={() => { if (enabled) stop(); else void start(); }}>{starting ? "Opening camera…" : enabled ? "Stop camera" : "Enable camera"}</button>
      <button className={remoteButton} disabled={disabled || !enabled || scanning} onClick={() => void recognize()}>{scanning ? "Recognizing…" : "Recognize card"}</button>
    </div>
    <p className="text-xs opacity-70">Hold one face-up card in the guide. Frames stay on this device. First scan downloads OCR assets; only the read name/passcode is sent for catalog matching.</p>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {candidates.map(card => <button key={card.id} className={remoteButton} disabled={disabled || scanning} onClick={() => { onIdentify(card); setCandidates([]); setMessage(`Identified ${card.name}`); }}>Identify {card.name}</button>)}
  </div>;
}
