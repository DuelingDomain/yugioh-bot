// @vitest-environment jsdom
import React from "react";
import Database from "better-sqlite3";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createDuelSeriesService, createTournamentService, type DuelService } from "@yugidraft/shared/services";
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

it.each([
  { stage: "casual lobby", canKick: true },
  { stage: "challenge lobby", canKick: true },
  { stage: "challenge opening", canKick: true },
  { stage: "tournament lobby", canKick: false },
  { stage: "tournament opening", canKick: false },
  { stage: "game 2 lobby", canKick: false },
  { stage: "game 2 opening", canKick: false },
  { stage: "side decking", canKick: false },
])("shows the host Kick controls only before the match starts: $stage", async ({ stage, canKick }) => {
  const db = new Database(":memory:"); migrate(db);
  const owner = seedIdentity(db, { name: "Host" }); const guest = seedIdentity(db, { name: "Guest" });
  const duels = createDuelService(db);
  const series = createDuelSeriesService(db);
  const deck = { main: new Array<number>(40).fill(1), extra: [], side: [] };
  let slug: string;
  if (stage.startsWith("tournament")) {
    const tournaments = createTournamentService(db);
    const cup = tournaments.create("g", "Kick cup", "round_robin", owner.userId);
    tournaments.join(cup.id, owner.playerId); tournaments.join(cup.id, guest.playerId);
    tournaments.start(cup.id);
    db.prepare("update tournament_participants set deck_json=? where tournament_id=?").run(JSON.stringify(deck), cup.id);
    const slot = db.prepare("select id from tournament_matches where tournament_id=? limit 1").get(cup.id) as { id: number };
    slug = series.startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: owner.playerId }).duel.slug;
    duels.markReady(slug, "g", owner.playerId); duels.markReady(slug, "g", guest.playerId);
  } else if (stage.startsWith("challenge")) {
    slug = series.createChallenge({ guildId: "g", challengerPlayerId: owner.playerId, opponentPlayerId: guest.playerId,
      bestOf: 3, ranked: false, mode: "normal", settings: { validateDeck: false } }).duel.slug;
    duels.setDeck(slug, "g", owner.playerId, deck); duels.setDeck(slug, "g", guest.playerId, deck);
  } else {
    slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Kick controls", mode: "normal",
      bestOf: 3, settings: { validateDeck: false } }).slug;
    duels.takeSeat(slug, "g", guest.playerId, 1);
    duels.setDeck(slug, "g", owner.playerId, deck); duels.setDeck(slug, "g", guest.playerId, deck);
    if (stage !== "casual lobby") {
      duels.activate(slug, "g", owner.playerId, ["1", "2", "3", "4"], "fixture", null, { firstTurnDraw: false });
      duels.complete(slug, "g", 0, "Surrender");
      if (stage !== "side decking") slug = series.createNextGame(duels.get(slug, "g").seriesId!, "g").slug;
    }
  }
  if (stage.endsWith("opening")) duels.startOpening(slug, "g", owner.playerId, Date.now());
  Object.assign(state, { duels, slug, playerId: owner.playerId });
  state.actor.mockResolvedValue({ ok: true, guildId: "g", playerId: owner.playerId, duels });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const request = new Request(new URL(input, "http://localhost"), init);
    const context = { params: Promise.resolve({ slug }) };
    if (request.url.endsWith("/connection")) return connectionGet(request, context);
    if (request.url.endsWith(`/api/duels/${slug}`)) return roomGet(request, context);
    if (request.url.endsWith("/activity")) return Response.json({ slug, idleDeadlineAt: null });
    if (new URL(request.url).pathname === "/api/duels/cards") return Response.json({ cards: [{ code: 1, name: "Fixture monster", type: 17 }], missing: [] });
    throw new Error(`Unexpected request ${request.url}`);
  }));
  try {
    if (stage.startsWith("game 2")) vi.useFakeTimers();
    await act(async () => {
      render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><DuelRoomView slug={slug} /></SWRConfig>);
    });
    if (stage.startsWith("game 2")) {
      expect(screen.getByTestId("next-game-starting")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      vi.useRealTimers();
      fireEvent.click(screen.getByRole("button", { name: "Open the table" }));
    }
    if (stage === "side decking") await screen.findByTestId("between-games");
    else await screen.findByRole("region", { name: "Seats" });
    if (canKick) expect(screen.getAllByRole("button", { name: "Kick Guest" }).length).toBeGreaterThan(0);
    else expect(screen.queryAllByTestId("kick-player")).toHaveLength(0);
    if (stage.endsWith("opening")) expect(screen.queryByTestId("host-opening-kick") != null).toBe(canKick);
  } finally { cleanup(); db.close(); }
});
