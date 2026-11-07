import { notFound, redirect } from "next/navigation";
import { sans, mono } from "@/components/admin-console/fonts";
import { AdminConsole } from "@/components/admin-console/admin-console";
import { isOwnerUser } from "@/lib/owner-access";
import { remoteDuelsForViewer } from "@/lib/remote-duels";
import { resolveSessionIdentity } from "@/lib/session-identity";

export const metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

export default async function AdminConsolePage() {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  // Anyone not listed in OWNER_USER_IDS gets the normal not-found page. The section APIs check access again.
  if (result.ok && !isOwnerUser(result.identity.userId)) notFound();

  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <AdminConsole vision={await remoteDuelsForViewer()} />
    </div>
  );
}
