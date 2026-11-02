import { z } from "zod";
import type { RemoteEvent, RemoteState, RemoteTable } from "./types.js";
const requestId = z.string().min(1).max(100);
/** Shared by the ws relay and the future LiveKit data-channel adapter. Never send frames/audio here. */
export const remoteDataMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("recognition.request"), feedOwnerSeat: z.number().int().min(0).max(3),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), requestId, force: z.boolean().optional() }),
  z.strictObject({ type: z.literal("recognition.result"), requestId, candidates: z.array(z.strictObject({
    cardId: z.number().int().positive().max(0xffffffff), name: z.string().min(1).max(200), score: z.number().min(0).max(1),
  })).max(5), tier: z.enum(["sure", "not sure", "low match"]), faceDown: z.boolean(), covered: z.boolean() }),
]);
export type RemoteDataMessage = z.infer<typeof remoteDataMessageSchema>;
const normalizedPoint=z.strictObject({x:z.number().min(0).max(1),y:z.number().min(0).max(1)});
/** Ephemeral LiveKit snapshot. Its authenticated sender is the feed owner. No hidden cards or pixels. */
export const remoteFieldTracksSchema=z.strictObject({type:z.literal('field.tracks'),cards:z.array(z.strictObject({
  ref:z.string().min(1).max(100),cardId:z.number().int().positive().max(0xffffffff),name:z.string().min(1).max(200).optional(),
  quad:z.array(normalizedPoint).length(4).refine(q=>{
    const cross=q.map((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
    return cross.every(v=>v>1e-7)||cross.every(v=>v< -1e-7);
  }),
})).max(20)});
export type RemoteFieldTracks=z.infer<typeof remoteFieldTracksSchema>;
export type RemoteFieldCard=RemoteFieldTracks['cards'][number];
export type RemoteDataPayload = { slug: string; fromSeat: number; message: RemoteDataMessage };
export type RemoteSnapshot = { table: RemoteTable; state: RemoteState; events: RemoteEvent[] };
export type RemoteAck = { ok: true } | { ok: false; error: string; retryAfterMs?: number };
export interface RemoteServerEvents {
  "remote:private": (payload: RemoteSnapshot) => void;
  "remote:changed": (payload: RemoteSnapshot) => void;
  "remote:data": (payload: RemoteDataPayload) => void;
  "remote:subscription-expired": (payload: { slug: string }) => void;
}
export interface RemoteClientEvents {
  "remote:join": (payload: { token: string }, ack?: (result: RemoteAck) => void) => void;
  "remote:leave": () => void;
  "remote:data": (payload: RemoteDataMessage, ack?: (result: RemoteAck) => void) => void;
}
export const remoteSocketRoom = (guildId: string, slug: string) => `remote:${guildId}:${slug}`;
