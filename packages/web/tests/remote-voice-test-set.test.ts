import { describe, expect, it, vi } from "vitest";
import { ygoModule } from "@yugidraft/shared/remote";
import { interpret } from "@/components/remote/ui/grammar";
import { PHASE_TURN_PHRASES, buildPhrases } from "@/components/remote/ui/voice/phrases";
import { buildMatcher } from "@/components/remote/ui/voice/speech-matcher";
import { createSentencePiece } from "@/components/remote/ui/voice/sentencepiece";
import vocab from "@/components/remote/ui/voice/sp-vocab.json";
import { generateScript, scriptSummary } from "@/components/remote/ui/voice/test-set/script";
import { decodeWav, encodeWav, exportTestSet, importTestSet } from "@/components/remote/ui/voice/test-set/format";
import { score } from "@/components/remote/ui/voice/test-set/scoring";
import { checkAssets, decideUtterance } from "@/components/remote/ui/voice/test-set/replay";
import { type ClipResult, type Observation, type Prompt, type TestSet } from "@/components/remote/ui/voice/test-set/model";

import type { GrammarContext } from "@/components/remote/ui/grammar";
import type { KwsUtterance } from "@/components/remote/ui/voice/kws-client";
import { cpuShare, latencySummary, VoiceMetrics } from "@/components/remote/ui/voice/metrics";
import { buildGatePhrases, verifyKeywordHit } from "@/components/remote/ui/voice/two-stage";

const sim = { phase: "main1", turn: 2, mine: true } as const;
function prompt(id: string, category: Prompt["category"], expected: Prompt["expected"]): Prompt {
  return { id, phrase: id, canonical: "", category, expected, sim, targetMs: 2000, note: "" };
}
function heard(intent: string, busyMs = 100, audioMs = 1000): Observation {
  return { intent, busyMs, audioMs, speechMs: 500, heard: "heard words", canonical: "" };
}
function setFixture(): TestSet {
  return { id: "fixture", revision: 3, createdAt: "2026-11-13T12:00:00.000Z", cursor: 1, skipped: ["skip"],
    prompts: [prompt("battle phase", "command", { kind: "phase", phase: "battle" }), prompt("skip", "near-miss", { kind: "none" })],
    clips: [{ promptId: "battle phase", recordedAt: "2026-11-13T12:00:01.000Z", pcm: Float32Array.of(-1, -0.5, 0, 0.5, 32767 / 32768) }] };
}

describe("guided voice script", () => {
  it("records every finite phase/turn phrase twice, including natural aliases, without card commands", () => {
    const script = generateScript(17);
    for (const [spoken] of PHASE_TURN_PHRASES) expect(script.filter(p => p.phrase === spoken.toLowerCase()), spoken).toHaveLength(2);
    for (const spoken of ["draw phase", "standby phase", "main phase", "main phase one", "main phase two", "battle phase", "end phase", "next phase", "go back a phase", "end turn", "pass turn", "i pass", "your turn"])
      expect(script.some(p => p.phrase === spoken), spoken).toBe(true);
    expect(script.some(p => p.phrase === "attack")).toBe(false);
    expect(new Set(script.map(p => p.id)).size).toBe(script.length);
    expect(scriptSummary(script).expectedMs / 60000).toBeGreaterThan(4);
    expect(scriptSummary(script).expectedMs / 60000).toBeLessThan(6);
  });

  it("gives every command a legal simulator state and an independently parsed expected intent", () => {
    for (const p of generateScript(17).filter(p => p.category === "command")) {
      const state = { ...ygoModule.initialState({ seatCount: 2 }), phase: p.sim.phase, turn: p.sim.turn, turnSeat: p.sim.mine ? 0 : 1 };
      expect(interpret(p.canonical, { state, players: [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }], me: 0, trayOpen: false }), p.phrase).toEqual(p.expected);
      expect(p.expected.kind).not.toBe("none");
    }
  });

  it("labels unreachable Draw aliases and near-miss sentences no-action and budgets 2 minutes for chatter", () => {
    const script = generateScript();
    expect(script.filter(p => p.canonical === "draw phase").every(p => p.category === "near-miss" && p.expected.kind === "none")).toBe(true);
    for (const phrase of ["main deck", "next card", "it's a phase thing", "I think the battle phase rules changed"])
      expect(script.find(p => p.phrase === phrase)).toMatchObject({ category: "near-miss", expected: { kind: "none" } });
    expect(script.at(-1)).toMatchObject({ category: "chatter", expected: { kind: "none" }, targetMs: 120000 });
  });

  it("shuffles reproducibly without losing labels or repetitions", () => {
    expect(generateScript(19)).toEqual(generateScript(19));
    expect(generateScript(19)).not.toEqual(generateScript(20));
    expect(generateScript(19).map(p => p.id).sort()).toEqual(generateScript(20).map(p => p.id).sort());
  });
});

