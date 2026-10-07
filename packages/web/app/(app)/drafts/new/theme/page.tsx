import { DraftFrame } from "@/components/draft/draft-frame";
import { NewDraftLead } from "@/components/draft/create/new-lead";
import { CreateThemeDraftForm } from "@/components/draft/create-theme-draft-form";

export default function NewThemeDraftPage() {
  return (
    <DraftFrame
      back={{ href: "/drafts/new", label: "New draft" }}
      title="New theme draft"
      sub="You add the themes at the Theme Table."
    >
      <NewDraftLead
        pieces={["Create", "Then add themes at the table"]}
        note="Each player drafts alone from their own theme. One cube per archetype."
      />
      <CreateThemeDraftForm />
    </DraftFrame>
  );
}
