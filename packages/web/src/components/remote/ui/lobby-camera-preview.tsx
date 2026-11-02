"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Crosshair, Keyboard, LoaderCircle, Mic, RefreshCw, ScanLine, Smartphone, TriangleAlert } from "lucide-react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import type { FieldCalibration, FieldFormat } from "@yugidraft/vision";
import { cx, SheetButton, SheetSegmented, SheetSelect, sheetRoot } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { loadFieldCalibration, saveFieldCalibration } from "@/lib/remote/use-field-watcher";
import { FieldOrientationControls } from "../field-orientation";
import { defaultGridCalibration, fieldGridCells, projectCell } from "@/lib/remote/zone-grid";
import { FieldCalibrationControl } from "../field-calibration";
import { FIELD_CAMERA_CONSTRAINTS, markCameraReady, readSavedCamera, saveCamera } from "./camera-choice";
import { detectCards, prewarmRecognizer } from "./recognizer";
import { readableCards, toFeedCards } from "./quads";
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
const nameOf = (error: unknown) => (error instanceof DOMException ? error.name : error instanceof Error ? error.name : "");

function problemOf(error: unknown): Problem {
  const name = nameOf(error);
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied", message: "The browser blocked the camera. Allow it for this site in the address bar, then try again." };
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return { kind: "none", message: "No camera found. Plug one in, or use your phone as the camera." };
  if (name === "NotReadableError" || name === "AbortError") return { kind: "busy", message: "The camera is busy. Close other apps or tabs that use it, then try again." };
  if (error instanceof Error && /HTTPS|localhost/.test(error.message)) return { kind: "insecure", message: error.message };
  return { kind: "other", message: "The camera could not start. Try again." };
}

/** True when the browser already holds this permission, so asking again shows no prompt. Unsupported browsers answer false. */
async function permissionGranted(name: "camera" | "microphone"): Promise<boolean> {
  try { return (await navigator.permissions.query({ name: name as PermissionName })).state === "granted"; } catch { return false; }
}

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

/**
 * One seat's live feed from table video. Click a face-up card to test the reader on that seat's camera.
 * The test ids are the ones the phone e2e uses.
 */
function PreviewGrid({calibration,format}:{calibration?:FieldCalibration;format:FieldFormat}){
  const grid=calibration??defaultGridCalibration();
  return <svg className={s.fieldGrid} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
    {fieldGridCells(format).map(cell=>{const {corners,center}=projectCell(cell,grid);return <g key={cell.zone}>
      <polygon points={corners.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')}/>
      <text x={center.x*1000} y={center.y*1000}>{cell.label}</text>
    </g>;})}
  </svg>;
}
async function calibrationCards(frame:HTMLCanvasElement){
  const result=await detectCards(await createImageBitmap(frame));
  if(result.status!=='ready')throw new Error(result.note);
  return result.cards;
}
function SeatFeed({ seat, name, room, cameraKey }: { seat: number; name: string; room?:RemoteRoom; cameraKey?:string }) {
  const hub = useVideoHub();
  const source = hub.sourceFor(seat);
  const video = useRef<HTMLVideoElement>(null);
  const [calibration,setCalibration]=useState<FieldCalibration>();
  const [calibrating,setCalibrating]=useState(false);
  const seatKey=room?seatKeyOf(room):undefined;
  useEffect(()=>{setCalibration(seatKey?loadFieldCalibration(seatKey,cameraKey):undefined);},[seatKey,cameraKey]);
  const saveCalibration=(grid:FieldCalibration)=>{if(seatKey){saveFieldCalibration(seatKey,grid,cameraKey);setCalibration(grid);}};
  const inFlight = useRef(false);
  const [note, setNote] = useState("");
  const [reading, setReading] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => { const element = video.current; if (element && source) return source.attach(element); }, [source]);
  async function read(clientX?: number, clientY?: number) {
    if (inFlight.current) return;
    const element = video.current; if (!element?.videoWidth) return;
    const box = element.getBoundingClientRect(), scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
    const width = element.videoWidth * scale, height = element.videoHeight * scale;
    const x = clientX === undefined ? 0.5 : (clientX - box.left - (box.width - width) / 2) / width;
    const y = clientY === undefined ? 0.5 : (clientY - box.top - (box.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    inFlight.current = true; setReading(true); setNote("Reading on the feed owner's desktop…");
    try { const result = await hub.read(seat, x, y); setNote(result.guesses[0]?.name || result.note || "No card found. Try more light and move closer."); }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not read this frame"); }
    finally { inFlight.current = false; setReading(false); }
  }
  if (!source) return null;
  return <div className={s.feed}>
    <div className={s.view} style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties}>
      <button type="button" className={s.feedButton} disabled={reading} aria-label={`Test card reader on ${name}'s camera`} data-testid={`lobby-phone-feed-${seat}`}
        onPointerDown={event => { if (event.button === 0 && event.isPrimary) void read(event.clientX, event.clientY); }}
        onClick={event => { if (event.detail === 0) void read(); }}>
        <video ref={video} className={s.video} autoPlay playsInline muted
          onLoadedMetadata={event => { const el = event.currentTarget; if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight); }} />
      </button>
      {room?<PreviewGrid calibration={calibration} format={formatOf(room)}/>:null}
      <span className={s.chip}><i aria-hidden /> {name} · {hub.health(seat).label}</span>
    </div>
    {room?<><FieldOrientationControls calibration={calibration??defaultGridCalibration()} onChange={saveCalibration}/>
      <SheetButton size="sm" onClick={()=>setCalibrating(true)}>Calibrate phone zones</SheetButton>
      {calibrating?<FieldCalibrationControl video={video.current} format={formatOf(room)} initialCalibration={calibration} detectCalibrationCards={calibrationCards}
        onSave={grid=>{saveCalibration(grid);setCalibrating(false);}} onCancel={()=>setCalibrating(false)}/>:null}</>:null}
    <p className={ui.hint}>Click a face-up card to test the reader.</p>
    <p className={cx(ui.hint, s.readNote)} role="status" data-testid={`lobby-phone-read-${seat}`}>{note}</p>
  </div>;
}

