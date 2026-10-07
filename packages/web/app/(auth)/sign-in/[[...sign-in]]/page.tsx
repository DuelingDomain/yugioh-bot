import type { Metadata } from "next";
import { marketingUrlFromEnv, returnToFromParams, type SearchParams } from "@/lib/auth-page-params";
import { SignInCard } from "./sign-in-card";

export const metadata: Metadata = {
  title: "Sign in | Dueling Domain",
  description: "Sign in to your drafts, decks and duels.",
};

// Read MARKETING_URL per request, never at build time.
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return <SignInCard returnTo={returnToFromParams(params)} marketingUrl={marketingUrlFromEnv()} />;
}
