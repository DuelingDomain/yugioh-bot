"use client";

import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { PlaceholderStage, PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";

/** The 2v2 tag preview. It shows the placeholder stage until the real stage of this mode is built. */
export function TagPreview({ stateId, cam, lock }: { stateId: string | null; cam: string | null; lock: string | null }) {
  return (
    <PreviewHarness
      set={TAG_FIXTURES}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/tag"
      renderStage={(controller, state) => <PlaceholderStage controller={controller} state={state} />}
    />
  );
}
