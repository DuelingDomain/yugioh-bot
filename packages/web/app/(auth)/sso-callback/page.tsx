import type { Metadata } from "next";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";
import { SsoCallbackCard } from "./sso-callback-card";

export const metadata: Metadata = {
  title: "Signing you in | Dueling Domain",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Discord sends people back here. The card resumes Clerk's sign-in or sign-up attempt and asks only for what is missing. */
export default async function SsoCallbackPage() {
  return <SsoCallbackCard marketingUrl={marketingUrlFromEnv()} />;
}
