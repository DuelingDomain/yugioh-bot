import type { Metadata } from "next";
import { WAITLIST_VIEWS, WaitlistCard, type WaitlistView } from "@/components/auth/waitlist-card";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";

export const metadata: Metadata = {
  title: "Join the waitlist | Dueling Domain",
  description: "Dueling Domain is invite-only for now. Join the waitlist.",
  robots: { index: false, follow: false },
};

// Read MARKETING_URL per request, never at build time.
export const dynamic = "force-dynamic";

/** `?s=` is the result of the Discord sign-in path (no email in the URL). Anything else opens the email form. */
export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
  const { s } = await searchParams;
  const initial = WAITLIST_VIEWS.find(view => view === s) ?? "form";
  return <WaitlistCard marketingUrl={marketingUrlFromEnv()} initial={initial satisfies WaitlistView} />;
}
