"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mutate as mutateAll } from "swr";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { DuelRoomView } from "@/components/duel/room";
import { classicStateId } from "../preview";
import { solidFixture } from "@/components/duel/solid/fixtures/states";
import { isXyzStateId, xyzRoom } from "./xyz-fixture";

const SLUG = "classic-preview";

/** Answers the room's own requests from the fixture, once, before the room's first read. Anything else goes on to the network. */
function installFixtureFetch(read: () => string) {
  const real = window.fetch.bind(window);
  const json = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "application/json" } });
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.href).pathname;
    if (path === `/api/duels/${SLUG}`) return Promise.resolve(json(read()));
    if (path.startsWith(`/api/duels/${SLUG}/`)) {
      // The e2e proofs read what the room sent (an answer, a precheck): `window.__previewWrites`.
      const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
      const sent = ((window as unknown as { __previewWrites?: string[] }).__previewWrites ??= []);
      if (method.toUpperCase() !== "GET") {
        sent.push(`${method} ${path}`);
        // The body too (an answer's chosen card): `window.__previewBodies`.
        ((window as unknown as { __previewBodies?: string[] }).__previewBodies ??= []).push(typeof init?.body === "string" ? init.body : "");
      }
      return Promise.resolve(json("{}"));
    }
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
  const body = useRef("");
  useEffect(() => {
    body.current = JSON.stringify(room);
    const restore = installFixtureFetch(() => body.current);
    // Test hook (the e2e proofs): `window.__previewEditRoom(edit)` changes the served room and makes the room read it again, as a
    // change notice does: a new prompt, a card that moves or turns face-down, new stats.
    Object.assign(window, {
      __previewEditRoom: (edit: (next: DuelRoom) => void) => {
        const next = JSON.parse(body.current) as DuelRoom;
        edit(next);
        if (next.engine) next.engine.revision += 1;
        body.current = JSON.stringify(next);
        void mutateAll(() => true);
      },
    });
    setReady(true);
    return restore;
  }, [room]);
  // The live page wraps the room in the app shell's padded main; the room's negative margins cancel that padding.
  return ready ? <main className="min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8"><DuelRoomView slug={SLUG} windowed viewOverride={new URLSearchParams(window.location.search).get("view") === "3d" ? "3d" : undefined} /></main> : null;
}
