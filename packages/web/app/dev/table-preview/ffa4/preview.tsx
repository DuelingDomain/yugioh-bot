"use client";

import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { PlaceholderStage, PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";

/** The 4-way preview. It shows the placeholder stage until the real stage of this mode is built. */
export function Ffa4Preview({ stateId, cam, lock }: { stateId: string | null; cam: string | null; lock: string | null }) {
  return (
    <PreviewHarness
      set={FFA4_FIXTURES}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/ffa4"
      renderStage={(controller, state) => <PlaceholderStage controller={controller} state={state} />}
    />
  );
}
