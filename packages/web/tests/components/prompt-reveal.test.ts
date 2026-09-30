import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPromptRevealHold,
  holdPromptReveal,
  pendingBoardAnimations,
  REVEAL_TIMING,
  waitForReveal,
  type AnimationLike,
  type AnimationSource,
} from "@/components/duel/prompt-reveal";

type FakeAnimation = AnimationLike & { finish: () => void };

function animation(overrides: Partial<AnimationLike> & { name?: string; iterations?: number } = {}): FakeAnimation {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { name, iterations, ...rest } = overrides;
  const fake: FakeAnimation = {
    finished,
    playState: "running",
    effect: { getTiming: () => ({ iterations: iterations ?? 1 }) },
    finish: () => {
      fake.playState = "finished";
      finish();
    },
    ...rest,
  };
  if (name) {
    // Mimic a CSSAnimation / CSSTransition instance by its constructor name.
    Object.defineProperty(fake, "constructor", { value: { name }, enumerable: false });
  }
  return fake;
}

function source(list: () => AnimationLike[]): AnimationSource {
  return { getAnimations: () => list() };
}

/** Runs the wait under fake timers and reports when it resolved, in ms from the start. */
async function timeToReveal(options: Parameters<typeof waitForReveal>[0], until: number, step = 10): Promise<number | null> {
  let resolvedAt: number | null = null;
  const start = Date.now();
  void waitForReveal(options).then(() => {
    resolvedAt = Date.now() - start;
  });
  for (let elapsed = 0; elapsed < until; elapsed += step) {
    await vi.advanceTimersByTimeAsync(step);
    if (resolvedAt != null) return resolvedAt;
  }
  return resolvedAt;
}

describe("pendingBoardAnimations", () => {
  it("keeps running script animations and drops CSS, infinite, finished and idle ones", () => {
    const running = animation();
    const css = animation({ name: "CSSAnimation" });
    const transition = animation({ name: "CSSTransition" });
    const loop = animation({ iterations: Infinity });
    const done = animation({ playState: "finished" });
    const idle = animation({ playState: "idle" });
    const list = pendingBoardAnimations(source(() => [running, css, transition, loop, done, idle]));
    expect(list).toEqual([running]);
  });

  it("is empty without a source or when getAnimations throws", () => {
    expect(pendingBoardAnimations(null)).toEqual([]);
    expect(pendingBoardAnimations({ getAnimations: () => { throw new Error("no"); } })).toEqual([]);
  });
});

describe("waitForReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits the beat plus the settle time when the board is quiet", async () => {
    const at = await timeToReveal({ source: source(() => []), reducedMotion: false }, 3000);
    expect(at).toBe(REVEAL_TIMING.beatMs + REVEAL_TIMING.settleMs);
  });

  it("waits only the short reduced-motion pause", async () => {
    const busy = animation();
    const at = await timeToReveal({ source: source(() => [busy]), reducedMotion: true }, 3000);
    expect(at).toBe(REVEAL_TIMING.reducedMs);
  });

  it("waits for a running board effect, then settles", async () => {
    const fx = animation();
    setTimeout(() => fx.finish(), 900);
    const at = await timeToReveal({ source: source(() => [fx]), reducedMotion: false }, 3000);
    expect(at).toBe(900 + REVEAL_TIMING.settleMs);
  });

  it("waits for an effect that starts while the first one plays", async () => {
    const first = animation();
    const second = animation();
    let list: AnimationLike[] = [first];
    setTimeout(() => {
      list = [second];
      first.finish();
    }, 800);
    setTimeout(() => second.finish(), 1300);
    const at = await timeToReveal({ source: source(() => list), reducedMotion: false }, 3000);
    expect(at).toBe(1300 + REVEAL_TIMING.settleMs);
  });

  it("never waits past the cap", async () => {
    const stuck = animation();
    const at = await timeToReveal({ source: source(() => [stuck]), reducedMotion: false }, 6000);
    expect(at).toBe(REVEAL_TIMING.capMs);
  });

  it("ignores CSS animations and infinite loops", async () => {
    const css = animation({ name: "CSSAnimation" });
    const loop = animation({ iterations: Infinity });
    const at = await timeToReveal({ source: source(() => [css, loop]), reducedMotion: false }, 3000);
    expect(at).toBe(REVEAL_TIMING.beatMs + REVEAL_TIMING.settleMs);
  });

  it("reads the source lazily so a board mounted later still counts", async () => {
    const fx = animation();
    let board: AnimationSource | null = null;
    setTimeout(() => {
      board = source(() => [fx]);
    }, 100);
    setTimeout(() => fx.finish(), 1000);
    const at = await timeToReveal({ source: () => board, reducedMotion: false }, 3000);
    expect(at).toBe(1000 + REVEAL_TIMING.settleMs);
  });

  it("resolves false at once when aborted", async () => {
    const controller = new AbortController();
    let result: boolean | null = null;
    void waitForReveal({ source: source(() => []), reducedMotion: false, signal: controller.signal }).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe(false);
  });

  it("accepts custom timing", async () => {
    const at = await timeToReveal({ source: source(() => []), reducedMotion: false, timing: { beatMs: 50, settleMs: 30 } }, 1000);
    expect(at).toBe(80);
  });
});

describe("holdPromptReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPromptRevealHold();
  });
  afterEach(() => {
    clearPromptRevealHold();
    vi.useRealTimers();
  });

  it("keeps the panel hidden while a portal effect (the battle layer) plays, within the cap", async () => {
    holdPromptReveal(1250);
    const at = await timeToReveal({ source: source(() => []), reducedMotion: false }, 6000);
    expect(at).toBe(1250 + REVEAL_TIMING.settleMs);
  });

  it("never holds past the cap", async () => {
    holdPromptReveal(10_000);
    const at = await timeToReveal({ source: source(() => []), reducedMotion: false }, 6000);
    expect(at).toBe(REVEAL_TIMING.capMs);
  });
});
