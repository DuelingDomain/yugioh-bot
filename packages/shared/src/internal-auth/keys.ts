import { createHmac } from "node:crypto";

export type Purpose = "ws-broadcast" | "duel-host" | "bot-announce";
export type TokenPurpose = "admin-spectate" | "duel-room" | "draft-room" | "tournament-room";

export function deriveKey(secret: string, purpose: Purpose | TokenPurpose): Buffer {
  return createHmac("sha256", secret).update(`yugidraft:${purpose}:v2`).digest();
}
