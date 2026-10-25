import type { Metadata } from "next";
import { createCreatorAccessService, LINK_CODE_PATTERN } from "@yugidraft/shared/services/creator-access";
import { JoinCard } from "@/components/auth/join-card";
import type { JoinPageProps } from "@/lib/admin-console/creators-types";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";
import { getDb } from "@/lib/db";

export const metadata: Metadata = {
  title: "You're invited | Dueling Domain",
  description: "A creator invited you to the Dueling Domain closed alpha.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A creator's invite link. Public. It shows only the creator name, the state and the spots left; an unknown or
 * malformed code reads like a closed link, so the page never tells a guessed code from a revoked one.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = LINK_CODE_PATTERN.test(code) ? createCreatorAccessService(getDb()).publicLink(code) : null;
  const props: JoinPageProps = view
    ? { code, state: view.state, creatorName: view.creatorName, spotsLeft: view.spotsLeft }
    : { code, state: "revoked", creatorName: "", spotsLeft: 0 };
  // Waitlist leads from a closed link still count for the creator; a malformed code is not stored.
  const waitlistSource = LINK_CODE_PATTERN.test(code) ? `creator:${code}` : "creator";
  return <JoinCard {...props} waitlistSource={waitlistSource} marketingUrl={marketingUrlFromEnv()} />;
}