describe("voice scoring", () => {
  it("scores intent correctness, extra actions, misses, and per-phrase transcript evidence", () => {
    const prompts = [prompt("a", "command", { kind: "phase", phase: "battle" }), prompt("b", "command", { kind: "turn" }), prompt("c", "command", { kind: "turn" }), prompt("d", "command", { kind: "turn" })];
    const result = score(prompts, [
      { promptId: "a", durationMs: 2000, observations: [heard("phase:battle"), heard("none")] },
      { promptId: "b", durationMs: 2000, observations: [heard("phase:end")] },
      { promptId: "c", durationMs: 2000, observations: [heard("turn"), heard("turn")] },
      { promptId: "d", durationMs: 2000, observations: [] },
    ]);
    expect(result).toMatchObject({ commands: 4, correctCommands: 1, commandAccuracy: 0.25 });
    expect(result.perPhrase.find(p => p.phrase === "b")?.misses).toEqual([{ promptId: "b", expected: "turn", heard: ["heard words"], intents: ["phase:end"] }]);
    expect(result.perPhrase.find(p => p.phrase === "d")?.misses[0].heard).toEqual([]);
  });

  it("separates false-activated item rate from action counts and uses actual chatter duration", () => {
    const prompts = [prompt("n1", "near-miss", { kind: "none" }), prompt("n2", "near-miss", { kind: "none" }), prompt("chat", "chatter", { kind: "none" })];
    const results: ClipResult[] = [
      { promptId: "n1", durationMs: 2000, observations: [heard("turn"), heard("turn")] },
      { promptId: "n2", durationMs: 2000, observations: [] },
      { promptId: "chat", durationMs: 90000, observations: [heard("phase:battle"), heard("none"), heard("turn"), heard("phase:end")] },
    ];
    expect(score(prompts, results)).toMatchObject({ nearMissItems: 2, falseActivatedItems: 1, falseActivationRate: 0.5, nearMissActions: 2, chatterMs: 90000, chatterActions: 3, chatterActionsPerMinute: 2 });
  });

  it("calculates mean, nearest-rank p95, worker and corpus real-time factors", () => {
    const p = prompt("chat", "chatter", { kind: "none" });
    const result = score([p], [{ promptId: p.id, durationMs: 100000, observations: Array.from({ length: 20 }, (_, i) => heard("none", (i + 1) * 10, 1000)) }]);
    expect(result.meanProcessingMs).toBe(105); expect(result.p95ProcessingMs).toBe(190);
    expect(result.workerRealTimeFactor).toBeCloseTo(0.105); expect(result.corpusRealTimeFactor).toBeCloseTo(0.021);
    expect(score([], [])).toMatchObject({ commandAccuracy: null, falseActivationRate: null, chatterActionsPerMinute: null, meanProcessingMs: null, p95ProcessingMs: null, workerRealTimeFactor: null });
  });
});

describe("portable audio manifest", () => {
  it("writes a standard mono PCM16 WAV header and signed samples", () => {
    const wav = encodeWav(Float32Array.of(-1, -0.5, 0, 0.5, 1)); const view = new DataView(wav);
    expect(new TextDecoder().decode(new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000); expect(view.getUint16(22, true)).toBe(1); expect(view.getUint16(34, true)).toBe(16);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767]);
    expect([...decodeWav(wav)]).toEqual([-1, -0.5, 0, 0.5, 32767 / 32768]);
  });

  it("round-trips all labels, resume state, skips, and quantized audio in one JSON file", () => {
    const set = setFixture(); const text = exportTestSet(set);
    expect(JSON.parse(text)).toMatchObject({ format: "remote-voice-test-set", version: 1, sampleRate: 16000, clips: [{ wavBase64: expect.any(String) }] });
    expect(importTestSet(text)).toEqual(set);
    const arbitrary = Float32Array.of(0.123456, -0.99999, 0.000031);
    decodeWav(encodeWav(arbitrary)).forEach((sample, i) => expect(Math.abs(sample - arbitrary[i])).toBeLessThanOrEqual(1 / 32768));
  });

  it("rejects corrupt WAV headers and incompatible manifests before replay", () => {
    const wav = encodeWav(Float32Array.of(0)); new DataView(wav).setUint32(24, 48000, true);
    expect(() => decodeWav(wav)).toThrow(/16 kHz/); expect(() => decodeWav(new ArrayBuffer(5))).toThrow();
    const body = JSON.parse(exportTestSet(setFixture()));
    expect(() => importTestSet(JSON.stringify({ ...body, version: 2 }))).toThrow();
    expect(() => importTestSet(JSON.stringify({ ...body, clips: [...body.clips, ...body.clips] }))).toThrow(/inconsistent/);
    expect(() => importTestSet(JSON.stringify({ ...body, skipped: ["not-a-prompt"] }))).toThrow(/inconsistent/);
  });
});

