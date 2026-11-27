"use client";

import {useSetGuards,SET_GUARD_SETTINGS} from '@/lib/remote/set-card-settings';
import { useEffect, useId, useState } from "react";
import { SheetButton, sheetRoot } from "@/components/duel/sheet-ui";
import { ThemedSelect as SheetSelect } from "@/components/ui/themed-select";
import ui from "@/components/duel/sheet-ui.module.css";
import { CARD_READERS, hasBrowserGpu, recognitionCpuReason, RECOGNITION_MODES, retryRecognitionGpu, setCardReader, setRecognitionMode, useRecognitionBackend } from "./recognition-backend";
import { useCardDetection } from "@/lib/remote/zone-grid";
import { useVideoHub } from "./video-hub";
import s from "./remote-ui.module.css";
import { ThemedSelect } from "@/components/ui/themed-select";

/** Notes already shown on this page: each one is said once. */
const announced = new Set<string>();
const currentReader = CARD_READERS.filter(reader => reader.value === "current");

/**
 * "Card recognition: Auto / GPU / CPU", saved on this device. The lobby camera step and the table camera menu share it.
 * `sheet` (default) is the standard Match Sheet select for the lobby; `menu` is the small themed select for the table's camera bar,
 * which sits on the table's own dark theme.
 */
