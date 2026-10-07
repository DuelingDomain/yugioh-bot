import { CreateDraftForm } from "@/components/draft/create-draft-form";
import { WorkbenchFrame } from "@/components/draft/setup/workbench";

// The Discord flag is read per request on the server; the client forms only receive it.
export const dynamic = "force-dynamic";

export default function NewCubeDraftPage() {
  const discordEnabled = process.env.DISCORD_BOT_ENABLED === "1";
  return (
    <WorkbenchFrame
      back={{ href: "/drafts/new", label: "New draft" }}
      title="New cube draft"
      sub="You get a lobby and an invite link."
    >
      <CreateDraftForm discordEnabled={discordEnabled} />
    </WorkbenchFrame>
  );
}
