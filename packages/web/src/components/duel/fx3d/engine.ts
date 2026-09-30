import * as THREE from "three";
import { ArtStore } from "./art";
import { pixelRatioFor } from "./coords";
import { EFFECTS } from "./effects";
import type { FxEnv, FxInstance } from "./effects/base";
import { FxKit } from "./kit";
import type { Fx3dApi, Fx3dEffectId, FxRequest } from "./types";

/**
 * The WebGL overlay: one transparent canvas over the whole board, an orthographic camera in CSS
 * pixels (see coords.ts), and a render loop that runs only while an effect is playing. This is the
 * only module that owns a renderer; it is loaded on demand (see loader.ts).
 */

const PIXEL_RATIO_CAP = 1.5;
/** Frame time (ms, smoothed) above which the canvas drops to lower quality once. */
const SLOW_FRAME_MS = 26;
const SLOW_FRAMES_BEFORE_DROP = 24;
const LOW_QUALITY = 0.6;
/** No effect may run longer than this, whatever its own duration says. */
const HARD_LIMIT_MS = 4000;

type Running = {
  instance: FxInstance;
  start: number;
  resolve: () => void;
};

export type Fx3dEngineOptions = {
  /** Called when the canvas becomes unusable (context lost) or usable again. */
  onStatus?: (ready: boolean) => void;
};

export class Fx3dEngine implements Fx3dApi {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly group = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
  private readonly kit = new FxKit();
  private readonly art = new ArtStore();
  private readonly observer: ResizeObserver | null;
  private readonly running = new Set<Running>();
  private view = { w: 1, h: 1 };
  private raf = 0;
  private lost = false;
  private disposed = false;
  private quality = 1;
  private slowFrames = 0;
  private smoothed = 16;
  private last = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: Fx3dEngineOptions = {},
  ) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "2",
    });
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "default",
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;
    this.scene.add(this.group);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    host.appendChild(canvas);
    this.resize();
    this.observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.resize());
    this.observer?.observe(host);
  }

  get ready(): boolean {
    return !this.lost && !this.disposed;
  }

  prefetchArt(code: number): void {
    if (this.ready) this.art.prefetch(code);
  }

  play(id: Fx3dEffectId, request: FxRequest, signal?: AbortSignal): Promise<void> {
    if (!this.ready || signal?.aborted) return Promise.resolve();
    const factory = EFFECTS[id];
    if (!factory) return Promise.resolve();
    // The host may have been resized since the last frame: measure now, so rectangles land exactly.
    this.resize();
    const env: FxEnv = { kit: this.kit, group: this.group, view: this.view, quality: this.quality, art: this.art };
    let instance: FxInstance;
    try {
      instance = factory(env, request);
    } catch (error) {
      console.warn("[fx3d] effect failed to start", id, error);
      return Promise.resolve();
    }
    if (request.artCode) this.art.prefetch(request.artCode);
    return new Promise<void>((resolve) => {
      const late = Math.min(600, Math.max(0, request.skipMs ?? 0));
      const run: Running = { instance, start: performance.now() - late, resolve };
      this.running.add(run);
      signal?.addEventListener(
        "abort",
        () => {
          this.finish(run);
          if (this.running.size === 0) {
            this.stop();
            this.draw();
          }
        },
        { once: true },
      );
      this.wake();
    });
  }

  cancelAll(): void {
    for (const run of [...this.running]) this.finish(run);
    this.stop();
    if (this.ready) this.draw();
  }

  private finish(run: Running): void {
    if (!this.running.delete(run)) return;
    try {
      run.instance.dispose();
    } catch {
      // the pools drop whatever they still hold on dispose()
    }
    run.resolve();
  }

  private wake(): void {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed || this.lost) return;
    const dt = now - this.last;
    this.last = now;
    this.watchSpeed(dt);
    for (const run of [...this.running]) {
      const ms = now - run.start;
      if (ms >= run.instance.durationMs || ms >= HARD_LIMIT_MS) {
        this.finish(run);
        continue;
      }
      try {
        run.instance.update(Math.max(0, ms) / 1000);
      } catch (error) {
        console.warn("[fx3d] effect failed", error);
        this.finish(run);
      }
    }
    this.draw();
    // Idle means no frame request at all: the loop restarts on the next play().
    if (this.running.size > 0) this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    try {
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.warn("[fx3d] render failed", error);
    }
  }

  /** One drop to lower quality when frames stay slow: pixel ratio 1 and fewer particles. */
  private watchSpeed(dt: number): void {
    if (this.quality < 1 || dt <= 0 || dt > 250) return;
    this.smoothed = this.smoothed * 0.85 + dt * 0.15;
    this.slowFrames = this.smoothed > SLOW_FRAME_MS ? this.slowFrames + 1 : 0;
    if (this.slowFrames >= SLOW_FRAMES_BEFORE_DROP) {
      this.quality = LOW_QUALITY;
      this.resize();
    }
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const ratio = this.quality < 1 ? 1 : pixelRatioFor(window.devicePixelRatio, PIXEL_RATIO_CAP);
    this.kit.dpr.value = ratio;
    if (w === this.view.w && h === this.view.h && ratio === this.renderer.getPixelRatio()) return;
    this.view.w = w;
    this.view.h = h;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  private readonly onLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    this.lost = true;
    this.stop();
    for (const run of [...this.running]) this.finish(run);
    this.options.onStatus?.(false);
  };

  private readonly onRestored = (): void => {
    this.lost = false;
    this.resize();
    this.options.onStatus?.(true);
  };

  dispose(): void {
    if (this.disposed) return;
    for (const run of [...this.running]) this.finish(run);
    this.disposed = true;
    this.stop();
    this.observer?.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.art.dispose();
    this.kit.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.options.onStatus?.(false);
  }
}

export function createEngine(host: HTMLElement, options?: Fx3dEngineOptions): Fx3dEngine {
  return new Fx3dEngine(host, options);
}
