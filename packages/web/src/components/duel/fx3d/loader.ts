import type { Fx3dApi } from "./types";

/**
 * Loads the 3D layer on demand. This file must not import `three` (directly or through another
 * module): it is what the rest of the duel room imports, and `import("./engine")` keeps the
 * library in a chunk of its own that only the duel room ever fetches.
 */

let webglVerdict: boolean | null = null;

/** True when this browser can make a WebGL context at all. The answer is cached. */
export function webglSupported(): boolean {
  if (webglVerdict != null) return webglVerdict;
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    webglVerdict = gl != null;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglVerdict = false;
  }
  return webglVerdict;
}

/** Test hook: forget the cached verdict. */
export function resetWebglVerdict(): void {
  webglVerdict = null;
}

export type Fx3dHandle = {
  api: Fx3dApi;
  dispose(): void;
};

/**
 * Creates the canvas engine inside `host`, or resolves null when 3D is not possible here (no
 * WebGL, or the module or the context failed): the caller then keeps the DOM effects.
 */
export async function loadFx3d(host: HTMLElement, onStatus: (ready: boolean) => void): Promise<Fx3dHandle | null> {
  if (!webglSupported()) return null;
  try {
    const { createEngine } = await import("./engine");
    const engine = createEngine(host, { onStatus });
    await engine.warmed;
    return { api: engine, dispose: () => engine.dispose() };
  } catch (error) {
    console.warn("[fx3d] unavailable, using the DOM effects", error);
    return null;
  }
}
