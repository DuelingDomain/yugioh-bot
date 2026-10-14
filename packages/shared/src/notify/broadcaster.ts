import { log } from "../observability/index.js";
import type { SignedPostTransport } from "../internal-auth/index.js";
import type { DraftBroadcastPayload, TournamentBroadcastPayload } from "../ws/events.js";

export type Broadcaster = {
  draft(payload: DraftBroadcastPayload): Promise<void>;
  tournament(payload: TournamentBroadcastPayload): Promise<void>;
};

export function createBroadcaster(transport: SignedPostTransport): Broadcaster {
  async function send(prefix: "draft" | "tournament", payload: { kind: string }): Promise<void> {
    const { kind, ...data } = payload;
    const res = await transport.post(`/internal/${prefix}/${kind}`, JSON.stringify(data));
    if (!res.ok) log("warn", "Broadcast rejected", { channel: prefix, kind, status: res.status });
  }
  return {
    draft: (payload) => send("draft", payload),
    tournament: (payload) => send("tournament", payload),
  };
}
