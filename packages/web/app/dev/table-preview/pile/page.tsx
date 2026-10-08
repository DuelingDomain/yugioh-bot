import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { PilePreview } from "./preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview · pile viewer",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Fixture preview of the pile viewer (Graveyard, Banished, Extra Deck), the one sheet every duel mode shares.
 * `?cards=11` (1 to 40 cards), `&text=short|long|none` (the effect text of the cards; `none` makes the viewer look it up),
 * `&owner=you|opp`, `&reduced=1`. Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <PilePreview count={Number(one(query.cards)) || 11} text={one(query.text)} owner={one(query.owner) === "opp" ? "opp" : "you"} reduced={one(query.reduced) === "1"} />;
}
