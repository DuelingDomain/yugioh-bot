// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See licenses/duel-lens.LICENSE.
import * as ort from 'onnxruntime-web/wasm';
import { openModelSession } from './web-runtime';
import { fetchModelChecked } from './model-cache';
import type { ModelVariant, WebGpuDiagnostics } from './types';
import type { SessionLike } from './embed';
import type { GpuCheck } from './gpu-check';
export interface ModelSession extends SessionLike { readonly backend: 'webgpu' | 'wasm'; readonly fallbackReason?: string; readonly gpuDiagnostics?: WebGpuDiagnostics; release(): Promise<void> }
export interface SessionTuning { /** WASM threads for this worker. */ threads?: number; /** Outputs kept on the GPU (WebGPU only). */ gpuOutputs?: readonly string[]; /** Output check for the half-precision WebGPU graph (gpu-check.ts). */ gpuCheck?: GpuCheck }
/** The WebGPU graphs a variant offers: an 'fp32' variant is the float32 graph on its own, otherwise `url` is half precision and `fp32` its float32 alternative. */
export function gpuModelPaths(webgpu?: ModelVariant): { gpuModelPath?: string; gpuFp32ModelPath?: string } {
  if (!webgpu) return {};
  return webgpu.precision === 'fp32' ? { gpuFp32ModelPath: webgpu.url } : { gpuModelPath: webgpu.url, gpuFp32ModelPath: webgpu.fp32?.url };
}
/** Browser adapter around Duel Lens's runtime: local paths and pinned model hashes. */
export async function createModelSession(url: string, sha256: string, backend: 'auto' | 'wasm' = 'auto', runtimeBase = '/dev/vision-lab/assets/ort/', webgpu?:ModelVariant, tuning:SessionTuning={}): Promise<ModelSession> {
  const expectedFor = (input: RequestInfo | URL) => {
    const variant = [webgpu, webgpu?.fp32].find(v => v && String(input) === new URL(v.url, globalThis.location.href).href);
    return variant?.sha256 ?? sha256;
  };
  const fetchChecked: typeof fetch = (input, init) => fetchModelChecked(input, expectedFor(input), init);
  const { session } = await openModelSession(url, url, {
    webgpu: backend !== 'wasm', wasmThreads: tuning.threads, gpuOutputs: tuning.gpuOutputs, gpuCheck: tuning.gpuCheck, ...gpuModelPaths(webgpu), fetch: fetchChecked,
    getURL: path => new URL(path === 'ort/' ? runtimeBase : path, globalThis.location.href).href,
  });
  return { get backend() { return session.ep; }, get fallbackReason() { return session.fallbackReason; }, get gpuDiagnostics() { return session.gpuDiagnostics; }, get gpuDevice() { return session.gpuDevice; }, reportGpuFailure: e => session.reportGpuFailure(e), run: feeds => session.run(feeds), release: () => session.release() };
}
export const Tensor = ort.Tensor;
export function runtimeDiagnostics() {
  return { crossOriginIsolated: globalThis.crossOriginIsolated === true,
    wasmThreads: ort.env.wasm.numThreads ?? 1, simd: ort.env.wasm.simd === true };
}

