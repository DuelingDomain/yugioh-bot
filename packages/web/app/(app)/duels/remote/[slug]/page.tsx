import { notFound } from "next/navigation";
import { remoteDuelViewerId, remoteHybridEnabledFor } from "@/lib/remote-duels";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { findRemoteTournamentLink } from "@/lib/remote-tournament-link";
import { RemoteTableScreen } from "@/components/remote/ui/table";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ watch?: string }> }) {
  const userId = await remoteDuelViewerId();
  if (userId === null) notFound();
  const { slug } = await params;
  const { watch } = await searchParams;
  // A tournament match's table shows its Confirm or Dispute panel to the two paired players.
  const tournament = findRemoteTournamentLink(getDb(), env.discordGuildId, userId, slug);
  return <RemoteTableScreen slug={slug} tournament={tournament} watchAsAdmin={watch === "1"} hybridEnabled={remoteHybridEnabledFor(userId)} />;
}
