import { CreateDraftForm } from "@/components/draft/create-draft-form";
import { WorkbenchFrame } from "@/components/draft/setup/workbench";

export default function NewCubeDraftPage() {
  return (
    <WorkbenchFrame
      back={{ href: "/drafts/new", label: "New draft" }}
      title="New cube draft"
      sub="You get a lobby and an invite link."
    >
      <CreateDraftForm />
    </WorkbenchFrame>
  );
}