describe("shared replay decision path", () => {
  it("uses phase-only matching and the live grammar for legal commands, chatter, and off-turn speech", () => {
    const phrases = buildPhrases([], createSentencePiece(vocab), { phasesAndTurnsOnly: true });
    const matcher = buildMatcher([], { phasesAndTurnsOnly: true });
    const p = prompt("battle", "command", { kind: "phase", phase: "battle" });
    const decision = (text: string, label = p) => decideUtterance({ id: 1, hits: [], text, speechMs: 600, busyMs: 10, audioMs: 1000 }, "asr", label, phrases, matcher);
    expect(decision("battle phase").intent).toBe("phase:battle");
    expect(decision("I think the battle phase rules changed").intent).toBe("none");
    expect(decision("end turn", { ...p, sim: { ...sim, mine: false } }).intent).toBe("none");
    expect(decision("attack directly").intent).toBe("none");
  });
});


describe("voice asset availability", () => {
  it("reports a missing verifier dependency plainly before starting a two-stage replay", async () => {
    vi.stubGlobal("fetch", async (url: string) => ({ ok: !url.includes("asr/model/"), status: url.includes("asr/model/") ? 404 : 200 }));
    try {
      expect(await checkAssets("kws")).toBeNull();
      expect(await checkAssets("two-stage")).toContain("assets missing: /dev/vision-assets/asr/model/encoder_model_quantized.onnx (HTTP 404)");
    } finally { vi.unstubAllGlobals(); }
  });
});

const phrases = buildGatePhrases(createSentencePiece(vocab));
const battle = phrases.entries.find(e => e.spoken === "BATTLE PHASE");
if (!battle) throw new Error("Missing battle phase keyword");
const keyword = battle.tag;
const utterance = (hits: string[]): KwsUtterance => ({ id: 1, hits: hits.map(keyword => ({ keyword, startTime: 0, timestamps: [], tokens: [] })), speechMs: 600, audioMs: 1500, busyMs: 20 });
function context(phase = "main1", mine = true, turn = 2): GrammarContext {
  return { state: { ...ygoModule.initialState({ seatCount: 2 }), phase, turn, turnSeat: mine ? 0 : 1 },
    players: [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }], me: 0, trayOpen: false };
}

