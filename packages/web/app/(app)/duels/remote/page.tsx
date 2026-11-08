import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
/** Remote tables are in the normal Duels lists now. */
export default function RemoteDuelsPage() {
  redirect("/duels");
}
