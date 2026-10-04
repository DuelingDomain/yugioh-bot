import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SolidPreviewRoom } from "@/components/duel/solid/fixtures/preview-room";
import { isSolidStateId } from "@/components/duel/solid/fixtures/states";
import { fxLabEnabled } from "@/lib/fx-lab";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "3D mode preview",
  robots: { index: false, follow: false },
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * Fixture preview of the 3D mode board: `?state=m1|summon|battle|chain|damage|m2|end`, `&view=flat`, `&reduced=1`.
 * Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts.
 */
export default async function SolidPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!fxLabEnabled()) notFound();
  const query = await searchParams;
  const state = one(query.state);
  // The room cancels the padding of the app layout with negative margins; this page has no app layout, so it adds it.
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <SolidPreviewRoom
        stateId={isSolidStateId(state) ? state : "m1"}
        flat={one(query.view) === "flat"}
        reduced={one(query.reduced) === "1"}
      />
    </div>
  );
}
