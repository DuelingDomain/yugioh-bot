"use client";

import { useSyncExternalStore } from "react";
import type { CardReader, ReaderDiagnostics } from "@yugidraft/vision";

/** Auto and GPU both let the engine try WebGPU first (it falls back to WASM on its own); CPU skips WebGPU. */
export type RecognitionMode = "auto" | "gpu" | "cpu";
export type EngineBackend = "webgpu" | "wasm";
export type RecognitionBackendState = {
  reader: CardReader;
  readerNote: string;
  read: ReaderDiagnostics | null;
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
const READER_KEY = "dd-remote-card-reader";
export const CARD_READERS: readonly {value:CardReader;label:string}[] = [{value:"current",label:"Current"},{value:"hybrid",label:"Hybrid"}];
const DEFAULT: RecognitionBackendState = { reader:"current",readerNote:"",read:null,mode: "auto", backend: null, ms: null, note: "", generation: 0 };
let state: RecognitionBackendState | null = null;
let forcedCpu = false;
const listeners = new Set<() => void>();
const resetters = new Set<() => void>();

function load(): RecognitionBackendState {
  if (state) return state;
  let mode: RecognitionMode = "auto";
  let reader: CardReader = "current";
  try { const stored = localStorage.getItem(KEY); if (stored === "auto" || stored === "gpu" || stored === "cpu") mode = stored; } catch { /* Private mode: memory only. */ }
  try {const stored=localStorage.getItem(READER_KEY);if(stored==="hybrid")reader=stored;}catch{}
  try {const forced=new URL(location.href).searchParams.get("visionReader");if(forced==="current"||forced==="hybrid")reader=forced;}catch{}
  return state = { ...DEFAULT, mode, reader };
}
function update(patch: Partial<RecognitionBackendState>) {
  const now = load(), next = { ...now, ...patch };
  if ((Object.keys(patch) as (keyof RecognitionBackendState)[]).every(key => now[key] === next[key])) return;
  state = next;
  for (const listener of listeners) listener();
}
/** The `backend` option of the vision recognizer. */
export function engineBackend(): "auto" | "wasm" {
  return forcedCpu || load().mode === "cpu" ? "wasm" : "auto";
}
export const cardReader=():CardReader=>load().reader;
export function setCardReader(reader:CardReader) {
  if(load().reader===reader)return;
  try {localStorage.setItem(READER_KEY,reader);}catch{}
  update({reader,readerNote:"",read:null,backend:null,ms:null,note:"",generation:load().generation+1});
  for(const reset of resetters)reset();
}
export function reportReaderNote(readerNote:string) {update({readerNote});}
export function reportReaderRead(read:ReaderDiagnostics|undefined) {if(read)update({read});}
export function setRecognitionMode(mode: RecognitionMode) {
  if (load().mode === mode) return;
  try { localStorage.setItem(KEY, mode); } catch { /* Memory-only fallback. */ }
  forcedCpu = false;
  update({ mode, backend: null, ms: null, note: "", readerNote:"",read:null,generation: load().generation + 1 });
  for (const reset of resetters) reset();
}
/** Changes each time the reader restarts (new mode, GPU lost, GPU retry). */
export const recognitionGeneration = () => load().generation;
/** The recognizer module restarts its reader when the mode changes. */
export function onRecognitionReset(reset: () => void) { resetters.add(reset); return () => { resetters.delete(reset); }; }

/** The reader started or finished a read on `backend`. */
export function reportBackend(backend: EngineBackend, ms?: number, reason?: string) {
  const mode = load().mode;
  update({ backend, ...(ms === undefined ? {} : { ms: Math.round(ms) }), note: backend === "wasm" && mode !== "cpu" && !forcedCpu ? (reason === undefined ? load().note || "worker did not report a GPU reason; reload to update the reader" : reason) : forcedCpu ? load().note : "" });
}
/** A read time without a backend (a board read): keeps the known backend. */
export function reportReadTime(ms: number) { if (load().backend) update({ ms: Math.round(ms) }); }
/** A read failed while on GPU: the reader restarts on CPU for the rest of this page. */
export function reportGpuFailure(error?: unknown) {
  if (forcedCpu || load().backend !== "webgpu") return false;
  forcedCpu = true;
  const reason = `Recognition worker failed: ${error instanceof Error ? error.message : String(error ?? "unknown worker error")}`;
  lastGpuLoss = { reason, at: Date.now() };
  console.warn("[remote recognition] GPU lost, CPU until retry:", reason);
  update({ backend: "wasm", ms: null, note: reason, generation: load().generation + 1 });
  for (const reset of resetters) reset();
  // A lost GPU device often comes back (driver reset, tab in background). Try
  // the GPU again after 30 s, up to three times per page.
  if (gpuRetries < 3) setTimeout(() => {
    if (!forcedCpu || load().mode === "cpu") return;
    gpuRetries++; forcedCpu = false;
    update({ backend: null, ms: null, note: "", generation: load().generation + 1 });
    for (const reset of resetters) reset();
  }, GPU_RETRY_MS);
  return true;
}
const GPU_RETRY_MS = 30_000;
let gpuRetries = 0, lastGpuLoss: { reason: string; at: number } | undefined;
/** The last reason the reader left the GPU in this page, for the Debug view. */
export const gpuLossReason = () => lastGpuLoss;

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Read outside React: where the card reader runs now, and a way to follow it. */
export const recognitionBackendNow = (): RecognitionBackendState => load();
export const subscribeRecognitionBackend = subscribe;
export function useRecognitionBackend(): RecognitionBackendState { return useSyncExternalStore(subscribe, load, () => DEFAULT); }
