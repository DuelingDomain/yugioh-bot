"use client";

import { useEffect, useId, useState } from "react";
import { sheetRoot } from "@/components/duel/sheet-ui";
import { ThemedSelect as SheetSelect } from "@/components/ui/themed-select";
import ui from "@/components/duel/sheet-ui.module.css";
import { RECOGNITION_MODES, setRecognitionMode, useRecognitionBackend } from "./recognition-backend";
import { useCardDetection } from "@/lib/remote/zone-grid";
import s from "./remote-ui.module.css";
import { ThemedSelect } from "@/components/ui/themed-select";

/** Notes already shown on this page: each one is said once. */
const announced = new Set<string>();

/**
 * "Card recognition: Auto / GPU / CPU", saved on this device. The lobby camera step and the table camera menu share it.
 * `sheet` (default) is the standard Match Sheet select for the lobby; `menu` is the small themed select for the table's camera bar,
 * which sits on the table's own dark theme.
 */
export function RecognitionSetting({ variant = "sheet" }: { variant?: "sheet" | "menu" }) {
  const { mode } = useRecognitionBackend();
  const hintId = useId();
  const hint = RECOGNITION_MODES.find(item => item.value === mode)?.hint;
  if (variant === "menu") {
    return <ThemedSelect variant="menu" wide label="Card recognition" prefix="Recognition ·" title={hint} value={mode} testId="recognition-mode"
      choices={RECOGNITION_MODES.map(item => ({ value: item.value, label: item.label, description: item.hint }))} onChange={setRecognitionMode} />;
  }
  return <div className={sheetRoot} style={{ display: "grid", gap: 5 }}>
    <SheetSelect label="Card recognition" value={mode} testId="recognition-mode" describedBy={hintId} compact
      choices={RECOGNITION_MODES.map(item => ({ value: item.value, label: item.label }))}
      onChange={setRecognitionMode} />
    <p id={hintId} className={ui.hint} style={{ margin: 0 }}>{hint}</p>
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
  const { mode, backend, ms, note } = useRecognitionBackend();
  const [say, setSay] = useState("");
  useEffect(() => {
    if (!note || announced.has(note)) return;
    announced.add(note); setSay(note);
    const timer = setTimeout(() => setSay(""), 8000);
    return () => clearTimeout(timer);
  }, [note]);
  const gpu = backend === "webgpu";
  const where = backend ? (gpu ? "GPU" : note ? `CPU (GPU unavailable: ${note})` : "CPU") : mode === "cpu" ? "CPU" : "Reader";
  const label = `${phoneCamera ? "Computer · " : ""}${where}${ms === null ? "" : ` · ${ms} ms`}`;
  const title = [
    backend ? `Card recognition runs on the ${gpu ? "graphics card (GPU)" : "processor (CPU)"}${ms === null ? "." : `. Last read: ${ms} ms.`}` : "Card recognition starts with the first read.",
    phoneCamera ? "Your phone is the camera. It sends frames, and this computer reads them." : "",
    note,
    "Change it in the camera menu.",
  ].filter(Boolean).join(" ");
  return <>
    <span className={`${s.backendBadge} ${gpu ? s.backendGpu : ""}`} style={note ? { maxWidth: "min(32rem, 80vw)", whiteSpace: "normal", overflowWrap: "anywhere" } : undefined} title={title} data-testid="recognition-backend" data-backend={backend ?? "pending"}>{label}</span>
    {say ? <span className={s.backendNote} role="status" data-testid="recognition-note">{say}</span> : null}
  </>;
}
