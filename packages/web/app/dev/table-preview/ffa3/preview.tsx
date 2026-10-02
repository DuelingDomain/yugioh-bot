"use client";

import { useMemo, useState } from "react";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { reviewFixtures } from "@/components/duel/table/fixtures/review";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";

/** The 3-way preview: the real table stage on the hand-made fixtures. */
export function Ffa3Preview({ stateId, cam, lock, review = false }: { stateId: string | null; cam: string | null; lock: string | null; review?: boolean }) {
  const [damage, setDamage] = useState(0);
  const set = useMemo(() => review ? reviewFixtures(damage) : FFA3_FIXTURES, [review, damage]);
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
        />
      )}
    />
  );
}
