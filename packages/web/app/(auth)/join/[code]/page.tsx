import type { Metadata } from "next";
import { createCreatorAccessService, LINK_CODE_PATTERN } from "@yugidraft/shared/services/creator-access";
import { JoinCard } from "@/components/auth/join-card";
import type { JoinPageProps } from "@/lib/admin-console/creators-types";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";
import { getDb } from "@/lib/db";
import { isE2EAuthEnabled } from "@/lib/e2e-auth";

export const metadata: Metadata = {
  title: "You're invited | Dueling Domain",
  description: "A creator invited you to the Dueling Domain closed alpha.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A creator's invite link. Public. It shows the state, the spots left and, for an open, full or expired link, the
 * creator name. An unknown or malformed code renders exactly like a revoked link (state "revoked", no creator name),
 * so the page never tells a guessed code from a revoked one.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = LINK_CODE_PATTERN.test(code) ? createCreatorAccessService(getDb()).publicLink(code) : null;
  const props: JoinPageProps = view
    ? { code, state: view.state, creatorName: view.state === "revoked" ? "" : view.creatorName, spotsLeft: view.state === "revoked" ? 0 : view.spotsLeft }
    : { code, state: "revoked", creatorName: "", spotsLeft: 0 };
  // Waitlist leads from a closed link still count for the creator; a malformed code is not stored.
  const waitlistSource = LINK_CODE_PATTERN.test(code) ? `creator:${code}` : "creator";
  return <JoinCard {...props} waitlistSource={waitlistSource} marketingUrl={marketingUrlFromEnv()} e2e={isE2EAuthEnabled()} />;
}
