import { notFound } from "next/navigation";
import { remoteDuelsForViewer } from "@/lib/remote-duels";
import { RemoteLobby } from "@/components/remote/ui/lobby";
export const dynamic = "force-dynamic";
export default async function RemoteDuelsPage() {
  if (!await remoteDuelsForViewer()) notFound();
  return <RemoteLobby />;
}
