// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDuelFeedbackAudio } from "../../src/components/duel/feedback-audio";
import { battleTiming } from "../../src/components/duel/attack-styles";
import { scheduleBattleSound, type ToneOpts, type BurstOpts } from "../../src/components/duel/attack-audio";
import { setAnimationSpeed } from "../../src/components/duel/animation-speed";
import { duelFxClock } from "../../src/components/duel/fx-clock";

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
  sourceNodes: Array<FakeNode & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: null | (() => void) }> = [];
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
    const node = Object.assign(new FakeNode(), { type: "sine", frequency: param(440), detune: param(0), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) });
    this.sourceNodes.push(node);
    return node;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: param(1000), Q: param(1) });
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    this.sources += 1;
    const node = Object.assign(new FakeNode(), { buffer: null, start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void) });
    this.sourceNodes.push(node);
    return node;
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: param(0) });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) });
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
  setAnimationSpeed(1);
  duelFxClock.resetReviewTimeline();
  created = [];
  (window as unknown as { AudioContext: typeof FakeContext }).AudioContext = FakeContext;
});
afterEach(() => {
  setAnimationSpeed(1);
  duelFxClock.resetReviewTimeline();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  vi.restoreAllMocks();
});

describe("createDuelFeedbackAudio", () => {
  it("releases stopped audio holds and preserves slowed noise through its full envelope", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    duelFxClock.resetReviewTimeline(); setAnimationSpeed(0.5);
    const audio = createDuelFeedbackAudio(); audio.setMuted(false); await audio.unlock();
    audio.play("destroy");
    const noiseNodes = created[0]!.sourceNodes.filter((node) => "buffer" in node && "loop" in node);
    expect(noiseNodes.length).toBeGreaterThan(0);
    expect(noiseNodes.every((node) => node.loop)).toBe(true);
    setAnimationSpeed(2);
    expect(duelFxClock.factor()).toBe(0.5);
    audio.stopAll();
    expect(duelFxClock.factor()).toBe(2);
    audio.dispose();
  });
  it.each([0.5, 2])("schedules attack, counter and LP voices at %sx on the real audio clock", async (speed) => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    duelFxClock.resetReviewTimeline();
    setAnimationSpeed(speed);
    const audio = createDuelFeedbackAudio(); audio.setMuted(false); await audio.unlock();
    const voices: Array<ToneOpts | BurstOpts> = [];
    scheduleBattleSound({ tone: (opts) => voices.push(opts), burst: (opts) => voices.push(opts) }, battle, 1.01);
    audio.playBattle(battle);
    const expected = voices.flatMap((voice) => Array.from({ length: "vibrato" in voice && voice.vibrato ? 2 : 1 }, () => 1.01 + (voice.start - 1.01) / speed));
    const starts = created[0]!.sourceNodes.map((node) => node.start.mock.calls[0]![0] as number);
    expect(starts.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    audio.dispose();
  });
  it.each([20, 39, 41, 100, 200])("drops voices over 30 ms late when joining %i ms into a battle", async (elapsed) => {
    vi.spyOn(performance, "now").mockReturnValue(1000 + elapsed);
    const audio = createDuelFeedbackAudio(); audio.setMuted(false); await audio.unlock();
    const voices: Array<ToneOpts | BurstOpts> = [];
    scheduleBattleSound({ tone: (opts) => voices.push(opts), burst: (opts) => voices.push(opts) }, battle, 1.01 - Math.min(120, elapsed) / 1000);
    audio.playBattle({ ...battle, startedAt: 1000 });
    const expected = voices.filter((voice) => 1 - voice.start <= 0.03 && voice.start + voice.duration > 1)
      .flatMap((voice) => Array.from({ length: "vibrato" in voice && voice.vibrato ? 2 : 1 }, () => Math.max(1, voice.start)));
    const starts = created[0]!.sourceNodes.map((node) => node.start.mock.calls[0]![0] as number);
    expect(starts.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    audio.dispose();
  });

  it("caps the audio seek at 120 ms after 200 ms of preparation", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1200);
    const audio = createDuelFeedbackAudio(); audio.setMuted(false); await audio.unlock();
    const timing = battleTiming("lose", "slash", "beam");
    audio.playBattle({ ...battle, kind: "lose", defender: { style: "beam", signature: null }, timing, startedAt: 1000 });
    const starts = created[0]!.sourceNodes.map((node) => node.start.mock.calls[0]![0] as number);
    expect(starts.some((start) => Math.abs(start - (1.01 + timing.attackerDamageMs / 1000 - 0.12)) < 0.001)).toBe(true);
    expect(starts.every((start) => start >= created[0]!.currentTime)).toBe(true);
    audio.dispose();
  });

  it("preserves the wind-up after a very late join without negative audio timestamps", async () => {
    vi.spyOn(performance, "now").mockReturnValue(6000);
    const audio = createDuelFeedbackAudio(); audio.setMuted(false); await audio.unlock();
    audio.playBattle({ ...battle, startedAt: 1000 });
    expect(created[0]!.sourceNodes.length).toBeGreaterThan(0);
    expect(created[0]!.sourceNodes.every((node) => node.start.mock.calls[0]![0] >= 1)).toBe(true);
    audio.dispose();
  });
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
    // muting glides to silence in a few ms (no click); un-muting returns to the chosen volume
    audio.setVolume(0.6);
    audio.setMuted(true);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, expect.any(Number), expect.any(Number));
    audio.setVolume(0.7);
    expect(master.gain.setTargetAtTime).not.toHaveBeenLastCalledWith(0.7, expect.any(Number), expect.any(Number));
    audio.setMuted(false);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.7, expect.any(Number), expect.any(Number));
  });

  it("builds no nodes at zero volume", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    audio.setVolume(0);
    await audio.unlock();
    audio.playBattle(battle);
    audio.play("shatter");
    expect(created[0].oscillators + created[0].sources).toBe(0);
  });

  it("disconnects a voice's nodes once it has ended", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    await audio.unlock();
    audio.play("shatter");
    const ctx = created[0];
    expect(ctx.sourceNodes.length).toBeGreaterThan(0);
    for (const node of ctx.sourceNodes) node.onended?.();
    for (const node of ctx.sourceNodes) expect(node.disconnect).toHaveBeenCalled();
  });

  it("fades out the fight before when a new one starts", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setMuted(false);
    await audio.unlock();
    const ctx = created[0];
    audio.playBattle(battle);
    const first = ctx.sourceNodes.slice();
    for (const node of first) expect(node.stop).toHaveBeenCalledTimes(1);
    audio.playBattle(battle);
    for (const node of first) expect(node.stop).toHaveBeenCalledTimes(2);
  });

  it("uses a volume chosen before the audio graph exists", async () => {
    const audio = createDuelFeedbackAudio();
    audio.setVolume(0.25);
    audio.setMuted(false);
    await audio.unlock();
    expect(created[0].gains[0].gain.value).toBe(0.25);
  });
});
