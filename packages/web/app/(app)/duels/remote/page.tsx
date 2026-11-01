import { notFound } from "next/navigation";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { RemoteLobby } from "@/components/remote/ui/lobby";
export const dynamic = "force-dynamic";
export default function RemoteDuelsPage() {
  if (!remoteDuelsEnabled()) notFound();
  return <RemoteLobby />;
}
