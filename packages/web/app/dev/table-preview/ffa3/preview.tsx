"use client";

import { useEffect, useMemo, useState } from "react";
import { FFA3_FIXTURES, ffa3Variant } from "@/components/duel/table/fixtures/ffa3";
import { reviewFixtures } from "@/components/duel/table/fixtures/review";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";
import { useTableTextScale } from "@/components/duel/card-text-size";

/**
 * The 3-way preview: the real table stage on the hand-made fixtures.
 * Seats 0 and 1 are a facing pair with one shared Extra Monster row, as the engine reports it (`?pair=0` leaves that out, like an
 * older core: the plaza stage). `?out=2` sweeps that seat (its field crumbles, then the last two glide face to face, a visual change only: the pair 0 and 1 keep the linked Extra Monster row); `?after=1500`
 * starts with it alive and sweeps it after that many ms (to watch the crumble); `?def=1` lays Defense Position monsters on
 * every field; `?pick=def` asks for one of them on any field; `?pick=cards` asks for one of 14 Deck cards (the card strip); `?pick=dm` (your Deck Master in its zone with a Summon and a Set: the Ready slot); `?pick=attack`, `attack-direct` or `attack-listed` (the engine's target list: the first rival may be hit directly and holds monsters; the second rival's monsters are no targets) shows the battle prompt (the aim-first flow); `?hover=rival|mine|hand` puts the pointer on a card once the
 * table is drawn (the preview at the left).
 */
export function Ffa3Preview({ stateId, cam, lock, review = false, out = null, after = null, def = null, pick = null, hover = null, pair = null }: { stateId: string | null; cam: string | null; lock: string | null; review?: boolean; out?: string | null; after?: string | null; def?: string | null; pick?: string | null; hover?: string | null; pair?: string | null }) {
  useTableTextScale();
  const [damage, setDamage] = useState(0);
  const outSeats = useMemo(() => (out ?? "").split(",").filter((part) => /^[0-2]$/.test(part)).map(Number), [out]);
  const delay = after != null && /^\d+$/.test(after) ? Number(after) : null;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (delay == null) return;
    const timer = window.setTimeout(() => setLate(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  // A pick arrives after the board is measured, as in a real duel (one there at mount would go to the card strip).
  const [pickLive, setPickLive] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPickLive(true), 700);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (hover !== "rival" && hover !== "mine" && hover !== "hand") return;
    const timer = window.setTimeout(() => {
      const selector = hover === "hand"
        ? '[data-hand-seat][data-side="you"] button'
        : `[data-seat-field] [data-kind="mz"][data-occupied="true"][data-side="${hover === "mine" ? "you" : "opp"}"] button`;
      const node = document.querySelector<HTMLElement>(selector);
      node?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [hover]);
  const base = useMemo(() => review ? reviewFixtures(damage) : FFA3_FIXTURES, [review, damage]);
  const set = useMemo(
    () => ffa3Variant(base, { out: delay != null && !late ? [] : outSeats, pair: pair !== "0", defense: def === "1", pick: pickLive && (pick === "def" || pick === "cards" || pick === "cards2" || pick === "attack" || pick === "attack-direct" || pick === "attack-listed" || pick === "dm") ? pick : null }),
    [base, outSeats, delay, late, def, pick, pickLive, pair],
  );
  return (
    <PreviewHarness
      set={set}
      tools={review && stateId === "main" ? <button onClick={() => setDamage((value) => value ? 0 : 2000)}>Fixture damage</button> : undefined}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa3"
      renderStage={(controller, state, preview) => (
        <TableShell
          controller={controller}
          initialCamera={{ mode: preview.cam.mode, focusSeat: preview.cam.focusSeat, lookSeat: preview.cam.lookSeat, ...state.ui?.camera }}
          initialLock={preview.lock}
          initialOutOrder={state.ui?.initialOutOrder}
          chainMode={preview.chainMode}
        />
      )}
    />
  );
}
