import { notFound, redirect } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { AdminConsole } from "@/components/admin-console/admin-console";
import { isOwnerUser } from "@/lib/owner-access";
import { auth } from "@/lib/auth";

export const metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

export default async function AdminConsolePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Anyone not listed in OWNER_USER_IDS gets the normal not-found page. The section APIs check access again.
  if (!isOwnerUser(session.user.id)) notFound();

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