describe("keyword gate verification", () => {
  it("never activates the decoder for silence, unknown keywords or the placeholder", async () => {
    let decodes = 0; const metrics = new VoiceMetrics();
    for (const hits of [[], ["_"], ["a card name"]]) {
      const result = await verifyKeywordHit({ utterance: utterance(hits), phrases, metrics, context,
        decode: async () => { decodes++; throw new Error("Decoder must remain idle"); } });
      expect(result.verification).toMatchObject({ stage1: "miss", stage2: "skipped", intent: { kind: "none" } });
    }
    expect(decodes).toBe(0);
    expect(metrics.snapshot()).toMatchObject({ stage1Hits: 0, stage2Runs: 0, stage2Confirmations: 0, stage2Rejections: 0 });
  });

  it("decodes a hit utterance once and rejects chatter without an action", async () => {
    let decodes = 0; const metrics = new VoiceMetrics();
    const result = await verifyKeywordHit({ utterance: utterance([keyword, keyword]), phrases, metrics, context,
      decode: async () => { decodes++; return { text: "I think the battle phase rules changed", busyMs: 80, audioMs: 1500 }; } });
    expect(decodes).toBe(1);
    expect(result.verification).toMatchObject({ stage1: "hit", stage2: "rejected", intent: { kind: "none" }, reason: expect.stringContaining("not a whole phase/turn phrase") });
    expect(result.busyMs).toBe(100);
    expect(metrics.snapshot()).toMatchObject({ stage1Hits: 2, stage2Runs: 1, stage2Confirmations: 0, stage2Rejections: 1 });
  });

  it.each([
    { text: "battle phase", phase: "main1", mine: true, turn: 2, expected: { kind: "phase", phase: "battle" } },
    { text: "end turn", phase: "main1", mine: true, turn: 2, expected: { kind: "turn" } },
    { text: "battle phase", phase: "main1", mine: false, turn: 2, expected: { kind: "none" } },
    { text: "battle phase", phase: "draw", mine: true, turn: 2, expected: { kind: "none" } },
    { text: "battle phase", phase: "main1", mine: true, turn: 1, expected: { kind: "none" } },
    { text: "end turn", phase: "draw", mine: true, turn: 2, expected: { kind: "none" } },
    { text: "go back a phase", phase: "main1", mine: false, turn: 2, expected: { kind: "none" } },
    { text: "activate effect", phase: "main1", mine: true, turn: 2, expected: { kind: "none" } },
  ])("confirms only legal phase/turn actions: $text, $phase, mine=$mine, turn=$turn", async ({ text, phase, mine, turn, expected }) => {
    const metrics = new VoiceMetrics();
    const result = await verifyKeywordHit({ utterance: utterance([keyword]), phrases, metrics, context: () => context(phase, mine, turn),
      decode: async () => ({ text, busyMs: 80, audioMs: 1500 }) });
    expect(result.verification.intent).toEqual(expected);
    expect(result.verification.stage2).toBe(expected.kind === "none" ? "rejected" : "confirmed");
    expect(metrics.snapshot()).toMatchObject({ stage2Runs: 1, stage2Confirmations: expected.kind === "none" ? 0 : 1, stage2Rejections: expected.kind === "none" ? 1 : 0 });
  });

  it("checks game state after decoding and fails closed on a decoder failure", async () => {
    const metrics = new VoiceMetrics(); let mine = true;
    const changed = await verifyKeywordHit({ utterance: utterance([keyword]), phrases, metrics, context: () => context("main1", mine),
      decode: async () => { mine = false; return { text: "battle phase", busyMs: 80, audioMs: 1500 }; } });
    expect(changed.verification).toMatchObject({ intent: { kind: "none" }, reason: expect.stringContaining("not your turn") });
    const failed = await verifyKeywordHit({ utterance: utterance([keyword]), phrases, metrics, context,
      decode: async () => { throw new Error("assets missing"); } });
    expect(failed.verification).toMatchObject({ stage2: "rejected", intent: { kind: "none" }, reason: expect.stringContaining("assets missing") });
    expect(metrics.snapshot()).toMatchObject({ stage2Runs: 2, stage2Rejections: 2 });
  });
});

describe("voice measurement arithmetic", () => {
  it("uses wall time and a separate no-command interval for stage CPU shares, retaining model loads and decision latency", () => {
    const metrics = new VoiceMetrics(); metrics.start(1000);
    metrics.load("stage1", { totalMs: 90, fetchMs: 60, initMs: 30, bytes: 5000 });
    metrics.work({ stage: "stage1", busyMs: 100, audioMs: 100 });
    metrics.setIdle(true, 2000);
    metrics.work({ stage: "stage1", busyMs: 20, audioMs: 100 });
    metrics.work({ stage: "stage2", busyMs: 200, audioMs: 100 });
    metrics.decision(900); metrics.decision(1100);
    metrics.setIdle(false, 3000); metrics.stop(3000);
    expect(metrics.snapshot(9000)).toMatchObject({ wallMs: 2000, idleWallMs: 1000, idleActive: false,
      stage1: { busyMs: 120, cpu: { msPerSecond: 60, percent: 6 }, idleCpu: { msPerSecond: 20, percent: 2 }, load: { bytes: 5000 } },
      stage2: { busyMs: 200, cpu: { msPerSecond: 100, percent: 10 }, idleCpu: { msPerSecond: 200, percent: 20 }, load: null },
      latency: { count: 2, meanMs: 1000, p95Ms: 1100 } });
    expect(cpuShare(50, 0)).toBeNull();
    expect(cpuShare(2500, 1000)).toEqual({ msPerSecond: 2500, percent: 250 });
    expect(latencySummary([])).toEqual({ count: 0, meanMs: null, p95Ms: null });
    expect(latencySummary(Array.from({ length: 20 }, (_, i) => i + 1))).toEqual({ count: 20, meanMs: 10.5, p95Ms: 19 });
  });
});
