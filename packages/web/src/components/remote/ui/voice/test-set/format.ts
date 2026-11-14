import { z } from "zod";
import { SAMPLE_RATE, promptSchema, type TestSet } from "./model";

/** PCM16 WAV, one channel at 16 kHz. Quantized samples are also used for local replay. */
export function encodeWav(pcm: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2); const view = new DataView(buffer);
  const ascii = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((value, i) => { if (!Number.isFinite(value)) throw new Error("Non-finite audio sample"); view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(32767 / 32768, value)) * 32768), true); });
  return buffer;
}

export function decodeWav(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const ascii = (at: number, count: number) => String.fromCharCode(...new Uint8Array(buffer, at, count));
  if (buffer.byteLength < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" || ascii(12, 4) !== "fmt " || ascii(36, 4) !== "data"
    || view.getUint32(4, true) !== buffer.byteLength - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== SAMPLE_RATE || view.getUint32(28, true) !== SAMPLE_RATE * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== buffer.byteLength - 44 || (buffer.byteLength - 44) % 2) throw new Error("Expected an exported 16 kHz mono PCM16 WAV");
  return Float32Array.from({ length: (buffer.byteLength - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true) / 32768);
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(parts.join(""));
}
function unbase64(value: string): ArrayBuffer {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const manifestSchema = z.object({
  format: z.literal("remote-voice-test-set"), version: z.literal(1), sampleRate: z.literal(SAMPLE_RATE),
  id: z.string().min(1), revision: z.number().int().nonnegative(), createdAt: z.iso.datetime(),
  cursor: z.number().int().nonnegative(), skipped: z.array(z.string()), prompts: z.array(promptSchema).min(1).max(2000),
  clips: z.array(z.object({ promptId: z.string(), recordedAt: z.iso.datetime(), wavBase64: z.string().max(6_000_000) })).max(2000),
});

export function exportTestSet(set: TestSet): string {
  return JSON.stringify({ format: "remote-voice-test-set", version: 1, sampleRate: SAMPLE_RATE, ...set,
    clips: set.clips.map(clip => ({ promptId: clip.promptId, recordedAt: clip.recordedAt, wavBase64: base64(encodeWav(clip.pcm)) })) });
}

export function importTestSet(text: string): TestSet {
  const parsed = manifestSchema.parse(JSON.parse(text));
  const ids = new Set(parsed.prompts.map(p => p.id)); const clipIds = new Set(parsed.clips.map(c => c.promptId));
  if (ids.size !== parsed.prompts.length || clipIds.size !== parsed.clips.length || parsed.cursor > parsed.prompts.length
    || parsed.clips.some(c => !ids.has(c.promptId)) || parsed.skipped.some(id => !ids.has(id) || clipIds.has(id))
    || parsed.prompts.some(p => (p.category === "command") === (p.expected.kind === "none"))) throw new Error("Manifest labels or clip references are inconsistent");
  return { id: parsed.id, revision: parsed.revision, createdAt: parsed.createdAt, cursor: parsed.cursor, skipped: parsed.skipped, prompts: parsed.prompts,
    clips: parsed.clips.map(clip => {
      const pcm = decodeWav(unbase64(clip.wavBase64));
      if (!pcm.length || pcm.length > SAMPLE_RATE * 125) throw new Error("Clip must contain 0–125 seconds of audio");
      return { promptId: clip.promptId, recordedAt: clip.recordedAt, pcm };
    }) };
}
