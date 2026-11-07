import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { RemoteTournamentPreview } from "./preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Remote tournament preview",
  robots: { index: false, follow: false },
};

/**
 * Review page for the Remote tournament screens on fixtures: `?view=dispute` (organizer dispute view in the host tools)
 * or `?view=table` (detection badges, the LP 0 prompt, the pre-match check). No network. Off unless DUEL_FX_LAB=1
 * (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function RemoteTournamentPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const view = (await searchParams).view;
  return <RemoteTournamentPreview view={view === "table" ? "table" : "dispute"} />;
}
