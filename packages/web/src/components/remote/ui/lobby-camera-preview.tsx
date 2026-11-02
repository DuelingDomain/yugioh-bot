"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Crosshair, Keyboard, LoaderCircle, Mic, RefreshCw, ScanLine, Smartphone, TriangleAlert } from "lucide-react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import type { FieldCalibration, FieldFormat } from "@yugidraft/vision";
import { cx, SheetButton, SheetSegmented, SheetSelect, sheetRoot } from "@/components/duel/sheet-ui";
import { loadFieldCalibration, saveFieldCalibration } from "@/lib/remote/use-field-watcher";
import { FieldCalibrationControl } from "../field-calibration";
import { readSavedCamera, saveCamera } from "./camera-choice";
import { detectCards, prewarmRecognizer } from "./recognizer";
import { useVideoHub } from "./video-hub";
import s from "./lobby-camera-preview.module.css";

export type CameraMode = "webcam" | "phone" | "manual";
type Point = { x: number; y: number };
type CheckState = "starting" | "none" | "found" | "unavailable";
type Problem = { kind: "denied" | "none" | "busy" | "insecure" | "other"; message: string };

const MODES = [
  { value: "webcam", label: "Webcam", icon: <Camera size={15} strokeWidth={1.6} aria-hidden /> },
  { value: "phone", label: "Phone", icon: <Smartphone size={15} strokeWidth={1.6} aria-hidden /> },
  { value: "manual", label: "No camera", icon: <Keyboard size={15} strokeWidth={1.6} aria-hidden /> },
] as const;
/** A card stays "found" for this long after the last frame that showed one, so a steady hand does not flicker. */
const FOUND_HOLD_MS = 1800;
const CHECK_EVERY_MS = 650;
const CHECK_WIDTH = 960;

/** The key the table watcher saves this seat's calibration under (see AutoFieldWatcher). */
const seatKeyOf = (room: RemoteRoom) => `${room.guildId}:${room.seats.find(seat => seat.seat === room.mySeat)?.userId ?? "local"}:${room.mySeat}`;
const formatOf = (room: RemoteRoom): FieldFormat => (room.format?.id ?? room.state.deckChecks.format.id) as FieldFormat;

function problemOf(error: unknown): Problem {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied", message: "The browser blocked the camera. Allow it for this site in the address bar, then try again." };
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return { kind: "none", message: "No camera found. Plug one in, or use your phone as the camera." };
  if (name === "NotReadableError" || name === "AbortError") return { kind: "busy", message: "The camera is busy. Close other apps or tabs that use it, then try again." };
  if (error instanceof Error && /HTTPS|localhost/.test(error.message)) return { kind: "insecure", message: error.message };
  return { kind: "other", message: "The camera could not start. Try again." };
}

/** A short plain sentence for each reason the phone line can be down. */
function useQr(url: string) {
  const [qr, setQr] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) { setQr(""); return; }
    let live = true; setFailed(false);
    void import("qrcode").then(q => q.toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: "L" })).then(value => { if (live) setQr(value); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url]);
  return { qr, failed };
}

