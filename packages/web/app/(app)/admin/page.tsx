import { notFound, redirect } from "next/navigation";
import { Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import { AdminConsole } from "@/components/admin-console/admin-console";
import { isOwnerUser } from "@/lib/owner-access";
import { resolveSessionIdentity } from "@/lib/session-identity";

export const metadata = { title: "Admin console" };
export const dynamic = "force-dynamic";

const sans = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--adm-sans" });
const mono = Martian_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--adm-mono" });

export default async function AdminConsolePage() {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  // Anyone not listed in OWNER_USER_IDS gets the normal not-found page. The section APIs check access again.
  if (result.ok && !isOwnerUser(result.identity.userId)) notFound();

  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <AdminConsole />
    </div>
  );
}
