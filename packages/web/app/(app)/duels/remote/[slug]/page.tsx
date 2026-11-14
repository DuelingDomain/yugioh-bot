import { notFound } from "next/navigation";
import { remoteDuelsForViewer } from "@/lib/remote-duels";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { findRemoteTournamentLink } from "@/lib/remote-tournament-link";
import { RemoteTableScreen } from "@/components/remote/ui/table";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ watch?: string }> }) {
  if (!await remoteDuelsForViewer()) notFound();
  const { slug } = await params;
  const { watch } = await searchParams;
  // A tournament match's table shows its Confirm or Dispute panel to the two paired players.
  const access = await requireWebAccess();
  const tournament = access.ok ? findRemoteTournamentLink(getDb(), env.discordGuildId, access.userId, slug) : null;
  return <RemoteTableScreen slug={slug} tournament={tournament} watchAsAdmin={watch === "1"} />;
}
