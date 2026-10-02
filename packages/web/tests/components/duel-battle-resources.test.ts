// @vitest-environment jsdom
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fx3dEngine } from "@/components/duel/fx3d/engine";
import { ArtStore } from "@/components/duel/fx3d/art";
import { planBattle } from "@/components/duel/fx3d/battle-plan";
import { battleTiming, TINTS } from "@/components/duel/attack-styles";
import { runAttackFx } from "@/components/duel/attack-fx";

const gpu = vi.hoisted(() => ({ width: 1100, height: 720, scissor: false, draws: [] as Array<{ width: number; height: number; scissor: boolean; hidden: number }>, render: vi.fn() }));
vi.mock("three", async (original) => {
  const actual = await original<typeof THREE>();
  return { ...actual, WebGLRenderer: class {
    setClearColor() {} setPixelRatio() {} setSize() {} dispose() {} forceContextLoss() {}
    getPixelRatio() { return 1; }
    getViewport(v: THREE.Vector4) { return v.set(0, 0, gpu.width, gpu.height); }
    setViewport(x: THREE.Vector4 | number, _y?: number, w?: number, h?: number) { gpu.width = typeof x === "number" ? w! : x.z; gpu.height = typeof x === "number" ? h! : x.w; }
    getScissor(v: THREE.Vector4) { return v.set(0, 0, 1100, 720); }
    setScissor() {} clear() {}
    getScissorTest() { return gpu.scissor; }
    setScissorTest(value: boolean) { gpu.scissor = value; }
    render(scene: THREE.Scene) {
      let hidden = 0;
      scene.traverse((o) => { if (!o.visible) hidden++; });
      gpu.draws.push({ width: gpu.width, height: gpu.height, scissor: gpu.scissor, hidden }); gpu.render(scene);
    }
  } };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); gpu.draws.length = 0; gpu.width = 1100; gpu.height = 720; gpu.scissor = false; gpu.render.mockReset(); });

describe("battle GPU preparation", () => {
  it("finishes on the shared battle clock even when preparation consumes 200 ms", async () => {
    let clock = 1200;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    gpu.render.mockImplementationOnce(() => { clock += 200; });
    const engine = new Fx3dEngine(document.createElement("div"));
    const attacker = { rect: { x: 200, y: 400, w: 78, h: 114 }, code: 0, style: "slash" as const, signature: null, tint: TINTS.LIGHT, defense: false };
    const battle = planBattle({ kind: "direct", timing: battleTiming("direct", "slash", null), attacker, defender: null, hit: attacker.rect });
    const done = engine.play("battle", { rect: attacker.rect, battle, startedAt: 1000 });
    let finished = false; void done.then(() => { finished = true; });
    try {
      clock = 1000 + battle.totalMs;
      raf.mock.calls[0]![0](clock);
      await Promise.resolve();
      expect(finished).toBe(true);
    } finally { engine.dispose(); await done; }
  });
  it("prepares future counter and break objects before requesting a playback frame", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const engine = new Fx3dEngine(document.createElement("div"));
    const attacker = { rect: { x: 200, y: 400, w: 78, h: 114 }, code: 0, style: "slash" as const, signature: null, tint: TINTS.LIGHT, defense: false };
    const defender = { ...attacker, rect: { x: 200, y: 100, w: 78, h: 114 }, style: "beam" as const };
    const battle = planBattle({ kind: "lose", timing: battleTiming("lose", "slash", "beam"), attacker, defender, hit: defender.rect });
    const done = engine.play("battle", { rect: attacker.rect, battle });
    try {
      expect(gpu.draws).toHaveLength(1);
      expect(gpu.draws[0]).toMatchObject({ width: 1, height: 1, scissor: true });
      expect(gpu.draws[0]!.hidden).toBe(0);
      expect([gpu.width, gpu.height, gpu.scissor]).toEqual([1100, 720, false]);
      expect(gpu.render.mock.invocationCallOrder[0]).toBeLessThan(raf.mock.invocationCallOrder[0]!);
      const scene = gpu.render.mock.calls[0]![0] as THREE.Scene;
      let hidden = 0; scene.traverse((o) => { if (!o.visible) hidden++; });
      expect(hidden).toBeGreaterThan(0); // future parts go back to their scheduled visibility
    } finally { engine.dispose(); await done; }
  });

  it("restores hidden parts and viewport if the preparation draw fails", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    gpu.render.mockImplementationOnce(() => { throw new Error("GPU temporarily unavailable"); });
    const engine = new Fx3dEngine(document.createElement("div"));
    const attacker = { rect: { x: 200, y: 400, w: 78, h: 114 }, code: 0, style: "slash" as const, signature: null, tint: TINTS.LIGHT, defense: false };
    const done = engine.play("battle", { rect: attacker.rect, battle: planBattle({ kind: "direct", timing: battleTiming("direct", "slash", null), attacker, defender: null, hit: attacker.rect }) });
    try {
      expect(warning).toHaveBeenCalledOnce();
      expect([gpu.width, gpu.height, gpu.scissor]).toEqual([1100, 720, false]);
      const scene = gpu.render.mock.calls[0]![0] as THREE.Scene;
      let hidden = 0; scene.traverse((o) => { if (!o.visible) hidden++; });
      expect(hidden).toBeGreaterThan(0);
    } finally { engine.dispose(); await done; }
  });
});

