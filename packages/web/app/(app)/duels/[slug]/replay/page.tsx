import { DuelReplayView } from "@/components/duel/replay";
import { requireWebAccess } from "@/lib/web-access";
import { isOwnerUser } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

export default async function DuelReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Only a hint for the page: it asks for the private replay and shows the owner controls. The owner routes
  // check the current owner list again for every request.
  const access = await requireWebAccess();
  const canInspectSource = access.ok && isOwnerUser(access.userId);
  return <DuelReplayView slug={slug} canInspectSource={canInspectSource} />;
}
