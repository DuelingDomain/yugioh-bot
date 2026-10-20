"use client";

import { useEffect, useMemo, useState } from "react";
import { DuelRoomView } from "@/components/duel/room";
import { classicStateId } from "../preview";
import { solidFixture } from "@/components/duel/solid/fixtures/states";
import { isXyzStateId, xyzRoom } from "./xyz-fixture";

const SLUG = "classic-preview";

/** Answers the room's own requests from the fixture, once, before the room's first read. Anything else goes on to the network. */
function installFixtureFetch(body: string) {
  const real = window.fetch.bind(window);
  const json = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "application/json" } });
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (path === `/api/duels/${SLUG}`) return Promise.resolve(json(body));
    if (path.startsWith(`/api/duels/${SLUG}/`)) return Promise.resolve(json("{}"));
    return real(input, init);
  };
  return () => { window.fetch = real; };
}

export function ClassicRoomPreview({ stateId, domain }: { stateId: string | null; domain: boolean }) {
  const id = classicStateId(isXyzStateId(stateId) ? "chain" : stateId);
  const room = useMemo(() => {
    const { room: plain } = solidFixture(id);
    const base = isXyzStateId(stateId) ? xyzRoom(plain, stateId) : plain;
    if (domain) return base;
    return { ...base, session: { ...base.session, mode: "normal" as const } };
  }, [id, stateId, domain]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = installFixtureFetch(JSON.stringify(room));
    setReady(true);
    return restore;
  }, [room]);
  // The live page wraps the room in the app shell's padded main; the room's negative margins cancel that padding.
  return ready ? <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8"><DuelRoomView slug={SLUG} windowed viewOverride={new URLSearchParams(window.location.search).get("view") === "3d" ? "3d" : undefined} /></main> : null;
}
