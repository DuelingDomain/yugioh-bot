import { DuelReplayView } from "@/components/duel/replay";
import { requireWebAccess } from "@/lib/web-access";
import { isOwnerUser } from "@/lib/owner-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DuelReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Only a hint for the page: it asks for the private replay and shows the owner controls. The owner routes
  // check the current owner list again for every request.
  const access = await requireWebAccess();
  let canInspectSource = false;
  if (access.ok && isOwnerUser(access.userId)) {
    try {
      const source = getDb().prepare<[string, string], { sandbox: number; setup_json: string | null }>(
        "select sandbox, setup_json from duels where web_slug = ? and guild_id = ?",
      ).get(slug, env.discordGuildId);
      const setup = source?.setup_json ? JSON.parse(source.setup_json) : null;
      canInspectSource = !!source && source.sandbox === 0 && !setup?.sandbox;
    } catch {
      // A failed hint read must not enable private replay controls.
    }
  }
  return <DuelReplayView slug={slug} canInspectSource={canInspectSource} />;
}
