import { notFound } from "next/navigation";
import { requireSandboxActor } from "@/lib/sandbox-access";
import { SandboxList } from "./_components/sandbox-list";
import { toListItems } from "./_lib/load";

// Admin rights can change after the web build.
export const dynamic = "force-dynamic";

export default async function SandboxPage() {
  const actor = await requireSandboxActor();
  if (!actor.ok) notFound();
  const items = toListItems(actor.guildId, actor.playerId, actor.scenarios.list(actor.guildId));
  return <SandboxList items={items} />;
}
