import { z } from "zod";
import { VOICE_PHASES } from "../phase-plausibility";

export const SAMPLE_RATE = 16000;
export const intentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("phase"), phase: z.enum(VOICE_PHASES) }),
  z.object({ kind: z.literal("turn") }),
  z.object({ kind: z.literal("none") }),
]);
export type ExpectedIntent = z.infer<typeof intentSchema>;
export const promptSchema = z.object({
  id: z.string().min(1), phrase: z.string().min(1), canonical: z.string(),
  category: z.enum(["command", "near-miss", "chatter"]), expected: intentSchema,
  sim: z.object({ phase: z.enum(VOICE_PHASES), turn: z.number().int().positive(), mine: z.boolean() }),
  targetMs: z.number().int().min(500).max(120000), note: z.string(),
});
export type Prompt = z.infer<typeof promptSchema>;
export type Clip = { promptId: string; recordedAt: string; pcm: Float32Array };
export type TestSet = { id: string; revision: number; createdAt: string; prompts: Prompt[]; clips: Clip[]; skipped: string[]; cursor: number };
export type Method = "asr" | "kws" | "two-stage";
export type Observation = { intent: string; heard: string; canonical: string; busyMs: number; audioMs: number; speechMs: number; decisionMs?: number; note?: string };
export type ClipResult = { promptId: string; durationMs: number; observations: Observation[] };
export const intentKey = (intent: ExpectedIntent) => intent.kind === "phase" ? `phase:${intent.phase}` : intent.kind;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
