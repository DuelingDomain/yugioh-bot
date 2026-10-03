import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { TagPreview } from "./preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview · 2v2 tag",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Fixture preview of the 2v2 tag table. Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <TagPreview stateId={one(query.state)} cam={one(query.cam)} lock={one(query.lock)} />;
}
