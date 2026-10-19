import { notFound, redirect } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { AdminConsole } from "@/components/admin-console/admin-console";
import { isOwnerUser } from "@/lib/owner-access";
import { resolveSessionIdentity } from "@/lib/session-identity";

export const metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

export default async function AdminConsolePage() {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  // Anyone not listed in OWNER_USER_IDS gets the normal not-found page. The section APIs check access again.
  if (result.ok && !isOwnerUser(result.identity.userId)) notFound();

  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Admin console</h1>
          <p className="page-sub">Everything live in Dueling Domain, in one place</p>
        </div>
      </header>
      <AdminConsole />
    </SheetRoot>
  );
}
