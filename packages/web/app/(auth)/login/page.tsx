import { redirect } from "next/navigation";
import { encodeQuery } from "@/components/auth/marketing-links";
import { firstParam, type SearchParams } from "@/lib/auth-page-params";
import { safeReturnPath } from "@/lib/auth-return";

/** The old NextAuth URL. Old links and bookmarks land on `/sign-in`, keeping a safe `callbackUrl` as `redirect_url`. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const callback = firstParam((await searchParams).callbackUrl);
  const safe = callback === undefined ? null : safeReturnPath(callback);
  // safeReturnPath answers with the dashboard for anything it rejects, so only an echo of the input is a kept path.
  redirect(callback !== undefined && safe === callback ? `/sign-in?redirect_url=${encodeQuery(safe)}` : "/sign-in");
}
