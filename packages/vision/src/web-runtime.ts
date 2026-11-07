// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See licenses/duel-lens.LICENSE.
// ONNX Runtime Web as the offscreen page runs it, shared by the embedder and the card detector, its
// .mjs/.wasm loaded from the extension's ort/ folder, models fetched from the extension package:
// - the WebGPU build (onnxruntime-web/webgpu) when the browser has a WebGPU adapter;
// - otherwise, or whenever WebGPU fails, the WASM build (onnxruntime-web/wasm, multi-threaded when
//   cross-origin isolated), as before 2026-10-09.
// createModelSession() picks one per model and falls back on its own (see there).
//
// Why WebGPU now: the 2026-09-28 ruling kept the engine WASM-only because the embedder of the time
// (dynamically quantised int8: MatMulInteger, which the WebGPU provider leaves on the CPU) ran about
// 1.7x slower on WebGPU. Our embedders since dinov2-small-duel are MatMulNBits 8-bit weights with float32
// activations, which it runs on the GPU: about 11 ms against 77 ms per crop on an Apple M-series GPU,
// with the same vectors (cosine >= 0.9999999 on 200 real crops; eval-real and realset2 unchanged row for
// row). The card detector's outlines are the same on both, and a whole screenshot takes 37 ms against
// 88 ms (a scan's crop: 15 ms on either). .superpowers/sdd/2026-09-28-duel-lens-v1/features3-webgpu.md;
// src/offscreen/__measure__/webgpu-parity.ts measures it again.
import * as ortWasm from 'onnxruntime-web/wasm';
import type { SessionLike, TensorCtor, TensorLike } from './embed';
import type { WebGpuDiagnostics } from './types';

export type WebOrt = Pick<typeof ortWasm, 'env' | 'InferenceSession' | 'Tensor'>;

/** Minimal browser API surface, also used by the existing runtime tests. */
interface GpuDeviceLike { limits?: Record<string, number>; destroy(): void }
interface GpuAdapterLike {
  isFallbackAdapter?: boolean;
  features?: { has(name: string): boolean; [Symbol.iterator]?: () => Iterator<string> };
  info?: { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean };
  limits?: Record<string, number>;
  requestDevice?(options: { requiredFeatures: string[] }): Promise<GpuDeviceLike>;
}
export interface GpuLike {
  requestAdapter(options?: { powerPreference: 'high-performance' }): Promise<GpuAdapterLike | null>;
}

/** Injected for tests; defaults are the real browser APIs. */
export interface WebRuntimeDeps {
  /** Off: WASM only, WebGPU is not tried. Default on. */
  webgpu?: boolean;
  /** Checked fp16 graph; the WASM graph is fetched only on fallback. */
  gpuModelPath?:string;
  /** Float32 alternative for adapters without shader-f16 or a rejected fp16 graph. */
  gpuFp32ModelPath?: string;
  /** How long each WebGPU step may take before WASM is used instead (WEBGPU_TIMEOUTS; tests shorten them). */
  webgpuTimeouts?: Partial<WebGpuTimeouts>;
  ort?: WebOrt;
  /** onnxruntime-web's WebGPU build; default: `import('onnxruntime-web/webgpu')`, on first use. */
  ortWebGpu?: () => Promise<WebOrt>;
  /** navigator.gpu; null or undefined when the browser has no WebGPU. */
  gpu?: GpuLike | null;
  getURL?: (path: string) => string;
  fetch?: typeof fetch;
  crossOriginIsolated?: boolean;
  hardwareConcurrency?: number;
  /** WASM threads for this worker (a split recognizer gives each worker its share); default wasmThreads(cores). */
  wasmThreads?: number;
  /** Outputs a WebGPU session keeps in GPU buffers (the caller reads back only what it needs and disposes them). */
  gpuOutputs?: readonly string[];
}

export interface WebRuntime {
  ort: WebOrt;
  /** The bytes of a file packaged with the extension; `what` names it in errors. */
  bytes(path: string, what?: string): Promise<Uint8Array>;
  /** A packaged JSON file. */
  json(path: string, what?: string): Promise<unknown>;
}

/** WASM execution provider only. */
export const WASM_SESSION_OPTIONS = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' } as const;

