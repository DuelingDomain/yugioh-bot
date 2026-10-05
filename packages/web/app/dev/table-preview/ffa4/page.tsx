import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { Ffa4Preview } from "./preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview · 4-way",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Fixture preview of the 4-way table. Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <Ffa4Preview stateId={one(query.state)} cam={one(query.cam)} lock={one(query.lock)} review={one(query.fixture) === "review"} out={one(query.out)} pick={one(query.pick)} after={one(query.after)} hub={one(query.hub)} />;
}
