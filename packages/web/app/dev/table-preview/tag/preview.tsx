"use client";

import { useMemo } from "react";

import { TAG_FIXTURES, TAG_TEAM_NAMES, tagSearchVariant } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { PreviewHarness } from "@/components/duel/table/fixtures/preview-harness";
import { useTableTextScale } from "@/components/duel/card-text-size";

/** The 2v2 tag preview: the Rooftop shell on the fixtures, with the camera and lock the URL asks for (`?pick=cards`: a 14-card Deck pick). */
export function TagPreview({ stateId, cam, lock, pick = null }: { stateId: string | null; cam: string | null; lock: string | null; pick?: string | null }) {
  useTableTextScale();
  const set = useMemo(() => (pick === "cards" ? tagSearchVariant(TAG_FIXTURES) : TAG_FIXTURES), [pick]);
  return (
    <PreviewHarness
      set={set}
      stateId={stateId}
      cam={cam}
      lock={lock}
      basePath="/dev/table-preview/tag"
      renderStage={(controller, state, preview) => (
        <TagShell
          key={`${state.id}:${preview.cam.mode}:${preview.cam.focusSeat}:${preview.cam.lookSeat}:${preview.lock ?? ""}`}
          controller={controller}
          teamNames={[...TAG_TEAM_NAMES]}
          preview
          initialLock={preview.lock}
          initialCamera={{
            mode: preview.cam.mode,
            focusSeat: preview.cam.focusSeat,
            lookSeat: preview.cam.lookSeat,
            ...(state.ui?.camera ?? {}),
          }}
          chainMode={preview.chainMode}
        />
      )}
    />
  );
}
