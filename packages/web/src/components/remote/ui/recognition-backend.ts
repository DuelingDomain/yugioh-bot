"use client";

import { useSyncExternalStore } from "react";
import type { BackendStatus, CardReader, ReaderDiagnostics } from "@yugidraft/vision";

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
  /** When the next automatic GPU probe is due. */
  gpuRetryAt: number | null;
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
const DEFAULT: RecognitionBackendState = { hybridEnabled: false, reader:"current",readerNote:"",read:null,mode: "auto", backend: null, ms: null, note: "", gpuRetryAt: null, generation: 0 };
let state: RecognitionBackendState | null = null;
let forcedCpu = false;
const FIRST_GPU_RETRY_MS = 30_000;
const MAX_GPU_RETRY_MS = 600_000;
const STABLE_GPU_MS = 300_000;
const MAX_GPU_SWAPS = 5;
const GPU_PROBE_MS = 3000;
const BUSY_POLL_MS = 1000;
/** After this many busy polls a swap only waits for a tap or board read, not for background outline passes. */
const PATIENT_BUSY_POLLS = 30;
let retryDelay = FIRST_GPU_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let automaticGpuSwaps = 0;
let busyPolls = 0;
let preparations = 0;
let gpuSince: number | undefined;
let recoveringDevice = false;
let lastGpuLoss: { reason: string; at: number } | undefined;
const listeners = new Set<() => void>();
const resetters = new Map<(eager: boolean) => void, ((patient: boolean) => boolean) | undefined>();

