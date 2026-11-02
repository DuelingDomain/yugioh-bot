"use client";

import { useEffect, useState } from "react";
import { RECOGNITION_MODES, setRecognitionMode, useRecognitionBackend, type RecognitionMode } from "./recognition-backend";
import s from "./remote-ui.module.css";

/** Notes already shown on this page: each one is said once. */
const announced = new Set<string>();

/** "Card recognition: Auto / GPU / CPU", saved on this device. The lobby camera step and the table camera menu share it. */
export function RecognitionSetting() {
  const { mode } = useRecognitionBackend();
  const hint = RECOGNITION_MODES.find(item => item.value === mode)?.hint;
  return <select aria-label="Card recognition" title={hint} value={mode} data-testid="recognition-mode" onChange={event => setRecognitionMode(event.target.value as RecognitionMode)}>
    {RECOGNITION_MODES.map(item => <option key={item.value} value={item.value}>Recognition · {item.label}</option>)}
  </select>;
}

/**
 * Where card recognition runs and the last read time: "GPU · 18 ms" or "CPU · 110 ms".
 * `phoneCamera`: the camera is a phone, but recognition still runs on this computer, so this computer's backend is shown.
 */
export function RecognitionBadge({ phoneCamera = false }: { phoneCamera?: boolean }) {
  const { mode, backend, ms, note } = useRecognitionBackend();
  const [say, setSay] = useState("");
  useEffect(() => {
    if (!note || announced.has(note)) return;
    announced.add(note); setSay(note);
    const timer = setTimeout(() => setSay(""), 8000);
    return () => clearTimeout(timer);
  }, [note]);
  const gpu = backend === "webgpu";
  const where = backend ? (gpu ? "GPU" : "CPU") : mode === "cpu" ? "CPU" : "Reader";
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
  </>;
}
