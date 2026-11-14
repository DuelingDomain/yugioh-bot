import { z } from "zod";
import { voiceMethods, voiceReasons, voiceCommands } from "./voice-diagnostics";

const ms = z.number().finite().nonnegative().max(1e12);
const id = z.string().min(1).max(100);
const text = z.string().max(2000);
const voiceContextSchema = z.strictObject({ turn: z.number().int().nonnegative(), phase: z.string().max(40), turnSeat: z.number().int().min(0).max(3), ownSeat: z.number().int().min(0).max(3) });
const outcome = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("acted"), reason: z.null(), actionId: id }),
  z.strictObject({ outcome: z.literal("rejected"), reason: z.enum(voiceReasons), actionId: id.nullable() }),
]);
const base = { at: z.number().finite().nonnegative().max(1e15), method: z.enum(voiceMethods) };
export const voiceRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("utterance"), utteranceId: id, text, canonical: z.string().max(200), context: voiceContextSchema,
    stage1: z.strictObject({ hits: z.array(z.strictObject({ keyword: z.string().max(200), score: z.number().finite().nullable() })).max(100), busyMs: ms }),
    stage2: z.strictObject({ transcript: text.nullable(), busyMs: ms, passes: z.number().int().min(0).max(100) }),
    speechMs: ms, audioMs: ms, decisionMs: ms, decision: outcome }),
  z.strictObject({ ...base, kind: z.literal("decision"), utteranceId: id, context: voiceContextSchema, decision: outcome }),
  z.strictObject({ ...base, kind: z.literal("undo"), utteranceId: id, actionId: id, msSinceAction: ms }),
  z.strictObject({ ...base, kind: z.literal("perf"), windowMs: ms, stage1BusyMs: ms, stage2BusyMs: ms, idle: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("mark"), label: z.enum(["wrong", "missed"]), utteranceId: id.nullable(), contextIds: z.array(id).max(5),
    intended: z.union([z.enum(voiceCommands), z.literal("nothing"), z.literal("free-text")]), note: z.string().max(500) }),
]);
export const voiceBatchSchema = z.strictObject({ records: z.array(voiceRecordSchema).min(1).max(100) });
