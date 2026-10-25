import type { Metadata } from "next";
import { firstParam, marketingUrlFromEnv, returnToFromParams, type SearchParams } from "@/lib/auth-page-params";
import { SignUpCard } from "./sign-up-card";

export const metadata: Metadata = {
  title: "Create your account | Dueling Domain",
  description: "Accept your invite and finish your Dueling Domain account.",
};

export const dynamic = "force-dynamic";

/** Reached from the invitation email: `/sign-up?__clerk_ticket=<ticket>`. The email shown comes from Clerk, never from the URL. */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  // Creator invitations redirect to `/sign-up?via=creator`; it only hides the "How did you hear about us?" question.
  return <SignUpCard ticket={firstParam(params.__clerk_ticket) || null} returnTo={returnToFromParams(params)} marketingUrl={marketingUrlFromEnv()} creatorInvite={firstParam(params.via) === "creator"} />;
}
