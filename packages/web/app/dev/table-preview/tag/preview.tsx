"use client";

import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";

/** The 2v2 tag preview: the Rooftop shell on the fixtures, with the camera and lock the URL asks for. */
export function TagPreview({ stateId, cam, lock }: { stateId: string | null; cam: string | null; lock: string | null }) {
  return (
    <PreviewHarness
      set={TAG_FIXTURES}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/tag"
      renderStage={(controller, state, preview) => (
        <TagShell
          key={`${state.id}:${preview.cam.mode}:${preview.cam.focusSeat}:${preview.cam.lookSeat}:${preview.lock ?? ""}`}
          controller={controller}
          teamNames={TAG_TEAM_NAMES}
          initialCamera={{
            mode: preview.cam.mode,
            focusSeat: preview.cam.focusSeat,
            lookSeat: preview.cam.lookSeat,
            ...(state.ui?.camera ?? {}),
            ...(preview.lock ? { lock: { reason: preview.lock, untilMs: performance.now() + 1_000_000_000 } } : {}),
          }}
        />
      )}
    />
  );
}
