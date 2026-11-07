// Sparse readback of the card detector's GPU-resident outputs (WebGPU sessions with
// preferredOutputLocation 'gpu-buffer'). The full maps are about 18 floats per stride-4 cell
// (heat 2 + peak 2 + box 14: 2.3 MB at 960x544). decodeCards() only reads the box channels
// at heatmap peaks, so this reads heat and peak whole (4 of 18 channels), finds the peak cells,
// then copies only those cells' box values (14 floats each). Two small map round trips
// replace one 2.3 MB download and its NaN scan. Output buffers are disposed here.

/** Minimal WebGPU surface (the vision package has no @webgpu/types dependency). */
interface GpuBufferLike { size: number; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void }
interface GpuEncoderLike { copyBufferToBuffer(src: unknown, srcOffset: number, dst: unknown, dstOffset: number, size: number): void; finish(): unknown }
export interface GpuDeviceForReadback {
  createBuffer(desc: { size: number; usage: number }): GpuBufferLike;
  createCommandEncoder(): GpuEncoderLike;
  queue: { submit(buffers: unknown[]): void };
}
/** An ORT tensor that may live on the GPU. */
export interface MaybeGpuTensor { dims: readonly number[]; location?: string; gpuBuffer?: unknown; data?: ArrayLike<number>; getData?(): Promise<ArrayLike<number>>; dispose?(): void }

const MAP_READ = 0x0001, COPY_DST = 0x0008;
/** More peak cells than this (a noisy heatmap) reads the box map whole instead of cell by cell. */
const MAX_SPARSE_CELLS = 1024;

export const onGpu = (t: MaybeGpuTensor | undefined): boolean => Boolean(t && t.location === 'gpu-buffer' && t.gpuBuffer);

async function readBack(device: GpuDeviceForReadback, copies: (enc: GpuEncoderLike, dst: unknown) => void, bytes: number): Promise<Float32Array> {
  const staging = device.createBuffer({ size: Math.max(4, bytes), usage: MAP_READ | COPY_DST });
  try {
    const enc = device.createCommandEncoder();
    copies(enc, staging);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(MAP_READ);
    const out = new Float32Array(staging.getMappedRange().slice(0, bytes));
    staging.unmap();
    return out;
  } finally { staging.destroy(); }
}

const finite = (d: Float32Array) => { for (let i = 0; i < d.length; i++) if (d[i] - d[i] !== 0) return false; return true; };

/** Reused per worker: a zeroed box map is only written at peak cells. */
let sparseBox: Float32Array | undefined;

export interface DetectorMaps { heat: Float32Array; peak: Float32Array; box: Float32Array; readbackMs: number; sparseCells: number }

/**
 * Reads heat/peak whole and box at peak cells (heat >= minScore and >= peak, any class).
 * Every cell decodeCards() can read is filled, so its result is identical to a full download.
 */
export async function readDetectorMaps(device: GpuDeviceForReadback, heat: MaybeGpuTensor, peak: MaybeGpuTensor, box: MaybeGpuTensor, minScore: number): Promise<DetectorMaps> {
  const start = performance.now();
  try {
    const [, k, gh, gw] = heat.dims, plane = gh * gw, channels = box.dims[1];
    const heatBytes = k * plane * 4;
    const both = await readBack(device, (enc, dst) => {
      enc.copyBufferToBuffer(heat.gpuBuffer, 0, dst, 0, heatBytes);
      enc.copyBufferToBuffer(peak.gpuBuffer, 0, dst, heatBytes, heatBytes);
    }, heatBytes * 2);
    if (!finite(both)) throw new Error('an output that is not finite');
    const h = both.subarray(0, k * plane), p = both.subarray(k * plane);
    const cells: number[] = [];
    const marked = new Uint8Array(plane);
    for (let c = 0; c < k; c++) for (let cell = 0, base = c * plane; cell < plane; cell++) {
      const v = h[base + cell];
      if (v >= minScore && v >= p[base + cell] && !marked[cell]) { marked[cell] = 1; cells.push(cell); }
    }
    let boxData: Float32Array;
    if (cells.length > MAX_SPARSE_CELLS) {
      boxData = await readBack(device, (enc, dst) => enc.copyBufferToBuffer(box.gpuBuffer, 0, dst, 0, channels * plane * 4), channels * plane * 4);
    } else {
      if (!sparseBox || sparseBox.length !== channels * plane) sparseBox = new Float32Array(channels * plane);
      else sparseBox.fill(0);
      boxData = sparseBox;
      if (cells.length) {
        const values = await readBack(device, (enc, dst) => {
          let o = 0;
          for (const cell of cells) for (let ch = 0; ch < channels; ch++, o += 4) enc.copyBufferToBuffer(box.gpuBuffer, (ch * plane + cell) * 4, dst, o, 4);
        }, cells.length * channels * 4);
        if (!finite(values)) throw new Error('an output that is not finite');
        let i = 0;
        for (const cell of cells) for (let ch = 0; ch < channels; ch++) boxData[ch * plane + cell] = values[i++];
      }
    }
    return { heat: h, peak: p, box: boxData, readbackMs: performance.now() - start, sparseCells: cells.length };
  } finally {
    heat.dispose?.(); peak.dispose?.(); box.dispose?.();
  }
}
