"use client";

import { useEffect, useMemo, useState } from "react";
import { FFA4_FIXTURES, ffa4Variant } from "@/components/duel/table/fixtures/ffa4";
import { reviewFixtures } from "@/components/duel/table/fixtures/review";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";

/** The 4-way preview: the real table stage on the hand-made fixtures. */
export function Ffa4Preview({ stateId, cam, lock, review = false, out = null, pick = null, after = null, hub = null }: { stateId: string | null; cam: string | null; lock: string | null; review?: boolean; out?: string | null; pick?: string | null; after?: string | null; hub?: string | null }) {
  // `?out=2,3` sweeps those seats; `?after=1500` starts with them alive and sweeps them after that many ms (to watch the
  // crumble and the finale move); `?pick=field|hand` swaps the prompt for a pick among your own cards.
  const outSeats = useMemo(() => (out ?? "").split(",").filter((part) => /^[0-3]$/.test(part)).map(Number), [out]);
  const delay = after != null && /^\d+$/.test(after) ? Number(after) : null;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (delay == null) return;
    const timer = window.setTimeout(() => setLate(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  // The pick prompt arrives after the board is measured (a prompt that is there at mount would be routed to the card
  // strip, because no zone is drawn yet), as it does in a real duel.
  const [pickLive, setPickLive] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setPickLive(true), 700);
    return () => window.clearTimeout(timer);
  }, []);
  const base = useMemo(() => review ? reviewFixtures(0, "ffa4") : FFA4_FIXTURES, [review]);
  const kind = pick === "field" || pick === "hand" ? pick : null;
  const set = useMemo(() => ffa4Variant(base, { out: delay != null && !late ? [] : outSeats, pick: pickLive ? kind : null }), [base, outSeats, delay, late, kind, pickLive]);
  return (
    <PreviewHarness
      set={set}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa4"
      renderStage={(controller, state, preview) => (
        <TableShell
          controller={controller}
          initialCamera={{ mode: preview.cam.mode, focusSeat: preview.cam.focusSeat, lookSeat: preview.cam.lookSeat, ...state.ui?.camera }}
          initialLock={preview.lock}
          initialOutOrder={state.ui?.initialOutOrder}
          chainMode={preview.chainMode}
          hubPlace={hub === "center" ? "center" : "band"}
        />
      )}
    />
  );
}
