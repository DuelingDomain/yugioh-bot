"use client";

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { PlaceholderStage, PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";

/** The 3-way preview. It shows the placeholder stage until the real stage of this mode is built. */
export function Ffa3Preview({ stateId, cam, lock }: { stateId: string | null; cam: string | null; lock: string | null }) {
  return (
    <PreviewHarness
      set={FFA3_FIXTURES}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa3"
      renderStage={(controller, state) => <PlaceholderStage controller={controller} state={state} />}
    />
  );
}
