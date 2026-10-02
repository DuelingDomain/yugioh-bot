"use client";

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { TableShell } from "@/components/duel/table/table-shell";

/** The 3-way preview: the real table stage on the hand-made fixtures. */
export function Ffa3Preview({ stateId, cam, lock }: { stateId: string | null; cam: string | null; lock: string | null }) {
  return (
    <PreviewHarness
      set={FFA3_FIXTURES}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa3"
      renderStage={(controller, state, preview) => (
        <TableShell
          controller={controller}
          initialCamera={{ mode: preview.cam.mode, focusSeat: preview.cam.focusSeat, lookSeat: preview.cam.lookSeat, ...state.ui?.camera }}
          initialLock={preview.lock}
        />
      )}
    />
  );
}
