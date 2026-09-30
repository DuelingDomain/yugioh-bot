// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDuelFeedbackAudio } from "../../src/components/duel/feedback-audio";
import { battleTiming } from "../../src/components/duel/attack-styles";

function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

let created: FakeContext[] = [];

class FakeNode {
  connect = vi.fn((node: unknown) => node);
  disconnect = vi.fn();
}

class FakeContext {
  state = "suspended";
  currentTime = 1;
  sampleRate = 8000;
  destination = new FakeNode();
  oscillators = 0;
  sources = 0;
  master: (FakeNode & { gain: ReturnType<typeof param> }) | null = null;
  gains: Array<FakeNode & { gain: ReturnType<typeof param> }> = [];
  constructor() {
    created.push(this);
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => undefined);
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: param(1) });
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    this.oscillators += 1;
    return Object.assign(new FakeNode(), { type: "sine", frequency: param(440), detune: param(0), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: param(1000), Q: param(1) });
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    this.sources += 1;
    return Object.assign(new FakeNode(), { buffer: null, start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: param(0) });
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
}

const battle = {
  kind: "win" as const,
  reduced: false,
  timing: battleTiming("win", "slash", "impact"),
  lpAt: [520],
  seed: 1,
  attacker: { style: "slash" as const, signature: null },
  defender: { style: "impact" as const, signature: null },
};

beforeEach(() => {
  created = [];
  (window as unknown as { AudioContext: typeof FakeContext }).AudioContext = FakeContext;
});
afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("createDuelFeedbackAudio", () => {
  it("stays silent until a user gesture unlocks it", () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    audio.playBattle(battle);
    audio.play("shatter");
    expect(created.length).toBe(0);
  });

  it("plays a battle once unlocked, and not while muted", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    expect(await audio.unlock()).toBe(true);
    const ctx = created[0];
    audio.setMuted(true);
    audio.playBattle(battle);
    expect(ctx.oscillators + ctx.sources).toBe(0);
    audio.setMuted(false);
    audio.playBattle(battle);
    expect(ctx.oscillators).toBeGreaterThan(5);
    expect(ctx.sources).toBeGreaterThan(3);
    audio.stopAll();
    audio.dispose();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("sets the master volume with a smooth ramp, clamped to 0..1, and keeps it muted at zero level", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    await audio.unlock();
    const master = created[0].gains[0];
    audio.setVolume(0.4);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, expect.any(Number), expect.any(Number));
    audio.setVolume(3);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, expect.any(Number), expect.any(Number));
    audio.setVolume(-1);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, expect.any(Number), expect.any(Number));
    // muting silences at once; un-muting returns to the chosen volume
    audio.setVolume(0.6);
    audio.setMuted(true);
    expect(master.gain.setValueAtTime).toHaveBeenLastCalledWith(0, expect.any(Number));
    audio.setVolume(0.7);
    expect(master.gain.setTargetAtTime).not.toHaveBeenLastCalledWith(0.7, expect.any(Number), expect.any(Number));
    audio.setMuted(false);
    expect(master.gain.setValueAtTime).toHaveBeenLastCalledWith(0.7, expect.any(Number));
  });

  it("uses a volume chosen before the audio graph exists", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setVolume(0.25);
    audio.setMuted(false);
    await audio.unlock();
    expect(created[0].gains[0].gain.value).toBe(0.25);
  });
});
