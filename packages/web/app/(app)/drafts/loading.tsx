import { Plus } from "lucide-react";
import { DraftFrame } from "@/components/draft/draft-frame";
import { LoadingBody } from "@/components/dashboard/loading-body";
import { SvButton } from "@/components/sheet";

/** The heading and the New draft button are real from the first frame; the list is blocks. */
export default function DraftsLoading() {
  return (
    <DraftFrame
      title="Drafts"
      actions={
        <SvButton as="a" href="/drafts/new" variant="primary">
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          New draft
        </SvButton>
      }
    >
      <LoadingBody label="Loading drafts" sections={[2, 3]} />
    </DraftFrame>
  );
}