/** Webcam: own preview stream, mic meter and a card check. Everything is released when this unmounts. */
function WebcamPanel({ room }: { room: RemoteRoom }) {
  const video = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const run = useRef(0);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  // The preview starts by itself only when the browser already allows the camera. Otherwise the person turns it on.
  const [asked, setAsked] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [size, setSize] = useState({ w: 16, h: 9 });
  const [micWanted, setMicWanted] = useState(false);
  const [mic, setMic] = useState<"starting" | "on" | "heard" | "off">("starting");
  const [check, setCheck] = useState<CheckState>("starting");
  const [seenOnce, setSeenOnce] = useState(false);
  const [outlines, setOutlines] = useState<Point[][]>([]);
  const [calibrating, setCalibrating] = useState(false);
  const seatKey = seatKeyOf(room);
  const [calibration,setCalibration]=useState<FieldCalibration>();
  const calibrated=!!calibration?.orientation;
  const readCalibration=useCallback(()=>setCalibration(loadFieldCalibration(seatKey,cameraId||undefined)),[seatKey,cameraId]);
  const saveCalibration=(grid:FieldCalibration)=>{saveFieldCalibration(seatKey,grid,cameraId||undefined);setCalibration(grid);};
  useEffect(() => { readCalibration(); }, [readCalibration]);

  const release = useCallback(() => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }, []);
  const start = useCallback(async (wanted: string) => {
    const id = ++run.current;
    release(); setAsked(true); setLive(false); setStarting(true); setProblem(null); setOutlines([]);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("The camera needs HTTPS or localhost and browser permission.");
      // A remembered camera can be gone. Fall back to the default camera only then, not when the browser blocks it.
      const media = wanted
        ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: wanted }, ...FIELD_CAMERA_CONSTRAINTS }, audio: false }).catch(error => {
          if (nameOf(error) !== "NotFoundError" && nameOf(error) !== "OverconstrainedError") throw error;
          return navigator.mediaDevices.getUserMedia({ video: FIELD_CAMERA_CONSTRAINTS, audio: false });
        })
        : await navigator.mediaDevices.getUserMedia({ video: FIELD_CAMERA_CONSTRAINTS, audio: false });
      if (id !== run.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const track = media.getVideoTracks()[0];
      const settings = track?.getSettings() ?? {};
      if (settings.width && settings.height) setSize({ w: settings.width, h: settings.height });
      setCameraId(settings.deviceId ?? wanted);
      // The camera can be unplugged while the preview runs.
      track?.addEventListener("ended", () => {
        if (id !== run.current) return;
        markCameraReady(room.slug, false);
        setLive(false); setOutlines([]);
        setProblem({ kind: "other", message: "The camera stopped. Plug it in again, or pick another camera." });
      });
      setLive(true);
      try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput")); } catch { /* the list is optional */ }
    } catch (error) { if (id === run.current) setProblem(problemOf(error)); }
    finally { if (id === run.current) setStarting(false); }
  }, [release, room.slug]);
  useEffect(() => {
    let off = false;
    void (async () => {
      const [camera, microphone] = await Promise.all([permissionGranted("camera"), permissionGranted("microphone")]);
      if (off) return;
      if (microphone) setMicWanted(true);
      if (camera) void start(readSavedCamera());
    })();
    return () => { off = true; run.current++; release(); };
  }, [start, release]);
  // The table opens its camera by itself after Start, but only if this preview worked.
  useEffect(() => { if (live) markCameraReady(room.slug, true); }, [live, room.slug]);
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
    if (!micWanted) return;
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
  }, [micWanted]);

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
          // Same test as a click on the table feed: a hand or a shadow is not a card.
          const cards = result.status === "ready" ? readableCards(toFeedCards(result.cards), { w: width, h: height }) : [];
          if (cards.length) { lastFound = Date.now(); setSeenOnce(true); setCheck("found"); setOutlines(cards.map(card => card.quad)); }
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
      <p className={ui.hint}>{problem.message}</p></div>
    <SheetButton kind="primary" size="sm" onClick={() => void start(readSavedCamera())} data-testid="lobby-cam-retry"><RefreshCw size={14} aria-hidden /> Try again</SheetButton>
  </div>;

  const checkLine = check === "found" ? <><Check size={15} strokeWidth={2} aria-hidden /> Card found</>
    : check === "unavailable" ? <>Card reader not installed here. The check is skipped.</>
    : !live ? <>Turn on the preview to check a card.</>
    : check === "starting" ? <><LoaderCircle size={14} className={s.spin} aria-hidden /> Getting the card reader ready…</>
    : seenOnce ? <>Card check passed. Hold a card to test again.</> : <>Hold a card under the camera.</>;
  const micLine = !micWanted ? "Not tested yet." : mic === "heard" ? "Hearing you" : mic === "on" ? "Say something. The bar should move." : mic === "off" ? "Microphone blocked or missing. Voice commands need it." : "Starting the microphone…";
  const zonesLine = !calibrated ? "Not calibrated yet. Do it now so the duel starts ready."
    : "Field zones saved for this seat.";
  const ratio = size.w / size.h;

  return <div className={s.stage}>
    <div className={s.viewCol}>
      <div className={s.view} style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties} data-found={check === "found" || undefined}>
        <video ref={attach} className={s.video} autoPlay muted playsInline data-testid="lobby-cam-video"
          onLoadedMetadata={event => { const el = event.currentTarget; if (el.videoWidth && el.videoHeight) setSize({ w: el.videoWidth, h: el.videoHeight }); }} />
        {live?<PreviewGrid calibration={calibration} format={formatOf(room)}/>:null}
        {outlines.length ? <svg className={s.outlines} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
          {outlines.map((quad, i) => <polygon key={i} points={quad.map(p => `${p.x},${p.y}`).join(" ")} />)}
        </svg> : null}
        {starting ? <div className={s.veil}><LoaderCircle size={22} className={s.spin} aria-hidden /> Starting camera…</div> : null}
        {!asked && !live ? <div className={s.veil}>
          <div className={s.veilBody}>
            <SheetButton kind="primary" onClick={() => void start(readSavedCamera())} data-testid="lobby-cam-start"><Camera size={16} aria-hidden /> Turn on camera preview</SheetButton>
            <p className={ui.hint}>Your browser asks for permission first.</p>
          </div>
        </div> : null}
        {live ? <span className={s.chip}><i aria-hidden /> Live · {size.w}×{size.h}</span> : null}
      </div>
    </div>
    <div className={s.controls}>
      {devices.length > 1 ? <SheetSelect label="Camera" value={cameraId} compact disabled={starting}
        choices={devices.map((device, i) => ({ value: device.deviceId, label: device.label || `Camera ${i + 1}` }))}
        onChange={id => { saveCamera(id); void start(id); }} /> : null}
      <div className={s.row}>
        <span className={cx(ui.label, s.rowLabel)}><Mic size={13} strokeWidth={1.6} aria-hidden /> Microphone</span>
        <span className={s.meter} ref={meter} aria-hidden><i /></span>
        <p className={ui.hint} role="status" data-testid="lobby-cam-mic">{micLine}</p>
        {!micWanted ? <SheetButton size="sm" onClick={() => setMicWanted(true)} data-testid="lobby-cam-mic-start">Test microphone</SheetButton> : null}
      </div>
      <div className={s.row}>
        <span className={cx(ui.label, s.rowLabel)}><ScanLine size={13} strokeWidth={1.6} aria-hidden /> Card check</span>
        <p className={cx(s.check, check === "found" && s.checkOn)} role="status" data-testid="lobby-cam-check" data-state={check}>{checkLine}</p>
      </div>
      <div className={s.row}>
        <span className={cx(ui.label, s.rowLabel)}><Crosshair size={13} strokeWidth={1.6} aria-hidden /> Field zones</span>
        <p className={ui.hint}>{zonesLine}</p>
        <FieldOrientationControls calibration={calibration??defaultGridCalibration()} onChange={saveCalibration} disabled={!live}/>
        <SheetButton size="sm" disabled={!live} onClick={() => setCalibrating(true)} data-testid="lobby-cam-calibrate">{calibrated ? "Calibrate again" : "Calibrate now"}</SheetButton>
      </div>
    </div>
    {calibrating ? <FieldCalibrationControl video={video.current} format={formatOf(room)} initialCalibration={calibration} detectCalibrationCards={calibrationCards}
      onSave={(grid: FieldCalibration) => { saveCalibration(grid); setCalibrating(false); }} onCancel={() => setCalibrating(false)} /> : null}
  </div>;
}