/**
 * The WebGPU execution provider. Nodes it has no kernel for (ORT puts shape arithmetic on the CPU on
 * purpose) run on the WebGPU build's own CPU provider, in the same session.
 */
export const WEBGPU_SESSION_OPTIONS = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' } as const;

/**
 * ONNX Runtime's WASM threads for a computer with `cores` logical cores: half of them, 1 to 4 (a split recognizer chooses its own, see client.ts). Its threads wait
 * for each other at every layer, so one that loses its core to the browser, the video or another thread holds up
 * the rest: on 2 cores, a crop took 149 ms on 2 threads, 273 ms on 1, and 540 ms on 4 (all cores, 4 as
 * before: a 2-core, 4-thread laptop's). test/e2e/low-end/embed-bench.ts measures it (test/e2e/low-end/README.md).
 */
export const wasmThreads = (cores: number) => Math.max(1, Math.min(4, Math.floor(cores / 2)));

export function webRuntime(deps: WebRuntimeDeps = {}): WebRuntime {
  const ort = deps.ort ?? ortWasm;
  const getURL = deps.getURL ?? ((path: string) => new URL(path, globalThis.location.href).href);
  const fetchFile = deps.fetch ?? fetch;
  const isolated = deps.crossOriginIsolated ?? globalThis.crossOriginIsolated === true;
  const cores = deps.hardwareConcurrency ?? globalThis.navigator?.hardwareConcurrency ?? 1;

  // A string prefix makes ORT load its own .mjs/.wasm from the package (never a CDN),
  // so its thread workers start from that file rather than from the offscreen bundle.
  ort.env.wasm.wasmPaths = getURL('ort/');
  ort.env.wasm.numThreads = isolated ? Math.max(1, Math.floor(deps.wasmThreads ?? wasmThreads(cores))) : 1;
  // This shipped binary contains fixed-width SIMD; require feature detection explicitly.
  ort.env.wasm.simd = true;

  async function fetchPackaged(path: string, what: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchFile(getURL(path));
    } catch (e) {
      throw new Error(`Could not load ${what} (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!res.ok) throw new Error(`Could not load ${what} (HTTP ${res.status})`);
    return res;
  }

  return {
    ort,
    bytes: async (path, what = path) => new Uint8Array(await (await fetchPackaged(path, what)).arrayBuffer()),
    json: async (path, what = path) => (await fetchPackaged(path, what)).json() as Promise<unknown>,
  };
}

/**
 * How long each WebGPU step may take, in ms, before WASM is used instead: a GPU or driver that hangs
 * must never hang the extension. Measured cold (a fresh Chrome profile, Apple M-series GPU, E2E click
 * run of 2026-10-09): the adapter and the build's import 12 ms together (esbuild inlines the import);
 * the first session 427 ms (the 26.8 MB WebGPU .wasm compiled, the device, the model), the second
 * 133 ms; first runs 44–65 ms (shaders compiled), later runs 11–40 ms. Each limit is over 20 times that,
 * for slower computers: a slow GPU is still faster than WASM, so it must not be timed out.
 */
export interface WebGpuTimeouts {
  adapterMs: number;
  importMs: number;
  /** One session's creation (after any created before it: see gpuCreates). */
  createMs: number;
  /** Cold shader compilation for each new input shape can exceed a resident inference. */
  firstRunMs: number;
  /** One run (the watchdog). */
  runMs: number;
}
export const WEBGPU_TIMEOUTS: WebGpuTimeouts = { adapterMs: 3_000, importMs: 3_000, createMs: 10_000, firstRunMs: 60_000, runMs: 10_000 };

class WebGpuTimeout extends Error {}

/** `p`, or a WebGpuTimeout after `ms`. */
function within<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WebGpuTimeout(`${step} took over ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * WebGPU builds that timed out once (a create or a run that never came back): the GPU or its driver is
 * stuck, and the build's WebAssembly may still be inside that call, so no model uses it again in this
 * offscreen document. Each model on it moves to WASM at its next run.
 */
const stuckGpu = new WeakSet<WebOrt>();

export type WebGpuRuntime =
  | { ort: WebOrt; adapter: string; fp16: boolean; device?: GpuDeviceLike; diagnostics: WebGpuDiagnostics }
  | { ort: null; why: string; diagnostics: WebGpuDiagnostics };
const gpuRuntimes = new WeakMap<WebOrt, Promise<WebGpuRuntime>>();

function gpuLimits(limits?: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  // WebGPU exposes these as prototype getters, not own JSON properties.
  for (const name in limits) if (typeof limits[name] === 'number') result[name] = limits[name];
  return result;
}

/** Probe in the worker, then give ORT the same device. ORT 1.30's native WebGPU
 * provider accepts a device in session options; env.webgpu.adapter alone does
 * not select the device that executes the model. No inflated requiredLimits:
 * the default 128 MiB storage binding / 256 MiB buffer cover our batch-one graphs.
 */
export async function webGpuRuntime(deps: WebRuntimeDeps = {}): Promise<WebGpuRuntime> {
  const gpu = deps.gpu !== undefined ? deps.gpu : ((globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu ?? null);
  const diagnostics: WebGpuDiagnostics = {
    navigatorGpu: Boolean(gpu), secureContext: globalThis.isSecureContext === true,
    worker: typeof document === 'undefined', attempts: [],
  };
  if (!gpu) return { ort: null, why: 'self.navigator.gpu is missing (WebGPU requires a secure context and browser worker support)', diagnostics };
  const timeouts = { ...WEBGPU_TIMEOUTS, ...deps.webgpuTimeouts };
  try {
    let adapter: GpuAdapterLike | null = null;
    for (const options of [{ powerPreference: 'high-performance' as const }, undefined]) {
      const label = options ? 'high-performance' : 'default';
      try {
        adapter = await within(gpu.requestAdapter(options), timeouts.adapterMs, `requestAdapter(${label})`);
        diagnostics.attempts.push(`requestAdapter(${label}): ${adapter ? 'available' : 'null'}`);
        if (adapter) break;
      } catch (error) { diagnostics.attempts.push(`requestAdapter(${label}): ${errorText(error)}`); }
    }
    if (!adapter) return { ort: null, why: diagnostics.attempts.join('; '), diagnostics };
    const info = adapter.info;
    diagnostics.adapter = {
      vendor: info?.vendor ?? '', architecture: info?.architecture ?? '',
      device: info?.device ?? '', description: info?.description ?? '',
      isFallbackAdapter: Boolean(adapter.isFallbackAdapter || info?.isFallbackAdapter),
    };
    // SwiftShader and friends run the GPU work on the CPU: never pick them over WASM.
    if (diagnostics.adapter.isFallbackAdapter) return { ort: null, why: 'the WebGPU adapter is software (no usable GPU)', diagnostics };
    diagnostics.features = adapter.features?.[Symbol.iterator] ? [...adapter.features as Iterable<string>].sort() : [];
    diagnostics.limits = gpuLimits(adapter.limits);
    const load = deps.ortWebGpu ?? (async () => (await import('onnxruntime-web/webgpu')) as WebOrt);
    const ort = await within(load(), timeouts.importMs, "loading ONNX Runtime's WebGPU build");
    if (stuckGpu.has(ort)) return { ort: null, why: 'WebGPU runtime timed out earlier in this worker', diagnostics };
    const cached = gpuRuntimes.get(ort);
    if (cached) return cached;
    const selected = adapter;
    const ready = (async (): Promise<WebGpuRuntime> => {
      try {
        const getURL = deps.getURL ?? ((path: string) => new URL(path, globalThis.location.href).href);
        ort.env.wasm.wasmPaths = getURL('ort/');
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false; // WebGPU already runs in our dedicated worker.
        // initEp also checks this adapter, even when a session supplies a device.
        if (ort.env.webgpu) ort.env.webgpu.adapter = selected;
        let fp16 = selected.features?.has('shader-f16') === true;
        const requestDevice = async (features: string[]) => {
          const requesting = selected.requestDevice!({ requiredFeatures: features });
          try { return await within(requesting, timeouts.adapterMs, `requestDevice(${features.join(',') || 'default features'})`); }
          catch (error) {
            if (error instanceof WebGpuTimeout) void requesting.then(d => d.destroy()).catch(() => {});
            throw error;
          }
        };
        let device: GpuDeviceLike | undefined;
        if (selected.requestDevice) {
          try { device = await requestDevice(fp16 ? ['shader-f16'] : []); }
          catch (error) {
            diagnostics.attempts.push(errorText(error));
            if (!fp16) throw error;
            fp16 = false;
            diagnostics.attempts.push('retry requestDevice without shader-f16; use float32 WebGPU');
            device = await requestDevice([]);
          }
        }
        diagnostics.deviceLimits = gpuLimits(device?.limits as unknown as Record<string, number>);
        const name = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ');
        return { ort, adapter: name || 'unknown', fp16, device, diagnostics };
      } catch (error) { return { ort: null, why: `WebGPU device initialization: ${errorText(error)}`, diagnostics }; }
    })();
    gpuRuntimes.set(ort, ready);
    return ready;
  } catch (error) {
    return { ort: null, why: `WebGPU initialization: ${errorText(error)}`, diagnostics };
  }
}

/** A model's session on WebGPU or WASM; WASM takes over from WebGPU on its own (createModelSession). */
export interface RuntimeSession extends SessionLike {
  /** Where the next run goes. */
  readonly ep: 'webgpu' | 'wasm';
  readonly fallbackReason: string | undefined;
  readonly gpuDiagnostics: WebGpuDiagnostics | undefined;
  /** The GPUDevice of the active WebGPU session (output buffers kept on the GPU belong to it); undefined on WASM. */
  readonly gpuDevice: unknown;
  /** A GPU-resident output proved bad after run() returned: switch graph or provider as a failed run would. */
  reportGpuFailure(e: unknown): Promise<void>;
  release(): Promise<void>;
}

interface Opened {
  ort: WebOrt;
  device?: GpuDeviceLike;
  session: { run(feeds: Record<string, unknown>): Promise<Record<string, TensorLike | undefined>>; release?(): Promise<void> };
}

interface FeedTensor {
  type: 'float32';
  data: Float32Array;
  dims: readonly number[];
}

/**
 * The WebGPU build creates one session at a time: a second create() while one is under way fails with
 * "another WebGPU EP inference session is being created". The embedder and the card detector load
 * together (load-engine.ts), so their WebGPU sessions are created one after the other, per ORT build.
 */
const gpuCreates = new WeakMap<WebOrt, Promise<unknown>>();

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** False when a float32 output holds a NaN or an infinity (a plain loop: a detector output is about 1M floats). */
function isFinite32(t: TensorLike | undefined): boolean {
  // A GPU-resident output throws on .data; its reader checks what it reads back.
  const location = (t as { location?: string } | undefined)?.location;
  if (location && location !== 'cpu') return true;
  if (!(t?.data instanceof Float32Array)) return true;
  const d = t.data;
  for (let i = 0; i < d.length; i++) if (d[i] - d[i] !== 0) return false;
  return true;
}

/**
 * A packaged model's session, and the Tensor class to build its inputs with. It runs on WebGPU when the
 * browser has an adapter, and WASM takes over, for good, when:
 * - the browser has no WebGPU or no adapter, or the adapter or the WebGPU build fails or takes too long;
 * - the WebGPU session can't be created, or takes too long (it is released if it turns up);
 * - a WebGPU run fails, returns a float output that isn't finite, or takes too long (the watchdog): that
 *   run is done again on WASM, so the job still gets its answer and the work queue moves on (the model is
 *   fetched again: the first fetch's 25 MB aren't kept for it). A failed WebGPU session is released; a
 *   stuck one is dropped (released only if its run ever comes back), and the other models leave that
 *   WebGPU build too (stuckGpu).
 * The extension must never break on a GPU. `what` names the model in errors and in the console.
 */
export async function openModelSession(path: string, what: string, deps: WebRuntimeDeps = {}): Promise<{ session: RuntimeSession; Tensor: TensorCtor }> {
  const wasm = webRuntime(deps);
  const limits = { ...WEBGPU_TIMEOUTS, ...deps.webgpuTimeouts };
  let model: Uint8Array | null = null;
  let fallbackReason: string | undefined;
  let gpuDiagnostics: WebGpuDiagnostics | undefined;
  const create = async (ort: WebOrt, bytes: Uint8Array, options: ortWasm.InferenceSession.SessionOptions): Promise<Opened> => ({
    ort,
    session: (await ort.InferenceSession.create(bytes, options)) as unknown as Opened['session'],
  });
  /** A WebGPU session, created after the ones before it: see gpuCreates. */
  const createOnGpu = (ort: WebOrt, bytes: Uint8Array, device?: GpuDeviceLike): Promise<Opened> => {
    const base = device ? { ...WEBGPU_SESSION_OPTIONS, executionProviders: [{ name: 'webgpu', device }] } : WEBGPU_SESSION_OPTIONS;
    // GPU-resident outputs need our own device to read them back sparsely.
    const options = device && deps.gpuOutputs?.length
      ? { ...base, preferredOutputLocation: Object.fromEntries(deps.gpuOutputs.map(name => [name, 'gpu-buffer' as const])) }
      : base;
    const created = (gpuCreates.get(ort) ?? Promise.resolve()).then(async () => ({ ...(await create(ort, bytes, options as ortWasm.InferenceSession.SessionOptions)), device }));
    gpuCreates.set(ort, created.catch(() => {}));
    return created;
  };
  // The first fetch's bytes while they are whole (a failed WebGPU create may have used them), or a new fetch.
  const openWasm = async () => create(wasm.ort, model && model.byteLength > 0 ? model : await wasm.bytes(path, what), WASM_SESSION_OPTIONS);

  async function openWebGpu(forceFp32 = false): Promise<Opened | null> {
    if (deps.webgpu === false) return null;
    const start = performance.now();
    const gpu = await webGpuRuntime(deps);
    gpuDiagnostics ??= { ...gpu.diagnostics, attempts: [...gpu.diagnostics.attempts] };
    if (!gpu.ort) {
      fallbackReason = gpu.why;
      console.debug(`[DuelLens] ${what} runs on WASM: ${fallbackReason}`);
      return null;
    }
    const paths = deps.gpuModelPath
      ? (gpu.fp16 && !forceFp32 ? [deps.gpuModelPath, deps.gpuFp32ModelPath] : [deps.gpuFp32ModelPath]).filter((p): p is string => Boolean(p))
      : [path];
    if (!gpu.fp16 && deps.gpuModelPath) gpuDiagnostics.attempts.push('shader-f16 unavailable; use float32 WebGPU');
    if (!paths.length) {
      fallbackReason = 'adapter has no shader-f16 and this model has no float32 WebGPU variant';
      return null;
    }
    const failures: string[] = [];
    for (const gpuPath of paths) {
      let creating: Promise<Opened> | undefined;
      try {
        const bytes = await within(wasm.bytes(gpuPath, what), limits.createMs, `fetching ${gpuPath}`);
        if (gpuPath === path) model = bytes;
        creating = createOnGpu(gpu.ort, bytes, gpu.device);
        const got = await within(creating, limits.createMs, `creating the WebGPU session for ${gpuPath}`);
        gpuDiagnostics.modelPath = gpuPath;
        fallbackReason = undefined;
        gpuDiagnostics.attempts.push(`${gpuPath}: WebGPU session created`);
        console.debug(`[DuelLens] ${what} runs on WebGPU (${gpu.adapter}; ${Math.round(performance.now() - start)} ms)`);
        return got;
      } catch (error) {
        const failure = `${gpuPath}: ${errorText(error)}`;
        failures.push(failure); gpuDiagnostics.attempts.push(failure);
        if (error instanceof WebGpuTimeout && creating) {
          stuckGpu.add(gpu.ort);
          creating.then(o => o.session.release?.()).catch(() => {});
          break; // A timed-out runtime cannot safely create another session.
        }
        console.warn(`[DuelLens] WebGPU session failed: ${failure}`, error);
      }
    }
    fallbackReason = failures.join('; ');
    return null;
  }

  const gpu = await openWebGpu();
  let active: Opened = gpu ?? (await openWasm());
  let ep: RuntimeSession['ep'] = gpu ? 'webgpu' : 'wasm';
  let runs = 0, gpuRetries = 0;
  const compiledShapes = new Set<string>();
  model = null;

  /** The feeds as `ort`'s own Tensors: each ORT build only takes its own (the data is not copied). */
  const feedsFor = (ort: WebOrt, feeds: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(feeds).map(([k, t]) => [k, ort === wasm.ort ? t : new ort.Tensor('float32', (t as FeedTensor).data, [...(t as FeedTensor).dims])]));

  /** WASM from now on. A failed WebGPU session is released; a stuck one only once its run comes back, if ever. */
  async function toWasm(why: string, e: unknown, stuckRun?: Promise<unknown>): Promise<void> {
    fallbackReason = `${what}: WebGPU ${why}: ${errorText(e)}`;
    gpuDiagnostics?.attempts.push(fallbackReason);
    console.warn(`[DuelLens] WebGPU ${why} for ${what} (${errorText(e)}); it runs on WASM from now on`, e);
    const dropped = active;
    active = await openWasm();
    ep = 'wasm';
    // A lost device or a one-off failure is often temporary: reopen WebGPU in
    // the background after 30 s (three tries); a stuck run never retries.
    if (!stuckRun && gpuRetries < 3) setTimeout(() => {
      gpuRetries++;
      void openWebGpu().then(reopened => {
        if (!reopened || ep !== 'wasm') return;
        const cpu = active; active = reopened; ep = 'webgpu'; runs = 0; compiledShapes.clear();
        fallbackReason = undefined; gpuDiagnostics?.attempts.push(`${what}: WebGPU reopened after: ${errorText(e)}`);
        console.info(`[DuelLens] ${what}: back on WebGPU`);
        cpu.session.release?.().catch(() => {});
      }).catch(() => {});
    }, 30_000);
    if (stuckRun) {
      stuckGpu.add(dropped.ort);
      void stuckRun.then(
        () => dropped.session.release?.(),
        () => dropped.session.release?.(),
      ).catch(() => {});
    } else {
      dropped.session.release?.().catch(() => {});
    }
  }

  /**
   * A WebGPU run failed (or its GPU-resident output read back non-finite): an fp16 graph is replaced by
   * the float32 graph on the same GPU first (true: run again on it), otherwise WASM takes over (false).
   */
  async function gpuFailed(e: unknown): Promise<boolean> {
    // An fp16 session may load successfully, then fail during shader compilation.
    // Try the float32 graph on the same GPU before selecting CPU.
    if (deps.gpuFp32ModelPath && gpuDiagnostics && gpuDiagnostics.modelPath === deps.gpuModelPath) {
      gpuDiagnostics.attempts.push(`fp16 inference failed: ${errorText(e)}; retry float32 WebGPU`);
      const replacement = await openWebGpu(true);
      if (replacement) {
        void active.session.release?.().catch(() => {});
        active = replacement; runs = 0; compiledShapes.clear();
        return true;
      }
    }
    await toWasm('failed', new Error([errorText(e), fallbackReason].filter(Boolean).join('; ')));
    return false;
  }

  const session: RuntimeSession = {
    get fallbackReason() { return fallbackReason; },
    get gpuDiagnostics() { return gpuDiagnostics; },
    get gpuDevice() { return ep === 'webgpu' ? active.device : undefined; },
    get ep() {
      return ep;
    },
    async run(feeds) {
      if (ep === 'webgpu' && stuckGpu.has(active.ort)) await toWasm('got stuck on another model', new Error('stuck'));
      if (ep === 'webgpu') {
        const running = Promise.resolve().then(() => active.session.run(feedsFor(active.ort, feeds)));
        try {
          const start = performance.now();
          // Warmup is square 448px. Camera reads can be 640/960px with a different
          // aspect ratio, which compiles another set of shape-specific shaders.
          const shape = JSON.stringify(Object.entries(feeds).sort(([a], [b]) => a.localeCompare(b)).map(([name, tensor]) => [name, (tensor as FeedTensor).dims]));
          const out = await within(running, compiledShapes.has(shape) ? limits.runMs : limits.firstRunMs, `running ${gpuDiagnostics?.modelPath ?? what}`);
          if (Object.values(out).every(isFinite32)) {
            compiledShapes.add(shape);
            if (runs++ === 0) console.debug(`[DuelLens] ${what}: first WebGPU run ${Math.round(performance.now() - start)} ms`);
            return out;
          }
          throw new Error('an output that is not finite');
        } catch (e) {
          if (e instanceof WebGpuTimeout) await toWasm('got stuck', e, running);
          else if (await gpuFailed(e)) return session.run(feeds);
        }
      }
      return active.session.run(feeds);
    },
    async reportGpuFailure(e) {
      if (ep === 'webgpu') await gpuFailed(e);
    },
    release: async () => {
      await active.session.release?.();
    },
  };
  return { session, Tensor: wasm.ort.Tensor as unknown as TensorCtor };
}