type BrowserGpu = {
  requestAdapter(options: { powerPreference: "high-performance" }): Promise<{
    isFallbackAdapter?: boolean;
    info?: { isFallbackAdapter?: boolean };
    requestDevice(): Promise<{ destroy(): void }>;
  } | null>;
};
const browserGpu = () => (globalThis.navigator as { gpu?: BrowserGpu } | undefined)?.gpu;
export const hasBrowserGpu = () => Boolean(browserGpu());

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
export const isGpuDeviceRecovery = () => recoveringDevice;
export const cardReader=():CardReader=>load().reader;
function restartReader(patch: Partial<RecognitionBackendState>, eager = false) {
  endGpuRun();
  update({ backend: null, ms: null, note: "", readerNote: "", read: null, ...patch, generation: load().generation + 1 });
  for (const reset of resetters.keys()) reset(eager);
}
function updateReader(reader: CardReader, hybridEnabled: boolean) {
  const now = load();
  if (now.reader === reader) {
    update({ hybridEnabled });
    return;
  }
  if (!forcedCpu) stopGpuRecovery();
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
  busyPolls = 0;
  update({ gpuRetryAt: null });
}
/** Stop recovery when the table releases its reader. Failure state lives only in this page. */
export function stopGpuRecovery() {
  endGpuRun();
  forcedCpu = false;
  recoveringDevice = false;
  lastGpuLoss = undefined;
  clearGpuRetry();
}
export function setRecognitionMode(mode: RecognitionMode) {
  if (load().mode === mode) return;
  saveMode(mode);
  stopGpuRecovery();
  restartReader({ mode }, true);
}
export function retryRecognitionGpu() {
  if (load().mode === "cpu" || !hasBrowserGpu()) return;
  stopGpuRecovery();
  automaticGpuSwaps = 0;
  restartReader({}, true);
}
/** Let the replacement CPU reader finish loading before an automatic retry can replace it. */
export function holdGpuRetry<T>(preparation: Promise<T>): Promise<T> {
  preparations++;
  return preparation.finally(() => { preparations--; });
}
async function probeHardwareGpu(): Promise<boolean> {
  const gpu = browserGpu();
  if (!gpu) return false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>(resolve => {
    timer = setTimeout(() => { expired = true; resolve(false); }, GPU_PROBE_MS);
  });
  const probe = async () => {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (expired || !adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return false;
    const device = await adapter.requestDevice();
    device.destroy();
    return !expired;
  };
  try { return await Promise.race([probe(), limit]); }
  catch { return false; }
  finally { clearTimeout(timer); }
}
const readerIsBusy = () => {
  const patient = busyPolls >= PATIENT_BUSY_POLLS;
  return preparations > 0 || [...resetters.values()].some(busy => busy?.(patient));
};
function scheduleGpuRetry() {
  if (retryTimer !== undefined || recoveringDevice || automaticGpuSwaps >= MAX_GPU_SWAPS || !hasBrowserGpu()) return;
  const retry = async () => {
    if (readerIsBusy()) {
      busyPolls++;
      retryTimer = setTimeout(retry, BUSY_POLL_MS);
      return;
    }
    const scheduled = retryTimer;
    const hardwareReady = await probeHardwareGpu();
    if (scheduled !== retryTimer) return;
    if (hardwareReady && readerIsBusy()) {
      busyPolls++;
      retryTimer = setTimeout(retry, BUSY_POLL_MS);
      return;
    }
    retryTimer = undefined;
    busyPolls = 0;
    retryDelay = Math.min(retryDelay * 2, MAX_GPU_RETRY_MS);
    if (!hardwareReady) {
      scheduleGpuRetry();
      return;
    }
    automaticGpuSwaps++;
    forcedCpu = false;
    restartReader({ gpuRetryAt: null }, true);
  };
  retryTimer = setTimeout(retry, retryDelay);
  update({ gpuRetryAt: Date.now() + retryDelay });
}
function endGpuRun() {
  if (gpuSince !== undefined && Date.now() - gpuSince >= STABLE_GPU_MS) {
    retryDelay = FIRST_GPU_RETRY_MS;
    automaticGpuSwaps = 0;
  }
  gpuSince = undefined;
}
/** Changes each time the reader restarts (new mode, GPU lost, GPU retry). */
export const recognitionGeneration = () => load().generation;
/** The recognizer module restarts its reader when the mode changes. */
export function onRecognitionReset(reset: (eager: boolean) => void, busy?: (patient: boolean) => boolean) {
  resetters.set(reset, busy);
  return () => { resetters.delete(reset); };
}

/** The reader started or finished a read. Hybrid's matching models always use WASM. */
export function reportBackend({ backend, fallbackReason: reason, models }: BackendStatus, retryable: boolean) {
  const now = load();
  let note = "";
  if (!reason && models.some(model => model.backend === "webgpu")) {
    lastGpuLoss = undefined;
    gpuSince ??= Date.now();
    clearGpuRetry();
  } else if (now.mode !== "cpu") {
    const wasOnGpu = gpuSince !== undefined;
    endGpuRun();
    note = forcedCpu ? now.note : reason ?? "";
    if (reason && (retryable || wasOnGpu) && lastGpuLoss?.reason !== reason) {
      lastGpuLoss = { reason, at: Date.now() };
    }
    if (!retryable && !forcedCpu) clearGpuRetry();
  }
  update({ backend, note });
  if (backend === "wasm" && now.mode !== "cpu" && retryable) scheduleGpuRetry();
}
/** A read time without a backend (a board read): keeps the known backend. */
export function reportReadTime(ms: number) { if (load().backend) update({ ms: Math.round(ms) }); }
function forceCpuAfterFailure(reason: string) {
  recoveringDevice = false;
  forcedCpu = true;
  lastGpuLoss = { reason, at: Date.now() };
  console.warn("[remote recognition] Using CPU until GPU retry:", reason);
  restartReader({ backend: "wasm", note: reason }, true);
  scheduleGpuRetry();
}
/** An unusable GPU worker is replaced immediately by WASM while recovery backs off. */
export function reportGpuFailure(error: Error) {
  if (load().backend === "wasm" || engineBackend() === "wasm") return;
  forceCpuAfterFailure(error.message);
}
/** Explicit device loss gets one fresh GPU reader before falling back to WASM. */
export function reportGpuDeviceLost(error: Error) {
  if (engineBackend() === "wasm") return;
  if (recoveringDevice || automaticGpuSwaps >= MAX_GPU_SWAPS) {
    forceCpuAfterFailure(error.message);
    return;
  }
  clearGpuRetry();
  automaticGpuSwaps++;
  recoveringDevice = true;
  lastGpuLoss = { reason: error.message, at: Date.now() };
  restartReader({}, true);
}
export function finishGpuRestart(ready: boolean, reason?: string) {
  if (!recoveringDevice) return;
  recoveringDevice = false;
  const now = load();
  if (!ready || gpuSince === undefined) {
    forceCpuAfterFailure(reason || now.note || lastGpuLoss?.reason || "The replacement GPU reader did not start");
  }
}
/** The last reason the reader left the GPU in this page, for the Debug view. */
export const gpuLossReason = () => lastGpuLoss;

export function recognitionCpuReason(state: RecognitionBackendState, now = Date.now()): string {
  if (state.mode === "cpu") return "Set to CPU in settings";
  if (state.gpuRetryAt !== null) {
    const minutes = Math.max(1, Math.ceil((state.gpuRetryAt - now) / 60_000));
    return `The GPU stopped. Next try in ${minutes} min`;
  }
  if (lastGpuLoss) return "The GPU stopped";
  if (state.reader === "hybrid" && !state.note) return "Hybrid card matching uses the CPU";
  return hasBrowserGpu() ? "GPU not available on this device" : "This browser has no GPU support";
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Read outside React: where the card reader runs now, and a way to follow it. */
export const recognitionBackendNow = (): RecognitionBackendState => load();
export const subscribeRecognitionBackend = subscribe;
export function useRecognitionBackend(): RecognitionBackendState { return useSyncExternalStore(subscribe, load, () => DEFAULT); }