/** Phone: the pairing QR (compact) and, once paired, the phone's feed. */
function PhonePanel({ room, onUnpaired }: { room: RemoteRoom; onUnpaired: () => void }) {
  const hub = useVideoHub();
  const seat = room.mySeat;
  const phone = hub.phones.find(item => item.seat === seat);
  const [pair, setPair] = useState<{ code: string; token: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Read by screen readers only when a code is made or runs out. The visible countdown is silent.
  const [codeNote, setCodeNote] = useState("");
  const url = pair && typeof location !== "undefined" ? `${location.origin}/duels/remote/${room.slug}/cam?pair=${encodeURIComponent(pair.token)}` : "";
  const { qr, failed } = useQr(url);
  useEffect(() => { if (!pair) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [pair]);
  // A code is done once its phone pairs. A code made while a phone is paired (to replace it) stays until it is used or dropped.
  const wasPaired = useRef(!!phone?.paired);
  useEffect(() => { if (phone?.paired && !wasPaired.current) setPair(null); wasPaired.current = !!phone?.paired; }, [phone?.paired]);
  const api = `/api/remote/${room.slug}/phone`;
  const issue = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPair(data); setNow(Date.now()); setCodeNote("New code ready."); await hub.refreshPhones();
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
  const expired = !!pair && seconds === 0;
  useEffect(() => { if (expired) setCodeNote("Code expired. Get a new one."); }, [expired]);

  if (phone?.paired && !pair) {
    const me = room.seats.find(item => item.seat === seat);
    return <div className={s.stage}>
      <div className={s.viewCol}>
        {hub.sourceFor(seat) ? <SeatFeed seat={seat} name={me?.displayName ?? "You"} room={room} cameraKey={`phone:${phone.id}`} />
          : <div className={s.view} style={{ "--ar": "1.7778" } as React.CSSProperties}><div className={s.veil}><LoaderCircle size={22} className={s.spin} aria-hidden /> Waiting for the phone video…</div></div>}
      </div>
      <div className={s.controls}>
        <div className={s.row}>
          <span className={cx(ui.label, s.rowLabel)}><Smartphone size={13} strokeWidth={1.6} aria-hidden /> Phone</span>
          <p className={s.phoneStatus} role="status">{hub.health(seat).label}</p>
          <p className={ui.hint}>Your phone is the field camera. Keep the table open on this computer for card recognition.</p>
          <div className={s.actions}>
            <SheetButton size="sm" disabled={busy} onClick={() => void issue()} data-testid="pair-phone">Replace phone</SheetButton>
            <SheetButton size="sm" kind="quiet" disabled={busy} onClick={() => void unpair()} data-testid="lobby-phone-unpair">Unpair phone</SheetButton>
          </div>
        </div>
        {error ? <p className={s.err} role="alert">{error}</p> : null}
      </div>
    </div>;
  }

  return <div className={s.phoneWait}>
    <div className={s.qrBox} data-testid="lobby-phone-qr-box">
      {qr ? <img src={qr} alt="QR code to connect your phone camera" width={148} height={148} data-testid="phone-qr" />
        : <span className={s.qrEmpty}>{failed ? "QR failed" : busy ? <LoaderCircle size={20} className={s.spin} aria-hidden /> : "No code"}</span>}
    </div>
    <div className={s.phoneText}>
      <p className={s.lead}>Scan with your phone</p>
      <p className={ui.hint}>Your phone becomes the field camera. Keep this table open on your computer for card recognition.</p>
      {pair ? <>
        <p className={s.code} data-testid="phone-pair-code">{pair.code}</p>
        <p className={ui.hint} aria-hidden>{expired ? "Code expired. Get a new one." : `One use · expires in ${seconds} s`}</p>
        <p className={ui.hint}>Cannot scan the code? Open the <a href={`/duels/remote/${room.slug}/cam`} target="_blank" rel="noreferrer">phone camera page</a> and type the code.</p>
      </> : null}
      <p className={ui.srOnly} role="status">{codeNote}</p>
      {phone && !pair ? <p className={ui.hint}>A phone is linked to this seat but not connected. Get a new code to pair it.</p> : null}
      <div className={s.actions}>
        <SheetButton size="sm" kind={pair && !expired ? "secondary" : "primary"} disabled={busy} onClick={() => void issue()} data-testid="pair-phone">{pair ? "New code" : "Show QR code"}</SheetButton>
        {pair && !busy ? <a className={s.linkButton} href={url} target="_blank" rel="noreferrer" data-testid="phone-pair-url">Open camera link</a> : null}
        {phone?.paired ? <SheetButton size="sm" kind="quiet" disabled={busy} onClick={() => setPair(null)}>Keep current phone</SheetButton>
          : phone ? <SheetButton size="sm" kind="quiet" disabled={busy} onClick={() => void unpair()}>Cancel pairing</SheetButton> : null}
      </div>
      {error ? <p className={s.err} role="alert">{error}</p> : null}
    </div>
  </div>;
}

/** Table video of the other seats, so each player sees the opponents' cameras and can test the card reader on them. */
function OtherSeats({ room }: { room: RemoteRoom }) {
  const hub = useVideoHub();
  const others = room.seats.filter(item => item.seat !== room.mySeat && hub.sourceFor(item.seat));
  if (!others.length) return null;
  return <div className={s.others} data-testid="lobby-table-video">
    <p className={ui.label}>Other seats</p>
    <div className={s.otherGrid}>{others.map(item => <SeatFeed key={item.seat} seat={item.seat} name={item.displayName} />)}</div>
  </div>;
}

/**
 * The body of the lobby's camera step: pick the field camera and check it before the duel.
 * It owns the preview stream, so a webcam is held only while this is on screen and in Webcam mode.
 * The server side of each choice (webcam, phone, manual) is made here; `mode` follows the room.
 * Mount it only after the room's saved choice has loaded (`hub.rosterReady`), so no camera starts by mistake.
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
      if (next !== "webcam") markCameraReady(slug, false);
      if (next === "webcam") {
        // A paired phone is dropped first; its row would otherwise keep the table in phone mode.
        if (hub.phones.some(item => item.seat === seat)) { const gone = await fetch(`/api/remote/${slug}/phone`, { method: "DELETE" }); if (!gone.ok) throw new Error("Could not leave phone mode"); hub.clearPhoneScan(); }
        const response = await fetch(`/api/remote/${slug}/phone`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "webcam" }) });
        if (!response.ok) throw new Error("Could not select webcam mode");
      } else if (next === "manual") {
        const response = await fetch(`/api/remote/${slug}/phone`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "manual" }) });
        if (!response.ok) throw new Error("Could not select no camera");
        // No camera still joins table video receive-only, so this player sees the opponents.
        if (!room.solo) await hub.receivePhone();
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
    <OtherSeats room={room} />
  </div>;
}
