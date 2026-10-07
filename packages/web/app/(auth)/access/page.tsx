import type { Metadata } from "next";
import { AccessContent } from "@/components/auth/access-content";
import { marketingUrlFromEnv } from "@/lib/auth-page-params";

export const metadata: Metadata = {
  title: "Closed alpha | Dueling Domain",
  description: "Dueling Domain is invite-only for now. Join the waitlist.",
};

// Server-rendered, no client code. Read MARKETING_URL per request, never at build time.
export const dynamic = "force-dynamic";

export default function AccessPage() {
  return <AccessContent marketingUrl={marketingUrlFromEnv()} />;
}