export function RecognitionSetting({ variant = "sheet" }: { variant?: "sheet" | "menu" }) {
  const recognition = useRecognitionBackend();
  const { mode, backend, note, reader, readerNote, hybridEnabled, gpuRetryAt } = recognition;
  const [, refreshRetryTime] = useState(0);
  useEffect(() => {
    if (gpuRetryAt === null) return;
    const timer = setInterval(() => refreshRetryTime(tick => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, [gpuRetryAt]);
  const readers = hybridEnabled ? CARD_READERS : currentReader;
  const hintId = useId();
  const hint = RECOGNITION_MODES.find(item => item.value === mode)?.hint;
  const onCpu = backend === "wasm" || mode === "cpu";
  const engine = backend === "webgpu" ? "GPU" : onCpu ? `CPU (${recognitionCpuReason(recognition)})` : "Waiting for reader";
  const engineStatus = <>
    <p role="status" className={ui.hint} style={{ margin: 0 }} title={note || undefined}>Card recognition · {engine}</p>
    {onCpu && mode !== "cpu" && hasBrowserGpu() && <SheetButton size="sm" onClick={retryRecognitionGpu}>Try GPU again</SheetButton>}
  </>;
  if (variant === "menu") {
    return <><ThemedSelect variant="menu" wide label="Card recognition" prefix="Card recognition ·" title={hint} value={mode} testId="recognition-mode"
      choices={RECOGNITION_MODES.map(item => ({ value: item.value, label: item.label, description: item.hint }))} onChange={setRecognitionMode} />
      <ThemedSelect variant="menu" wide label="Card reader" prefix="Reader ·" value={reader} testId="card-reader" choices={readers} onChange={setCardReader} />
      {engineStatus}
      {readerNote?<span role="status" className={s.backendNote}>{readerNote}</span>:null}</>;
  }
  return <div className={sheetRoot} style={{ display: "grid", gap: 5 }}>
    <SheetSelect label="Card recognition" value={mode} testId="recognition-mode" describedBy={hintId} compact
      choices={RECOGNITION_MODES.map(item => ({ value: item.value, label: item.label }))}
      onChange={setRecognitionMode} />
    <p id={hintId} className={ui.hint} style={{ margin: 0 }}>{hint}</p>
    <SheetSelect label="Card reader" value={reader} testId="card-reader" compact choices={readers} onChange={setCardReader} />
    {engineStatus}
    {readerNote?<p role="status" className={ui.hint} style={{margin:0}}>{readerNote}</p>:null}
  </div>;
}

/** "Card detection: Auto-detect / Tap to identify" in the table's camera menu. The same state and saved answer as the Auto-detect checkbox. */
export function CardDetectionSetting() {
  const detection = useCardDetection();
  const hintId = useId();
  if (!detection) return null;
  return <div className={sheetRoot} style={{ display: "grid", gap: 5 }}>
    <SheetSelect label="Card detection" value={detection.autoDetect ? "auto" : "tap"} testId="card-detection" describedBy={hintId} compact
      choices={[{ value: "auto", label: "Auto-detect" }, { value: "tap", label: "Tap to identify" }]}
      onChange={value => detection.set(value === "auto")} />
    <p id={hintId} className={ui.hint} style={{ margin: 0 }}>{detection.autoDetect ? "Watches the field and keeps the board up to date." : "Click a card in any camera to read it. Uses the processor only when you click."}</p>
  </div>;
}

/**
 * Where card recognition runs and the last read time: "GPU · 18 ms" or "CPU · 110 ms".
 * `phoneCamera`: the camera is a phone, but recognition still runs on this computer, so this computer's backend is shown.
 */
export function RecognitionBadge({ phoneCamera = false }: { phoneCamera?: boolean }) {
  const { mode, backend, ms, note, readerNote } = useRecognitionBackend();
  const [say, setSay] = useState("");
  useEffect(() => {
    setSay("");
    if (mode === "cpu" || !note || announced.has(note)) return;
    announced.add(note); setSay("Card recognition is using the CPU. Open camera settings for details.");
    const timer = setTimeout(() => setSay(""), 8000);
    return () => clearTimeout(timer);
  }, [mode, note]);
  const gpu = backend === "webgpu";
  // Keep the full GPU error in the tooltip for troubleshooting.
  const where = gpu ? "GPU" : backend === "wasm" || mode === "cpu" ? "CPU" : "Reader";
  const label = `${phoneCamera ? "Computer · " : ""}${where}${ms === null ? "" : ` · ${ms} ms`}`;
  const title = [
    backend ? `Card recognition runs on the ${gpu ? "graphics card (GPU)" : "processor (CPU)"}${ms === null ? "." : `. Last read: ${ms} ms.`}` : "Card recognition starts with the first read.",
    phoneCamera ? "Your phone is the camera. It sends frames, and this computer reads them." : "",
    note,
    "Change it in the camera menu.",
  ].filter(Boolean).join(" ");
  return <>
    <span className={`${s.backendBadge} ${gpu ? s.backendGpu : ""}`} title={title} data-testid="recognition-backend" data-backend={backend ?? "pending"}>{label}</span>
    {say ? <span className={s.backendNote} role="status" data-testid="recognition-note">{say}</span> : null}
    {readerNote?<span className={s.backendNote} role="status" data-testid="reader-note">{readerNote}</span>:null}
  </>;
}

/** "Video to the table: Smooth (30 fps) / Lighter (15 fps)" in the table's camera menu. Applies to the running camera at once; saved on this device. */
export function VideoRateSetting() {
  const hub = useVideoHub();
  const hintId = useId();
  if (!hub.videoRateAvailable) return null;
  return <div className={sheetRoot} style={{ display: "grid", gap: 5 }}>
    <SheetSelect label="Video to the table" value={String(hub.videoRate)} testId="video-rate" describedBy={hintId} compact
      choices={[{ value: "30", label: "Smooth (30 fps)" }, { value: "15", label: "Lighter (15 fps)" }]}
      onChange={value => hub.setVideoRate(value === "15" ? 15 : 30)} />
    <p id={hintId} className={ui.hint} style={{ margin: 0 }}>{hub.videoRate === 30 ? "Opponents see your camera at up to 30 frames per second." : "Uses less of this computer and less network. Opponents see up to 15 frames per second."}</p>
  </div>;
}

/** Shown to a player whose table camera is being saved for recognition tests (REMOTE_RECORD_USERS). */
export function RecordingBadge() {
  return <span className={s.recBadge} data-testid="test-recording" role="status" aria-label="Test recording on: your table camera is saved, video only, no sound" title="Test recording: your table camera is saved for recognition tests (video only, no sound)">REC</span>;
}

/** Individually switchable comparison layers for the current Remote Duels testers. */
export function SetCardSettings(){
  const {guards,set}=useSetGuards();
  return <details className={sheetRoot}><summary>Set card checks</summary>{SET_GUARD_SETTINGS.map(({key,label})=><label key={key} style={{display:'block',marginTop:8}}><input type="checkbox" checked={guards[key]} onChange={event=>set(key,event.target.checked)}/>{label}</label>)}</details>;
}