/** Webcam: own preview stream, mic meter and a card check. Everything is released when this unmounts. */
function WebcamPanel({ room }: { room: RemoteRoom }) {
  const video = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const run = useRef(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(true);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [size, setSize] = useState({ w: 16, h: 9 });
  const [mic, setMic] = useState<"starting" | "on" | "heard" | "off">("starting");
  const [check, setCheck] = useState<CheckState>("starting");
  const [seenOnce, setSeenOnce] = useState(false);
  const [outlines, setOutlines] = useState<Point[][]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const seatKey = seatKeyOf(room);
  const [calibrated, setCalibrated] = useState(false);
  useEffect(() => { setCalibrated(!!loadFieldCalibration(seatKey)); }, [seatKey]);

  const release = useCallback(() => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }, []);
  const start = useCallback(async (wanted: string) => {
    const id = ++run.current;
    release(); setLive(false); setStarting(true); setProblem(null); setOutlines([]);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("The camera needs HTTPS or localhost and browser permission.");
      const any = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      // A remembered camera can be gone. Fall back to the default camera instead of failing.
      const media = wanted
        ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: wanted }, ...any }, audio: false }).catch(() => navigator.mediaDevices.getUserMedia({ video: any, audio: false }))
        : await navigator.mediaDevices.getUserMedia({ video: any, audio: false });
      if (id !== run.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const track = media.getVideoTracks()[0];
      const settings = track?.getSettings() ?? {};
      if (settings.width && settings.height) setSize({ w: settings.width, h: settings.height });
      setCameraId(settings.deviceId ?? wanted);
      setLive(true);
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput")); } catch { /* the list is optional */ }
    } catch (error) { if (id === run.current) setProblem(problemOf(error)); }
    finally { if (id === run.current) setStarting(false); }
  }, [release]);
  useEffect(() => { void start(readSavedCamera()); return () => { run.current++; release(); }; }, [start, release]);
  useEffect(() => {
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(device => device.kind === "videoinput"))).catch(() => undefined); };
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, []);

  const attach = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (element && stream.current && element.srcObject !== stream.current) { element.srcObject = stream.current; void element.play().catch(() => undefined); }
  }, []);
  useEffect(() => {
    const element = video.current;
    if (live && element && stream.current) { element.srcObject = stream.current; void element.play().catch(() => undefined); }
  }, [live]);

  // The mic only feeds a level bar here. Voice commands open their own mic when the table starts.
  useEffect(() => {
    if (!live) return;
    let off = false; let media: MediaStream | undefined; let context: AudioContext | undefined; let timer = 0; let heard = false;
    setMic("starting");
    void (async () => {
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (off) { media.getTracks().forEach(track => track.stop()); return; }
        context = new AudioContext();
        const analyser = context.createAnalyser(); analyser.fftSize = 512;
        context.createMediaStreamSource(media).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        setMic("on");
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0; for (const value of data) { const v = (value - 128) / 128; sum += v * v; }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 5);
          meter.current?.style.setProperty("--level", level.toFixed(3));
          if (level > 0.18 && !heard) { heard = true; setMic("heard"); }
        }, 80);
      } catch { if (!off) setMic("off"); }
    })();
    return () => { off = true; window.clearInterval(timer); media?.getTracks().forEach(track => track.stop()); void context?.close().catch(() => undefined); meter.current?.style.setProperty("--level", "0"); };
  }, [live]);

  // Card check: run the real card detector on the preview. Paused while the tab is hidden or the calibration is open.
  useEffect(() => {
    if (!live) { setCheck("starting"); return; }
    let off = false; let timer = 0; let lastFound = 0;
    void prewarmRecognizer();
    const tick = async () => {
      let delay = CHECK_EVERY_MS;
      const element = video.current;
      if (!document.hidden && !calibrating && element?.videoWidth) {
        const width = Math.min(CHECK_WIDTH, element.videoWidth), height = Math.round(element.videoHeight * width / element.videoWidth);
        try {
          const bitmap = await createImageBitmap(element, { resizeWidth: width, resizeHeight: height });
          const result = await detectCards(bitmap);
          if (off) return;
          if (result.status === "unavailable") { setCheck("unavailable"); return; }
          const cards = result.status === "ready" ? result.cards.filter(card => !card.partial) : [];
          if (cards.length) { lastFound = Date.now(); setSeenOnce(true); setCheck("found"); setOutlines(cards.slice(0, 4).map(card => card.quad)); }
          else if (Date.now() - lastFound > FOUND_HOLD_MS) { setCheck("none"); setOutlines([]); }
          if (result.status === "error") delay = 3000;
        } catch { delay = 3000; }
      }
      if (!off) timer = window.setTimeout(() => void tick(), delay);
    };
    timer = window.setTimeout(() => void tick(), 400);
    return () => { off = true; window.clearTimeout(timer); };
  }, [live, calibrating]);

  if (problem) return <div className={s.problem} role="alert" data-testid="lobby-cam-problem">
    <TriangleAlert size={20} strokeWidth={1.5} aria-hidden />
    <div><p className={s.problemTitle}>{problem.kind === "denied" ? "Camera blocked" : problem.kind === "none" ? "No camera found" : problem.kind === "busy" ? "Camera busy" : "Camera unavailable"}</p>
      <p className={s.hint}>{problem.message}</p></div>
    <SheetButton kind="primary" size="sm" onClick={() => void start(readSavedCamera())} data-testid="lobby-cam-retry"><RefreshCw size={14} aria-hidden /> Try again</SheetButton>
  </div>;

  const checkLine = check === "found" ? <><Check size={15} strokeWidth={2} aria-hidden /> Card found ✓</>
    : check === "unavailable" ? <>Card reader not installed here. The check is skipped.</>
    : check === "starting" ? <><LoaderCircle size={14} className={s.spin} aria-hidden /> Getting the card reader ready…</>
    : seenOnce ? <>Card check passed. Hold a card to test again.</> : <>Hold a card under the camera.</>;
  const micLine = mic === "heard" ? "Hearing you" : mic === "on" ? "Say something. The bar should move." : mic === "off" ? "Microphone blocked or missing. Voice commands need it." : "Starting the microphone…";
  const ratio = size.w / size.h;

  return <div className={s.stage}>
    <div className={s.viewCol}>
      <div className={s.view} style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties} data-found={check === "found" || undefined}>
        <video ref={attach} className={s.video} autoPlay muted playsInline data-testid="lobby-cam-video"
          onLoadedMetadata={event => { const el = event.currentTarget; if (el.videoWidth && el.videoHeight) setSize({ w: el.videoWidth, h: el.videoHeight }); }} />
        {outlines.length ? <svg className={s.outlines} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
          {outlines.map((quad, i) => <polygon key={i} points={quad.map(p => `${p.x},${p.y}`).join(" ")} />)}
        </svg> : null}
        {starting ? <div className={s.veil}><LoaderCircle size={22} className={s.spin} aria-hidden /> Starting camera…</div> : null}
        {live ? <span className={s.chip}><i aria-hidden /> Live · {size.w}×{size.h}</span> : null}
      </div>
    </div>
    <div className={s.controls}>
      {devices.length > 1 ? <SheetSelect label="Camera" value={cameraId} compact disabled={starting}
        choices={devices.map((device, i) => ({ value: device.deviceId, label: device.label || `Camera ${i + 1}` }))}
        onChange={id => { saveCamera(id); void start(id); }} /> : null}
      <div className={s.row}>
        <span className={s.label}><Mic size={13} strokeWidth={1.6} aria-hidden /> Microphone</span>
        <span className={s.meter} ref={meter} aria-hidden><i /></span>
        <p className={s.hint} role="status" data-testid="lobby-cam-mic">{micLine}</p>
      </div>
      <div className={s.row}>
        <span className={s.label}><ScanLine size={13} strokeWidth={1.6} aria-hidden /> Camera check</span>
        <p className={cx(s.check, check === "found" && s.checkOn)} role="status" data-testid="lobby-cam-check" data-state={check}>{checkLine}</p>
      </div>
      <div className={s.row}>
        <span className={s.label}><Crosshair size={13} strokeWidth={1.6} aria-hidden /> Field zones</span>
        <p className={s.hint}>{calibrated ? "Calibrated for this camera ✓" : "Not calibrated yet. Do it now so the duel starts ready."}</p>
        <SheetButton size="sm" disabled={!live} onClick={() => setCalibrating(true)} data-testid="lobby-cam-calibrate">{calibrated ? "Calibrate again" : "Calibrate now"}</SheetButton>
      </div>
    </div>
    {calibrating ? <FieldCalibrationControl video={video.current} format={formatOf(room)}
      onSave={(grid: FieldCalibration) => { saveFieldCalibration(seatKey, grid); setCalibrated(true); setCalibrating(false); }} onCancel={() => setCalibrating(false)} /> : null}
  </div>;
}

