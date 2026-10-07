import { env } from "@/lib/env";
import { DraftFrame } from "@/components/draft/draft-frame";
import { NewDraftLead } from "@/components/draft/create/new-lead";
import { CreateDraftForm } from "@/components/draft/create-draft-form";

export default function NewCubeDraftPage() {
  return (
    <DraftFrame
      back={{ href: "/drafts/new", label: "New draft" }}
      title="New cube draft"
      sub="You get a lobby and an invite link."
    >
      <NewDraftLead
        pieces={["Create", "Then a lobby with an invite link"]}
        note="Nothing is dealt until you press Start."
      />
      <CreateDraftForm discordEnabled={env.discordBotEnabled} />
    </DraftFrame>
  );
}
