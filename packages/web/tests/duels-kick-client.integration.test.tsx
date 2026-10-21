// @vitest-environment jsdom
import React from "react";
import Database from "better-sqlite3";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, type DuelService } from "@yugidraft/shared/services";
import { seedIdentity } from "../../duel-server/tests/helpers/identity";

const state = vi.hoisted(() => ({ actor: vi.fn(), replace: vi.fn(), duels: null as DuelService | null, slug: "", playerId: 0 }));
vi.mock("@/lib/duel-host", async original => ({ ...await original<object>(), requireDuelActor: state.actor,
  callDuelHost: async () => ({ ok: true, data: state.duels!.room(state.slug, "g", state.playerId) }) }));
vi.mock("@/lib/replay-fork-access", () => ({ assertDuelForkAccess: () => ({ kind: "play" }) }));
vi.mock("@/lib/env", () => ({ env: { wsInternalSecret: "kick-client-fixture" } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/duel/deck-editor", () => ({ DeckEditor: () => <p>Deck editor</p> }));
vi.mock("@/components/duel/deck-card-preview", () => ({ DeckCardPreview: () => null }));

const sockets: FakeSocket[] = [];
class FakeSocket {
  connected = false;
  id = "client-kick-socket";
  handlers = new Map<string, (...args: any[]) => void>();
  on(event: string, handler: (...args: any[]) => void) { this.handlers.set(event, handler); return this; }
  timeout() { return { emit(_event: string, _payload: unknown, ack: (error: null, data: unknown) => void) {
    ack(null, { ok: true, onlineSeats: [0, 1], spectatorCount: 0 });
  } }; }
  emit() {}
  connect() { this.connected = true; queueMicrotask(() => this.handlers.get("connect")?.()); }
  disconnect() { this.connected = false; }
}
vi.mock("socket.io-client", () => ({ io: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } }));

import { GET as roomGet } from "../app/api/duels/[slug]/route";
import { GET as connectionGet } from "../app/api/duels/[slug]/connection/route";
import { DuelRoomView } from "@/components/duel/room";

afterEach(() => { vi.useRealTimers(); cleanup(); sockets.length = 0; state.replace.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["duel:changed", "duel:subscription-expired"])("redirects a connected kicked player after %s, clearing their private room", async event => {
  const db = new Database(":memory:"); migrate(db);
  const owner = seedIdentity(db, { name: "Host" }); const guest = seedIdentity(db, { name: "Guest" });
  const duels = createDuelService(db);
  const { slug } = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Client table", mode: "normal" });
  duels.takeSeat(slug, "g", guest.playerId, 1);
  Object.assign(state, { duels, slug, playerId: guest.playerId });
  state.actor.mockResolvedValue({ ok: true, guildId: "g", playerId: guest.playerId, duels });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const request = new Request(new URL(input, "http://localhost"), init);
    const context = { params: Promise.resolve({ slug }) };
    if (request.url.endsWith("/connection")) return connectionGet(request, context);
    if (request.url.endsWith(`/api/duels/${slug}`)) return roomGet(request, context);
    if (request.url.endsWith("/activity")) return Response.json({ slug, idleDeadlineAt: new Date(Date.now() + 600_000).toISOString() });
    throw new Error(`Unexpected request ${request.url}`);
  }));
  try {
    render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><DuelRoomView slug={slug} /></SWRConfig>);
    await screen.findByText("Client table");
    await waitFor(() => expect(sockets[0]?.connected).toBe(true));
    // This database mutation is what the signed host operation commits; the client uses
    // real GET/connection routes, SWR and its normal websocket refresh/poll path.
    duels.kickPlayer(slug, "g", owner.playerId, guest.playerId);
    vi.useFakeTimers();
    await act(async () => { sockets[0]!.handlers.get(event)?.({ slug }); });
    // Do not advance the polling timers: the socket event must trigger the redirect.
    expect(state.replace).toHaveBeenCalledWith("/duels?notice=kicked");
    expect(screen.queryByText("Deck editor")).toBeNull();
  } finally { cleanup(); db.close(); }
});
