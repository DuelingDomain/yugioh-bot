import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FxLab } from "@/components/duel/fx-lab/lab";
import { fxLabEnabled } from "@/lib/fx-lab";

// Read the switch on every request, not at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Duel animation lab",
  robots: { index: false, follow: false },
};

/** Review page for the duel animations. Off unless DUEL_FX_LAB=1 (or `next dev`); see src/lib/fx-lab.ts. */
export default function FxLabPage() {
  if (!fxLabEnabled()) notFound();
  return <FxLab />;
}
