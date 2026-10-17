import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { registerEventHandlers } from "../src/events.js";
import { DraftRoomManager } from "../src/rooms.js";
import { createDraftRoomToken } from "@yugidraft/shared/ws";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";
it("reports access lookup failures and refuses the subscription", () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const error = new Error("lookup failed"); const io = new EventEmitter(); const socket = new EventEmitter();
  registerEventHandlers(io as never, new DraftRoomManager(), { secret: "test-secret", canReadDraft: () => { throw error; } });
  io.emit("connection", socket);
  const ack = vi.fn();
  const token = createDraftRoomToken({ slug: "room-one", guildId: "guild-one", userId: 4, expiresAt: Date.now() + 60_000 }, "test-secret");
  socket.emit("draft:join", { slug: "room-one", userId: 4, token }, ack);
  expect(ack).toHaveBeenCalledWith({ error: "Draft not found" });
  expect(capture).toHaveBeenCalledWith(error, { tags: { operation: "[ws] draft access check failed" } });
});
