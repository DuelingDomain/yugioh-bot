import { notFound } from "next/navigation";
import { remoteDuelsForViewer, remoteSttUrl } from "@/lib/remote-duels";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { findRemoteTournamentLink } from "@/lib/remote-tournament-link";
import { RemoteTableScreen } from "@/components/remote/ui/table";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!await remoteDuelsForViewer()) notFound();
  const { slug } = await params;
  // A tournament match's table shows its Confirm or Dispute panel to the two paired players.
  const access = await requireWebAccess();
  const tournament = access.ok && access.discordUserId ? findRemoteTournamentLink(getDb(), env.discordGuildId, access.discordUserId, slug) : null;
  return <RemoteTableScreen slug={slug} sttUrl={remoteSttUrl()} tournament={tournament} />;
}
