"use client";

import { useSyncExternalStore } from "react";
import type { CardReader, ReaderDiagnostics } from "@yugidraft/vision";

/** Auto and GPU both let the engine try WebGPU first (it falls back to WASM on its own); CPU skips WebGPU. */
export type RecognitionMode = "auto" | "gpu" | "cpu";
export type EngineBackend = "webgpu" | "wasm";
export type RecognitionBackendState = {
  hybridEnabled: boolean;
  reader: CardReader;
  readerNote: string;
  read: ReaderDiagnostics | null;
  mode: RecognitionMode;
  /** Where the card reader runs now; null until the reader has started. */
  backend: EngineBackend | null;
  /** Last read time in ms; null until a read is done. */
  ms: number | null;
  /** Why the reader uses the CPU, when known. */
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
const DEFAULT: RecognitionBackendState = { hybridEnabled: false, reader:"current",readerNote:"",read:null,mode: "auto", backend: null, ms: null, note: "", generation: 0 };
let state: RecognitionBackendState | null = null;
let forcedCpu = false;
const FIRST_GPU_RETRY_MS = 30_000;
const MAX_GPU_RETRY_MS = 600_000;
let retryDelay = FIRST_GPU_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let preparations = 0;
let gpuSince: number | undefined;
let lastGpuLoss: { reason: string; at: number } | undefined;
const listeners = new Set<() => void>();
const resetters = new Set<(eager: boolean) => void>();

function load(): RecognitionBackendState {
  if (state) return state;
  let mode: RecognitionMode = "auto";
  try { const stored = localStorage.getItem(KEY); if (stored === "auto" || stored === "gpu" || stored === "cpu") mode = stored; } catch { /* Private mode: memory only. */ }
  return state = { ...DEFAULT, mode };
}
function preferredReader(): CardReader {
  let reader: CardReader = "current";
  try {const stored=localStorage.getItem(READER_KEY);if(stored==="hybrid")reader=stored;}catch{}
  try {const forced=new URL(location.href).searchParams.get("visionReader");if(forced==="current"||forced==="hybrid")reader=forced;}catch{}
  return reader;
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
function restartReader(patch: Partial<RecognitionBackendState>, eager = false) {
  update({ backend: null, ms: null, note: "", readerNote: "", read: null, ...patch, generation: load().generation + 1 });
  for (const reset of resetters) reset(eager);
}
function updateReader(reader: CardReader, hybridEnabled: boolean) {
  const now = load();
  if (now.reader === reader) {
    update({ hybridEnabled });
    return;
  }
  restartReader({ hybridEnabled, reader, ...(forcedCpu ? { backend: "wasm", note: now.note } : {}) });
}
/** Set from the signed-in Remote Duels page before its camera starts the reader. */
export function setHybridReaderEnabled(enabled: boolean) {
  if (load().hybridEnabled === enabled) return;
  updateReader(enabled ? preferredReader() : "current", enabled);
}
export function setCardReader(reader:CardReader) {
  const now = load();
  if (now.reader === reader || (reader === "hybrid" && !now.hybridEnabled)) return;
  try {localStorage.setItem(READER_KEY,reader);}catch{}
  updateReader(reader, now.hybridEnabled);
}
export function reportReaderNote(readerNote:string) {update({readerNote});}
export function reportReaderRead(read:ReaderDiagnostics|undefined) {if(read)update({read});}
function saveMode(mode: RecognitionMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* Memory-only fallback. */ }
}
function clearGpuRetry() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
}
/** Stop recovery when the table releases its reader. Failure state lives only in this page. */
export function stopGpuRecovery() {
  clearGpuRetry();
  retryDelay = FIRST_GPU_RETRY_MS;
  gpuSince = undefined;
  forcedCpu = false;
}
export function setRecognitionMode(mode: RecognitionMode) {
  if (load().mode === mode) return;
  saveMode(mode);
  stopGpuRecovery();
  restartReader({ mode }, true);
}
export function retryRecognitionGpu() {
  const mode = load().mode;
  if (mode === "cpu") saveMode("auto");
  stopGpuRecovery();
  restartReader({ mode: mode === "cpu" ? "auto" : mode }, true);
}
/** Let the replacement CPU reader finish loading before an automatic retry can replace it. */
export function holdGpuRetry<T>(preparation: Promise<T>): Promise<T> {
  preparations++;
  return preparation.finally(() => { preparations--; });
}
function scheduleGpuRetry() {
  if (retryTimer !== undefined) return;
  const retry = () => {
    if (preparations) {
      retryTimer = setTimeout(retry, 1000);
      return;
    }
    retryTimer = undefined;
    retryDelay = Math.min(retryDelay * 2, MAX_GPU_RETRY_MS);
    forcedCpu = false;
    restartReader({}, true);
  };
  retryTimer = setTimeout(retry, retryDelay);
}
function noteGpuFallback() {
  if (gpuSince !== undefined && Date.now() - gpuSince >= FIRST_GPU_RETRY_MS) retryDelay = FIRST_GPU_RETRY_MS;
  gpuSince = undefined;
}
/** Changes each time the reader restarts (new mode, GPU lost, GPU retry). */
export const recognitionGeneration = () => load().generation;
/** The recognizer module restarts its reader when the mode changes. */
export function onRecognitionReset(reset: (eager: boolean) => void) { resetters.add(reset); return () => { resetters.delete(reset); }; }

/** The reader started or finished a read on `backend`. */
export function reportBackend(backend: EngineBackend, reason?: string, retryable = Boolean(reason)) {
  const mode = load().mode;
  let note = "";
  if (backend === "webgpu") {
    clearGpuRetry();
    gpuSince ??= Date.now();
  } else if (mode === "cpu") {
    note = "selected in settings";
  } else {
    noteGpuFallback();
    note = forcedCpu ? load().note : reason ?? "";
    // A browser without GPU support can stay on CPU. If a retry is already
    // recovering a failure, the adapter may still be unavailable temporarily.
    if (reason && (retryable || retryDelay > FIRST_GPU_RETRY_MS)) scheduleGpuRetry();
    else if (!forcedCpu) clearGpuRetry();
  }
  update({ backend, note });
}
/** A read time without a backend (a board read): keeps the known backend. */
export function reportReadTime(ms: number) { if (load().backend) update({ ms: Math.round(ms) }); }
/** An unusable worker is replaced immediately by WASM while GPU recovery backs off. */
export function reportGpuFailure(error: Error) {
  if (engineBackend() === "wasm") return;
  forcedCpu = true;
  const reason = error.message;
  lastGpuLoss = { reason, at: Date.now() };
  console.warn("[remote recognition] Using CPU until GPU retry:", reason);
  noteGpuFallback();
  scheduleGpuRetry();
  restartReader({ backend: "wasm", note: reason }, true);
}
/** The last reason the reader left the GPU in this page, for the Debug view. */
export const gpuLossReason = () => lastGpuLoss;

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Read outside React: where the card reader runs now, and a way to follow it. */
export const recognitionBackendNow = (): RecognitionBackendState => load();
export const subscribeRecognitionBackend = subscribe;
export function useRecognitionBackend(): RecognitionBackendState { return useSyncExternalStore(subscribe, load, () => DEFAULT); }
