import { notFound } from "next/navigation";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { RemoteTableList } from "@/components/remote/remote-workbench";
export const dynamic = "force-dynamic";
export default function RemoteDuelsPage() {
  if (!remoteDuelsEnabled()) notFound();
  return <RemoteTableList />;
}