/** Phone: the pairing QR (compact) and, once paired, the phone's feed. */
function PhonePanel({ room, onUnpaired }: { room: RemoteRoom; onUnpaired: () => void }) {
  const hub = useVideoHub();
  const seat = room.mySeat;
  const phone = hub.phones.find(item => item.seat === seat);
  const source = hub.sourceFor(seat);
  const video = useRef<HTMLVideoElement>(null);
  const [pair, setPair] = useState<{ code: string; token: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const url = pair && typeof location !== "undefined" ? `${location.origin}/duels/remote/${room.slug}/cam?pair=${encodeURIComponent(pair.token)}` : "";
  const { qr, failed } = useQr(phone?.paired ? "" : url);
  useEffect(() => { const element = video.current; if (element && source) return source.attach(element); }, [source, phone?.paired]);
  useEffect(() => { if (!pair) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [pair]);
  useEffect(() => { if (phone?.paired) setPair(null); }, [phone?.paired]);
  const api = `/api/remote/${room.slug}/phone`;
  const issue = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPair(data); setNow(Date.now()); await hub.refreshPhones();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not make a phone code"); }
    finally { setBusy(false); }
  }, [api, hub]);
  // Choosing Phone makes the first code at once, like the table's own phone button did.
  const asked = useRef(false);
  useEffect(() => { if (!asked.current && !phone?.paired) { asked.current = true; void issue(); } }, [issue, phone?.paired]);
  async function unpair() {
    setBusy(true); setError("");
    try {
      const response = await fetch(api, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error);
      setPair(null); hub.clearPhoneScan("Phone pairing revoked"); await hub.refreshPhones(); onUnpaired();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not unpair the phone"); }
    finally { setBusy(false); }
  }
  const seconds = pair ? Math.max(0, Math.ceil((pair.expiresAt - now) / 1000)) : 0;

  if (phone?.paired) return <div className={s.stage}>
    <div className={s.viewCol}>
      <div className={s.view} style={{ "--ar": "1.7778" } as React.CSSProperties}>
        {source ? <video ref={video} className={s.video} autoPlay muted playsInline data-testid="lobby-phone-video" /> : <div className={s.veil}><LoaderCircle size={22} className={s.spin} aria-hidden /> Waiting for the phone video…</div>}
        {source ? <span className={s.chip}><i aria-hidden /> {hub.health(seat).label}</span> : null}
      </div>
    </div>
    <div className={s.controls}>
      <div className={s.row}><span className={s.label}><Smartphone size={13} strokeWidth={1.6} aria-hidden /> Phone paired ✓</span>
        <p className={s.hint}>Your phone is the field camera. Keep the table open on this computer for card recognition.</p>
        <SheetButton size="sm" disabled={busy} onClick={() => void unpair()} data-testid="lobby-phone-unpair">Unpair phone</SheetButton></div>
      {error ? <p className={s.err} role="alert">{error}</p> : null}
    </div>
  </div>;

  return <div className={s.phoneWait}>
    <div className={s.qrBox} data-testid="lobby-phone-qr-box">
      {qr ? <img src={qr} alt="QR code to connect your phone camera" width={148} height={148} data-testid="phone-qr" />
        : <span className={s.qrEmpty}>{failed ? "QR failed" : busy ? <LoaderCircle size={20} className={s.spin} aria-hidden /> : "No code"}</span>}
    </div>
    <div className={s.phoneText}>
      <p className={s.lead}>Scan with your phone</p>
      <p className={s.hint}>Your phone becomes the field camera. Keep this table open on your computer for card recognition.</p>
      {pair ? <>
        <p className={s.code} data-testid="phone-pair-code">{pair.code}</p>
        <p className={s.hint} role="status">{seconds > 0 ? `One use · expires in ${seconds} s` : "Code expired. Get a new one."}</p>
        <p className={s.hint}>No camera on the phone yet? Open <a href={`/duels/remote/${room.slug}/cam`} target="_blank" rel="noreferrer">the phone camera page</a> and enter the code.</p>
      </> : null}
      {phone && !pair ? <p className={s.hint}>A phone is linked to this seat but not connected. Get a new code to pair it.</p> : null}
      <div className={s.actions}>
        <SheetButton size="sm" kind={pair && seconds > 0 ? "secondary" : "primary"} disabled={busy} onClick={() => void issue()} data-testid="lobby-phone-new-code">{pair ? "New code" : "Show QR code"}</SheetButton>
        {phone ? <SheetButton size="sm" kind="quiet" disabled={busy} onClick={() => void unpair()}>Cancel pairing</SheetButton> : null}
      </div>
      {error ? <p className={s.err} role="alert">{error}</p> : null}
    </div>
  </div>;
}

/**
 * The body of the lobby's camera step: pick the field camera and check it before the duel.
 * It owns the preview stream, so a webcam is held only while this is on screen and in Webcam mode.
 * The server side of each choice (webcam, phone, manual) is made here; `mode` follows the room.
 */
export default function LobbyCameraPreview({ room, mode, onModeChange }: { room: RemoteRoom; mode: CameraMode; onModeChange: (mode: CameraMode) => void }) {
  const hub = useVideoHub();
  const seat = room.mySeat;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ended = room.status === "ended";

  // The room can change this from elsewhere (a paired phone, a revoked phone, a reload): follow it.
  const serverMode: CameraMode = hub.manual(seat) ? "manual" : hub.phones.some(item => item.seat === seat) ? "phone" : "webcam";
  const last = useRef(serverMode);
  useEffect(() => {
    if (last.current === serverMode) return;
    last.current = serverMode;
    if (serverMode !== mode) onModeChange(serverMode);
  }, [serverMode, mode, onModeChange]);

  async function choose(next: CameraMode) {
    if (next === mode || busy) return;
    setBusy(true); setError("");
    try {
      const slug = room.slug;
      if (next === "webcam") {
        // A paired phone is dropped first; its row would otherwise keep the table in phone mode.
        if (hub.phones.some(item => item.seat === seat)) { const gone = await fetch(`/api/remote/${slug}/phone`, { method: "DELETE" }); if (!gone.ok) throw new Error("Could not leave phone mode"); hub.clearPhoneScan(); }
        const response = await fetch(`/api/remote/${slug}/phone`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "webcam" }) });
        if (!response.ok) throw new Error("Could not select webcam mode");
      } else if (next === "manual") {
        const response = await fetch(`/api/remote/${slug}/phone`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "manual" }) });
        if (!response.ok) throw new Error("Could not select no camera");
      }
      await hub.refreshPhones();
      last.current = next === "phone" ? last.current : next;
      onModeChange(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change the camera"); }
    finally { setBusy(false); }
  }

  return <div className={cx(sheetRoot, s.root)} data-testid="lobby-camera-preview" data-mode={mode}>
    <SheetSegmented label="Camera source" hideLabel value={mode} disabled={busy || ended} full
      choices={MODES.map(item => ({ value: item.value, label: item.label, icon: item.icon }))} onChange={value => void choose(value)} />
    {error ? <p className={s.err} role="alert">{error}</p> : null}
    {mode === "webcam" ? <WebcamPanel room={room} />
      : mode === "phone" ? <PhonePanel room={room} onUnpaired={() => { last.current = "webcam"; onModeChange("webcam"); }} />
      : <p className={s.manual} data-testid="lobby-manual-note"><Keyboard size={18} strokeWidth={1.5} aria-hidden /> No camera. You play with your voice, typing and the virtual field. Cards move when you say or type them, or drag them.</p>}
  </div>;
}
