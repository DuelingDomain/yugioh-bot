import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fxLabEnabled } from "@/lib/fx-lab";
import { ClassicPreview } from "./preview";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Table preview · classic 1v1",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Fixture preview of the classic 1v1 room: the real field, the phase hub in the gap between the two fields and the
 * station track, on the 3D-mode preview fixtures (1v1 duels, no engine). `?state=main|summon|battle|chain|chains|damage|m2|end`,
 * `&chain=auto|always|off|none`, `&reduced=1`, `&attack=<seat>:<seq>><target>:<seq>` (a late attack declaration). Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  return <ClassicPreview stateId={one(query.state)} chain={one(query.chain)} reduced={one(query.reduced) === "1"} attack={one(query.attack)} />;
}
