"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mutate as mutateAll } from "swr";
import type { DuelFormat, DuelOpeningView, DuelRoom } from "@yugidraft/shared/duels";
import { DuelLobby } from "@/components/duel/lobby";
import { DuelRoomView } from "@/components/duel/room";
import { solidFixture } from "@/components/duel/solid/fixtures/states";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";

const SLUG = "kick-preview";
const NAMES = ["Ren Arata", "Ryo Sato", "Mika Hana", "Dana Okoye"];

function baseRoom(format: DuelFormat): DuelRoom {
  const room = format === "1v1" ? solidFixture("m1").room
    : format === "ffa3" ? FFA3_FIXTURES.states.main.room
    : format === "ffa4" ? FFA4_FIXTURES.states.main.room
    : TAG_FIXTURES.states.main.room;
  const copy = structuredClone(room) as DuelRoom;
  copy.session.slug = SLUG;
  copy.session.organizerPlayerId = 1;
  copy.session.seats = copy.session.seats.map((seat, index) => ({ ...seat, playerId: index + 1, displayName: seat.displayName || NAMES[index]! }));
  copy.mySeat = 0;
  copy.role = "player";
  return copy;
}

function lobbyRoom(format: DuelFormat, view: string): DuelRoom {
  const room = baseRoom(format);
  const seats = room.session.seats.map((seat, index) => ({ ...seat, isBot: false, ready: index % 2 === 0 }));
  // One seat stays open so the lobby shows every row type: host, joined, ready, open, invited and removed.
  const kept = format === "1v1" ? seats : seats.slice(0, seats.length - 1);
  room.session = { ...room.session, status: "lobby", seats: kept };
  room.engine = null;
  room.clock = null;
  room.invitedPlayers = [{ playerId: 11, displayName: "Priya Natarajan" }];
  room.kickedPlayers = [{ playerId: 12, displayName: "Mallory Voss" }];
  if (view === "opening") {
    const deadlineAt = new Date(Date.now() + 600_000).toISOString();
    room.opening = (format === "1v1" || format === "tag"
      ? { phase: "rps", round: 1, serverNow: Date.now(), deadlineAt, picked: [false, false], myPick: null, reveal: null, winnerSeat: null, choice: null, choiceByTimeout: false }
      : { phase: "dice", round: 1, serverNow: Date.now(), deadlineAt, rounds: [{ round: 1, rolls: kept.map((_, i) => [3, 5, 2, 6][i]!) }], order: null, finalSeats: null }) as DuelOpeningView;
  }
  return room;
}

function installFetch(read: () => DuelRoom, write: (next: DuelRoom) => void, fail: boolean) {
  const real = window.fetch.bind(window);
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (path === "/api/duels") return json({ duels: [] });
    if (path === `/api/duels/${SLUG}`) return json(read());
    if (path === `/api/duels/${SLUG}/kick`) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (fail) return json({ error: "The duel host is busy. Try again in a moment." }, 503);
      const { playerId } = JSON.parse(String(init?.body)) as { playerId: number };
      const room = structuredClone(read());
      const target = room.session.seats.find((seat) => seat.playerId === playerId);
      const name = target?.displayName ?? room.invitedPlayers?.find((player) => player.playerId === playerId)?.displayName ?? "Player";
      room.invitedPlayers = (room.invitedPlayers ?? []).filter((player) => player.playerId !== playerId);
      room.kickedPlayers = [...(room.kickedPlayers ?? []), { playerId, displayName: name }];
      if (room.session.status === "lobby") {
        room.session.seats = room.session.seats.filter((seat) => seat.playerId !== playerId);
        room.opening = null;
      }
      write(room);
      return json({ session: room.session });
    }
    if (path === `/api/duels/${SLUG}/deck/validate`) return json({ issues: [] });
    if (path.startsWith(`/api/duels/${SLUG}/`)) return json({});
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

export function KickPreview({ format, view, fail }: { format: string | null; view: string | null; fail: boolean }) {
  const kind: DuelFormat = format === "tag" || format === "ffa3" || format === "ffa4" ? format : "1v1";
  const mode = view === "opening" ? "opening" : "lobby";
  const initial = useMemo(() => lobbyRoom(kind, mode), [kind, mode]);
  const [ready, setReady] = useState(false);
  const body = useRef(initial);
  useEffect(() => {
    body.current = initial;
    const restore = installFetch(() => body.current, (next) => { body.current = next; void mutateAll(() => true); }, fail);
    setReady(true);
    return restore;
  }, [initial, fail]);
  return ready ? <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8">{view === "list" ? <DuelLobby /> : <DuelRoomView slug={SLUG} windowed />}</main> : null;
}
