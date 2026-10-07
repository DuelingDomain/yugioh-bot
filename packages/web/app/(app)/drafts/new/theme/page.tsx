import { env } from "@/lib/env";
import { DraftFrame } from "@/components/draft/draft-frame";
import { NewDraftLead } from "@/components/draft/create/new-lead";
import { CreateThemeDraftForm } from "@/components/draft/create-theme-draft-form";

export default function NewThemeDraftPage() {
  return (
    <DraftFrame
      back={{ href: "/drafts/new", label: "New draft" }}
      title="New theme draft"
      sub="You add the themes in the lobby."
    >
      <NewDraftLead
        pieces={["Create", "Then add themes in the lobby"]}
        note="One cube per archetype."
      />
      <CreateThemeDraftForm discordEnabled={env.discordBotEnabled} />
    </DraftFrame>
  );
}
