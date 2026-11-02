"use client";

import { useSyncExternalStore } from "react";

/** Auto and GPU both let the engine try WebGPU first (it falls back to WASM on its own); CPU skips WebGPU. */
export type RecognitionMode = "auto" | "gpu" | "cpu";
export type EngineBackend = "webgpu" | "wasm";
export type RecognitionBackendState = {
  mode: RecognitionMode;
  /** Where the card reader runs now; null until the reader has started. */
  backend: EngineBackend | null;
  /** Last read time in ms; null until a read is done. */
  ms: number | null;
  /** Why the reader runs on CPU when the person did not ask for it. Empty when nothing is wrong. */
  note: string;
  /** Changes each time the reader must restart (a new mode, or a GPU failure). */
  generation: number;
};

export const RECOGNITION_MODES: readonly { value: RecognitionMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto (GPU when available)", hint: "Uses the graphics card when this browser can. Uses the processor if not." },
  { value: "gpu", label: "GPU", hint: "Asks for the graphics card. If this browser cannot give it, the processor is used." },
  { value: "cpu", label: "CPU", hint: "Always uses the processor. Slower, but works on every device." },
];

const KEY = "dd-remote-recognition-mode";
const DEFAULT: RecognitionBackendState = { mode: "auto", backend: null, ms: null, note: "", generation: 0 };
let state: RecognitionBackendState | null = null;
let forcedCpu = false;
const listeners = new Set<() => void>();
const resetters = new Set<() => void>();

function load(): RecognitionBackendState {
  if (state) return state;
  let mode: RecognitionMode = "auto";
  try { const stored = localStorage.getItem(KEY); if (stored === "auto" || stored === "gpu" || stored === "cpu") mode = stored; } catch { /* Private mode: memory only. */ }
  return state = { ...DEFAULT, mode };
}
function update(patch: Partial<RecognitionBackendState>) {
  const now = load(), next = { ...now, ...patch };
  if ((Object.keys(patch) as (keyof RecognitionBackendState)[]).every(key => now[key] === next[key])) return;
  state = next;
  for (const listener of listeners) listener();
}
/** Why a reader that runs on CPU is not on GPU, for a person who did not pick CPU. */
function cpuNote(): string {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "GPU could not start here — using CPU" : "GPU not available in this browser — using CPU";
}

/** The `backend` option of the vision recognizer. */
export function engineBackend(): "auto" | "wasm" {
  return forcedCpu || load().mode === "cpu" ? "wasm" : "auto";
}
export function setRecognitionMode(mode: RecognitionMode) {
  if (load().mode === mode) return;
  try { localStorage.setItem(KEY, mode); } catch { /* Memory-only fallback. */ }
  forcedCpu = false;
  update({ mode, backend: null, ms: null, note: "", generation: load().generation + 1 });
  for (const reset of resetters) reset();
}
/** The recognizer module restarts its reader when the mode changes. */
export function onRecognitionReset(reset: () => void) { resetters.add(reset); return () => { resetters.delete(reset); }; }

/** The reader started or finished a read on `backend`. */
export function reportBackend(backend: EngineBackend, ms?: number) {
  const mode = load().mode;
  update({ backend, ...(ms === undefined ? {} : { ms: Math.round(ms) }), note: backend === "wasm" && mode !== "cpu" && !forcedCpu ? cpuNote() : forcedCpu ? load().note : "" });
}
/** A read time without a backend (a board read): keeps the known backend. */
export function reportReadTime(ms: number) { if (load().backend) update({ ms: Math.round(ms) }); }
/** A read failed while on GPU: the reader restarts on CPU for the rest of this page. */
export function reportGpuFailure() {
  if (forcedCpu || load().backend !== "webgpu") return false;
  forcedCpu = true;
  update({ backend: "wasm", ms: null, note: "GPU failed — switched to CPU", generation: load().generation + 1 });
  for (const reset of resetters) reset();
  return true;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useRecognitionBackend(): RecognitionBackendState { return useSyncExternalStore(subscribe, load, () => DEFAULT); }