describe("DOM battle synchronization", () => {
  it("seeks all animations forward after 200 ms of preparation, including the counter", () => {
    vi.spyOn(performance, "now").mockReturnValue(1200);
    const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn() }));
    vi.stubGlobal("Animation", class {});
    const previous = Element.prototype.animate;
    Element.prototype.animate = animate as never;
    try {
      const html = document.createElement("div"); document.body.appendChild(html);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const side = { box: { left: 200, top: 400, width: 78, height: 114 }, el: html, style: "slash" as const, tint: TINTS.LIGHT, caption: "Strike", cut: null };
      const plan = { reduced: false, kind: "lose" as const, attacker: side, defender: { ...side, style: "beam" as const, box: { ...side.box, top: 100 } }, hit: side.box, defenderInDefense: false, lpHits: [], seed: 1, timing: battleTiming("lose", "slash", "beam"), layer3d: true };
      const cls = { veil: "veil", frags: "frags", piece: "piece", inner: "inner", caption: "caption", lpFlash: "lpFlash" };
      runAttackFx(html, svg, plan, cls)();
      const before = animate.mock.calls.map((args) => (args[1] as KeyframeAnimationOptions).delay!);
      animate.mockClear();
      runAttackFx(html, svg, { ...plan, startedAt: 1000 }, cls)();
      expect(before.length).toBeGreaterThan(3);
      expect(animate.mock.calls.map((args) => (args[1] as KeyframeAnimationOptions).delay)).toEqual(before.map((delay) => delay - 200));
    } finally { Element.prototype.animate = previous; }
  });
});

describe("decoded card textures", () => {
  it("keeps loaded art when explicit decoding rejects", async () => {
    const images: Array<{ onload: () => Promise<void> }> = [];
    vi.stubGlobal("Image", class {
      onload = async () => {}; onerror = () => {}; decoding = ""; src = "";
      decode = () => Promise.reject(new DOMException("Image too large", "EncodingError"));
      constructor() { images.push(this); }
    });
    const art = new ArtStore();
    art.prefetch(1234);
    await images[0]!.onload();
    expect(art.peek(1234)).toBeInstanceOf(THREE.Texture);
    art.dispose();
  });

  it("decodes art and prepares its GPU upload before publishing it to the break animation", async () => {
    let finish!: () => void;
    const decoded = new Promise<void>((resolve) => { finish = resolve; });
    const images: Array<{ onload: () => Promise<void>; decode: () => Promise<void> }> = [];
    vi.stubGlobal("Image", class {
      onload = async () => {}; onerror = () => {}; decoding = ""; src = "";
      decode = vi.fn(() => decoded);
      constructor() { images.push(this); }
    });
    const uploaded = vi.fn();
    const art = new ArtStore(uploaded);
    art.prefetch(1234, true);
    const loaded = images[0]!.onload();
    expect(images[0]!.decode).toHaveBeenCalledOnce();
    expect(art.peek(1234)).toBeNull();
    finish(); await loaded;
    expect(uploaded).toHaveBeenCalledWith(art.peek(1234));
    expect(art.peek(1234)).toBeInstanceOf(THREE.Texture);
    art.dispose();
  });

  it("does not upload an image decoded after the engine was disposed", async () => {
    let finish!: () => void;
    const decoded = new Promise<void>((resolve) => { finish = resolve; });
    const images: Array<{ onload: () => Promise<void> }> = [];
    vi.stubGlobal("Image", class {
      onload = async () => {}; onerror = () => {}; decoding = ""; src = "";
      decode = () => decoded;
      constructor() { images.push(this); }
    });
    const uploaded = vi.fn();
    const art = new ArtStore(uploaded);
    art.prefetch(1234, true);
    const loaded = images[0]!.onload();
    art.dispose(); finish(); await loaded;
    expect(uploaded).not.toHaveBeenCalled();
    expect(art.peek(1234)).toBeNull();
  });

  it("keeps ordinary prefetches lazy and uploads cached attack art only once", async () => {
    const images: Array<{ onload: () => Promise<void> }> = [];
    vi.stubGlobal("Image", class {
      onload = async () => {}; onerror = () => {}; decoding = ""; src = "";
      decode = async () => {};
      constructor() { images.push(this); }
    });
    const uploaded = vi.fn();
    const art = new ArtStore(uploaded);
    art.prefetch(1234);
    await images[0]!.onload();
    await images[1]!.onload();
    expect(uploaded).not.toHaveBeenCalled();
    art.prefetch(1234, true);
    expect(uploaded).toHaveBeenCalledTimes(2);
    art.prefetch(1234, true);
    expect(uploaded).toHaveBeenCalledTimes(2);
    art.dispose();
  });

  it("never uploads attack art whose entry was evicted while it loaded", async () => {
    const images: Array<{ onload: () => Promise<void> }> = [];
    vi.stubGlobal("Image", class {
      onload = async () => {}; onerror = () => {}; decoding = ""; src = "";
      decode = async () => {};
      constructor() { images.push(this); }
    });
    const uploaded = vi.fn();
    const disposed = vi.spyOn(THREE.Texture.prototype, "dispose");
    const art = new ArtStore(uploaded);
    art.prefetch(1, true);
    for (let code = 2; code <= 41; code++) art.prefetch(code);
    await images[0]!.onload();
    expect(uploaded).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledOnce();
    expect(art.peek(1)).toBeNull();
    art.dispose();
  });
});
