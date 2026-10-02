"use client";

import { useMemo } from "react";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { reviewFixtures } from "@/components/duel/table/fixtures/review";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";

/** The 4-way preview: the real table stage on the hand-made fixtures. */
export function Ffa4Preview({ stateId, cam, lock, review = false }: { stateId: string | null; cam: string | null; lock: string | null; review?: boolean }) {
  const set = useMemo(() => review ? reviewFixtures(0, "ffa4") : FFA4_FIXTURES, [review]);
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
        />
      )}
    />
  );
}
